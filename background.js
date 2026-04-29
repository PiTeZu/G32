// background.js - Service worker for API calls, context menu, and side panel management

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: 'sk-c56277c688e54dd68aca6bef6e37dcb8',
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-v4-flash',
  temperature: 0.3,
  maxTokens: 4096
};

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
 * Build the system prompt for AI fact-checking
 */
function buildSystemPrompt() {
  return `You are a professional fact-checker and information verification assistant. Your task is to help users verify the reliability of information they encounter on the web.

## Instructions:
1. Analyze the text the user provides. Identify all factual claims within it.
2. Search your knowledge for credible sources that confirm or refute each claim.
3. Select the TOP 5 most credible and relevant sources for verification.
4. Rank sources by credibility using these criteria (highest to lowest):
   - Official government, academic (.edu, .gov) and institutional sources
   - Peer-reviewed research and established scientific publications
   - Major reputable news organizations with editorial standards
   - Verified expert analysis and industry reports
   - Other sources with transparent methodology

## Response Format:
You MUST respond ONLY with valid JSON in the following structure. No other text before or after the JSON.

{
  "claim": "Summarize the main claim being verified",
  "verification": "Brief overall assessment (1-3 sentences)",
  "sources": [
    {
      "title": "Source article or page title",
      "url": "https://full-url-to-source.com",
      "credibility": "high|medium|low",
      "credibility_reason": "Why this source is credible or not (in the context of the claim)",
      "snippet": "Relevant quote or summary from this source"
    }
  ]
}`;
}

/**
 * Build the user prompt with the selected text
 */
function buildUserPrompt(selectedText) {
  return `Please verify the following text and find the top 5 most credible sources related to these claims:

"""
${selectedText}
"""

Remember to rank sources by credibility and return ONLY the JSON response.`;
}

/**
 * Call the AI API (DeepSeek by default) with the selected text
 */
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

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(text);

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

  // Parse the JSON from the AI response
  try {
    // Try to find JSON block in the response (in case AI wraps it in markdown)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = jsonMatch[1] || content;
    const parsed = JSON.parse(jsonStr.trim());
    return { success: true, data: parsed };
  } catch (parseError) {
    // If JSON parsing fails, return raw text
    return {
      success: true,
      data: {
        claim: text.substring(0, 200),
        verification: 'AI response could not be parsed as structured JSON.',
        sources: [],
        rawResponse: content
      }
    };
  }
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
