// background.js - Service worker for API calls, context menu, and side panel management

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: 'sk-c56277c688e54dd68aca6bef6e37dcb8',
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-v4-flash',
  temperature: 0.3,
  maxTokens: 4096
};

const MAX_SEARCH_RESULTS = 10; // How many raw search results to fetch before AI ranking
const AI_RANK_LIMIT = 5;      // How many sources the AI should return after ranking

// Open side panel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Create context menu item for right-click text selection
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'verify-with-ai',
    title: 'Verify with TruthLens',
    contexts: ['selection']
  });
});

// Handle context menu click - open side panel and pass selected text
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'verify-with-ai') {
    // Store selected text temporarily so side panel can retrieve it
    chrome.storage.session.set({ pendingSelection: info.selectionText });
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Listen for messages from sidepanel and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'callAI') {
    callAIAPI(request.text, request.settings)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep the message channel open for async response
  }

  if (request.action === 'getSettings') {
    getSettings()
      .then(sendResponse)
      .catch(() => sendResponse(DEFAULT_SETTINGS));
    return true;
  }

  if (request.action === 'saveSettings') {
    saveSettings(request.settings)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'testConnection') {
    testAPIConnection(request.settings)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  // Store latest selection from content script for side panel to retrieve
  if (request.action === 'selectionChanged') {
    chrome.storage.session.set({ latestSelection: request.text });
    sendResponse({ received: true });
    return true;
  }
});

/**
 * Retrieve settings from chrome.storage.sync, merging with defaults
 */
async function getSettings() {
  const stored = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...stored.settings };
}

/**
 * Save settings to chrome.storage.sync
 */
async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

/**
 * Search the web for real-time results using DuckDuckGo HTML (no API key required).
 * Returns an array of { title, url, snippet } objects.
 */
async function searchWeb(query) {
  const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);

  const response = await fetch(searchUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    console.warn('Web search failed, status:', response.status);
    return [];
  }

  const html = await response.text();

  // Parse search results from DuckDuckGo HTML
  const results = [];
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/[^>]*>/gi;

  // Extract all links
  const links = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    let url = linkMatch[1].replace(/&amp;/g, '&');
    // Skip DuckDuckGo internal redirect wrapper, extract real URL
    const uddMatch = url.match(/uddg=([^&]+)/);
    if (uddMatch) {
      url = decodeURIComponent(uddMatch[1]);
    }
    // Skip non-http URLs and DuckDuckGo internal pages
    if (!url.startsWith('http')) continue;
    const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
    if (title) {
      links.push({ title, url });
    }
  }

  // Extract all snippets
  const snippets = [];
  let snipMatch;
  while ((snipMatch = snippetRegex.exec(html)) !== null) {
    const text = snipMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text) {
      snippets.push(text);
    }
  }

  // Pair links with snippets (they appear in order)
  const count = Math.min(links.length, snippets.length, MAX_SEARCH_RESULTS);
  for (let i = 0; i < count; i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i]
    });
  }

  // If we got links but no snippets matched, use links alone
  if (results.length === 0 && links.length > 0) {
    for (let i = 0; i < Math.min(links.length, MAX_SEARCH_RESULTS); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: '(No description available)'
      });
    }
  }

  return results;
}

/**
 * Build the system prompt for AI fact-checking using REAL search results.
 * The AI receives actual web search results and ranks them by credibility.
 */
function buildSystemPromptWithSearch() {
  return `You are a professional fact-checker and information verification assistant. Your task is to verify claims by analyzing REAL web search results provided to you.

## Instructions:
1. Analyze the user's text and identify the key factual claims.
2. Review the web search results provided below - these are REAL, current search results.
3. Select the TOP ${AI_RANK_LIMIT} most credible and relevant sources from the provided list.
4. Rank them by credibility using these criteria (highest to lowest):
   - Official government, academic (.edu, .gov) and institutional sources
   - Peer-reviewed research and established scientific publications
   - Major reputable news organizations with editorial standards
   - Verified expert analysis and industry reports
   - Other sources with transparent methodology
5. For each selected source, provide a credibility reason based on the domain, publisher reputation, and content quality.
6. ONLY use URLs from the search results provided - NEVER invent or guess URLs.
7. If none of the search results are credible, state that honestly and suggest better search terms.

## Response Format:
You MUST respond ONLY with valid JSON in the following structure. No other text before or after the JSON.

{
  "claim": "Summarize the main claim being verified",
  "verification": "Brief overall assessment (1-3 sentences)",
  "sources": [
    {
      "title": "Source title from search results",
      "url": "https://exact-url-from-search-results",
      "credibility": "high|medium|low",
      "credibility_reason": "Why this source is credible (domain authority, publisher, methodology)",
      "snippet": "Relevant excerpt from the search result"
    }
  ]
}`;
}

/**
 * Build the user prompt with the selected text and real search results.
 */
function buildUserPromptWithSearch(selectedText, searchResults) {
  let resultsBlock = '';
  searchResults.forEach((r, i) => {
    resultsBlock += `[${i + 1}] Title: ${r.title}\n    URL: ${r.url}\n    Snippet: ${r.snippet}\n\n`;
  });

  return `Text to verify:
"""
${selectedText}
"""

Below are REAL web search results I found for this topic. Please select the ${AI_RANK_LIMIT} most credible sources from this list:

${resultsBlock}

IMPORTANT: Only use URLs from the list above. Do not invent or guess any URLs. Return ONLY the JSON response.`;
}

/**
 * Parse API error response body into a human-readable message
 */
function parseAPIError(status, body) {
  try {
    const json = JSON.parse(body);
    const msg = json.error?.message || body;
    if (status === 401) {
      return `Authentication failed: ${msg}\n\nPlease double-check your API key in Settings. Make sure:\n- No extra spaces at the beginning or end\n- The key is copied correctly from platform.deepseek.com/api_keys\n- The key has not been revoked`;
    }
    if (status === 403) {
      return `Access denied: ${msg}\n\nYour API key may not have permission or has insufficient balance.`;
    }
    if (status === 429) {
      return `Rate limited: ${msg}\n\nToo many requests. Please wait and try again.`;
    }
    return `${msg} (HTTP ${status})`;
  } catch {
    return `${body} (HTTP ${status})`;
  }
}

async function callAIAPI(text, customSettings) {
  const settings = customSettings || await getSettings();
  const apiKey = (settings.apiKey || '').trim();

  if (!apiKey) {
    throw new Error('API key not configured. Please open extension settings and enter your API key.');
  }

  // Step 1: Search the web for real-time results
  let searchResults = [];
  try {
    searchResults = await searchWeb(text);
  } catch (searchError) {
    console.warn('Web search failed, falling back to AI-only mode:', searchError.message);
  }

  // Step 2: Build prompts - use search results if available, otherwise fall back to knowledge-based
  let systemPrompt, userPrompt;
  if (searchResults.length > 0) {
    systemPrompt = buildSystemPromptWithSearch();
    userPrompt = buildUserPromptWithSearch(text, searchResults);
  } else {
    // Fallback: use the old knowledge-based prompts if search returned nothing
    systemPrompt = buildSystemPromptFallback();
    userPrompt = buildUserPromptFallback(text);
  }

  // Step 3: Call the AI API
  const response = await fetch(settings.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: false
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(parseAPIError(response.status, errorBody));
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from AI API');
  }

  // Step 4: Parse the JSON from the AI response
  try {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = jsonMatch[1] || content;
    const parsed = JSON.parse(jsonStr.trim());

    // Validate: ensure the AI didn't invent URLs outside our search results
    if (searchResults.length > 0) {
      const validUrls = new Set(searchResults.map(r => r.url));
      parsed.sources = (parsed.sources || []).map(source => {
        // If the URL is not from our search results, try to find a matching one
        if (!validUrls.has(source.url)) {
          // Try matching by title similarity
          const match = searchResults.find(r =>
            r.title.toLowerCase() === (source.title || '').toLowerCase()
          );
          if (match) {
            source.url = match.url;
          } else {
            // Mark as potentially unverified
            source.url = source.url || '';
            source.credibility_reason = (source.credibility_reason || '') +
              ' [Note: URL could not be verified against live search results]';
          }
        }
        return source;
      });
    }

    return {
      success: true,
      data: parsed,
      searchUsed: searchResults.length > 0
    };
  } catch (parseError) {
    return {
      success: true,
      data: {
        claim: text.substring(0, 200),
        verification: 'AI response could not be parsed as structured JSON.',
        sources: [],
        rawResponse: content
      },
      searchUsed: searchResults.length > 0
    };
  }
}

/**
 * Fallback system prompt (used when web search returns no results)
 */
function buildSystemPromptFallback() {
  return `You are a professional fact-checker and information verification assistant. Your task is to help users verify the reliability of information they encounter on the web.

## Instructions:
1. Analyze the text the user provides. Identify all factual claims within it.
2. Use your knowledge to reference credible sources that confirm or refute each claim.
3. Select the TOP ${AI_RANK_LIMIT} most credible and relevant sources for verification.
4. Rank sources by credibility using these criteria (highest to lowest):
   - Official government, academic (.edu, .gov) and institutional sources
   - Peer-reviewed research and established scientific publications
   - Major reputable news organizations with editorial standards
   - Verified expert analysis and industry reports
   - Other sources with transparent methodology
5. IMPORTANT: Only provide URLs you are confident actually exist. If unsure about a URL, mark it as "[URL not confirmed]" and provide the organization name instead.

## Response Format:
You MUST respond ONLY with valid JSON. No other text before or after the JSON.

{
  "claim": "Summarize the main claim being verified",
  "verification": "Brief overall assessment (1-3 sentences)",
  "sources": [
    {
      "title": "Source article or page title",
      "url": "https://confirmed-url.com (or [URL not confirmed] if unsure)",
      "credibility": "high|medium|low",
      "credibility_reason": "Why this source is credible",
      "snippet": "Relevant quote or summary"
    }
  ]
}`;
}

/**
 * Fallback user prompt (used when web search returns no results)
 */
function buildUserPromptFallback(selectedText) {
  return `Please verify the following text and find the top ${AI_RANK_LIMIT} most credible sources related to these claims:

"""
${selectedText}
"""

Remember: only provide URLs you are confident actually exist. Rank sources by credibility. Return ONLY the JSON response.`;
}

/**
 * Test the API connection with a simple request
 */
async function testAPIConnection(settings) {
  const endpoint = settings.apiEndpoint || DEFAULT_SETTINGS.apiEndpoint;
  const apiKey = (settings.apiKey || '').trim();

  if (!apiKey) {
    throw new Error('API key is required to test connection.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_SETTINGS.model,
      messages: [
        { role: 'user', content: 'Hello, respond with just the word "OK".' }
      ],
      max_tokens: 10,
      temperature: 0
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(parseAPIError(response.status, errorBody));
  }

  const data = await response.json();
  return { success: true, message: 'Connection successful! API is responding correctly.' };
}
