// sidepanel.js - Main logic for the AI Fact Checker sidebar

// DOM element references
const selectionDisplay = document.getElementById('selectionDisplay');
const getSelectionBtn = document.getElementById('getSelectionBtn');
const verifyBtn = document.getElementById('verifyBtn');
const statusBar = document.getElementById('statusBar');
const resultsSection = document.getElementById('resultsSection');
const verificationSummary = document.getElementById('verificationSummary');
const sourcesList = document.getElementById('sourcesList');
const errorDisplay = document.getElementById('errorDisplay');
const settingsBtn = document.getElementById('settingsBtn');

let currentSelection = '';
let currentSettings = {};

// Initialize the side panel when it loads
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await getPageSelection();

  // Check if there is a pending selection from context menu click or content script
  chrome.storage.session.get(['pendingSelection', 'latestSelection'], (result) => {
    const selection = result.pendingSelection || result.latestSelection;
    if (selection) {
      currentSelection = selection;
      displaySelection(currentSelection);
      verifyBtn.disabled = false;
      if (result.pendingSelection) {
        chrome.storage.session.remove('pendingSelection');
      }
    }
  });

  // Listen for selection changes from content script while sidebar is open
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'session' && changes.latestSelection) {
      const newSelection = changes.latestSelection.newValue;
      if (newSelection) {
        currentSelection = newSelection;
        displaySelection(currentSelection);
        verifyBtn.disabled = false;
      }
    }
  });
});

// Event listeners
getSelectionBtn.addEventListener('click', getPageSelection);
verifyBtn.addEventListener('click', runVerification);
settingsBtn.addEventListener('click', openSettings);

/**
 * Get the currently selected text from the active tab
 */
async function getPageSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      displayError('Could not access the active tab.');
      return;
    }

    // First try to get selection from content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getSelection' });
      if (response && response.text) {
        currentSelection = response.text;
        displaySelection(currentSelection);
        verifyBtn.disabled = false;
        return;
      }
    } catch {
      // Content script might not be ready, fall back to scripting API
    }

    // Fallback: use scripting API to extract selection
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString()?.trim() || ''
    });

    if (results && results[0] && results[0].result) {
      currentSelection = results[0].result;
      displaySelection(currentSelection);
      verifyBtn.disabled = false;
    } else {
      displaySelection('');
      verifyBtn.disabled = true;
      displayError('No text selected. Please select some text on the page first.');
    }
  } catch (error) {
    displayError('Unable to access the page. Make sure you are on a regular webpage (not a system page).');
    console.error('Selection error:', error);
  }
}

/**
 * Display the selected text in the UI
 */
function displaySelection(text) {
  if (text) {
    selectionDisplay.textContent = text;
    selectionDisplay.classList.remove('placeholder');
  } else {
    selectionDisplay.innerHTML = '<span class="placeholder">Select text on the page, then click "Get Selection" or use the context menu.</span>';
  }
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
    currentSettings = response || {};
  } catch {
    currentSettings = {};
  }
}

/**
 * Run the AI verification
 */
async function runVerification() {
  if (!currentSelection) {
    displayError('Please select text to verify first.');
    return;
  }

  // Reload settings in case they changed
  await loadSettings();

  if (!currentSettings.apiKey) {
    displayError('API key not configured. Click the gear icon to open settings and enter your DeepSeek API key.');
    return;
  }

  // Show loading state
  showLoading(true);
  hideError();
  hideResults();
  verifyBtn.disabled = true;
  getSelectionBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'callAI',
      text: currentSelection,
      settings: currentSettings
    });

    if (response.error) {
      displayError(response.error);
      return;
    }

    if (response.success && response.data) {
      displayResults(response.data);
    } else {
      displayError('Unexpected response from AI service.');
    }
  } catch (error) {
    displayError('Failed to communicate with the extension background service. Please try reloading the extension.');
    console.error('Verification error:', error);
  } finally {
    showLoading(false);
    verifyBtn.disabled = false;
    getSelectionBtn.disabled = false;
  }
}

/**
 * Display verification results
 */
function displayResults(data) {
  resultsSection.classList.remove('hidden');

  // Display verification summary
  if (data.verification) {
    verificationSummary.innerHTML = `<strong>Assessment:</strong> ${escapeHtml(data.verification)}`;
    verificationSummary.classList.remove('hidden');
  } else {
    verificationSummary.classList.add('hidden');
  }

  // Display sources
  sourcesList.innerHTML = '';
  if (data.sources && data.sources.length > 0) {
    data.sources.forEach((source, index) => {
      const card = createSourceCard(source, index + 1);
      sourcesList.appendChild(card);
    });
  } else if (data.rawResponse) {
    // If JSON parsing failed, display the raw response
    const card = document.createElement('div');
    card.className = 'source-card';
    card.innerHTML = `<p style="white-space:pre-wrap;font-size:13px;">${escapeHtml(data.rawResponse)}</p>`;
    sourcesList.appendChild(card);
  } else {
    sourcesList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No sources returned. Try a different selection.</p>';
  }
}

/**
 * Create a source card element
 */
function createSourceCard(source, rank) {
  const card = document.createElement('div');
  card.className = 'source-card';

  const credibilityClass = (source.credibility || 'medium').toLowerCase();
  const credibilityLabel = credibilityClass.charAt(0).toUpperCase() + credibilityClass.slice(1);

  card.innerHTML = `
    <div class="source-header">
      <span class="source-rank">#${rank}</span>
      <span class="source-title">
        ${source.url
          ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title || 'Untitled Source')}</a>`
          : escapeHtml(source.title || 'Untitled Source')}
      </span>
      <span class="credibility-badge ${credibilityClass}">${credibilityLabel}</span>
    </div>
    ${source.snippet ? `<div class="source-snippet">${escapeHtml(source.snippet)}</div>` : ''}
    ${source.credibility_reason ? `<div class="source-reason">Credibility: ${escapeHtml(source.credibility_reason)}</div>` : ''}
  `;

  return card;
}

/**
 * Show/hide loading state
 */
function showLoading(show) {
  if (show) {
    statusBar.textContent = 'Verifying information with AI...';
    statusBar.classList.remove('hidden', 'error');
  } else {
    statusBar.classList.add('hidden');
  }
}

/**
 * Hide results section
 */
function hideResults() {
  resultsSection.classList.add('hidden');
}

/**
 * Display error message
 */
function displayError(message) {
  errorDisplay.textContent = message;
  errorDisplay.classList.remove('hidden');
}

/**
 * Hide error message
 */
function hideError() {
  errorDisplay.classList.add('hidden');
}

/**
 * Open the settings page
 */
function openSettings() {
  chrome.runtime.openOptionsPage();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
