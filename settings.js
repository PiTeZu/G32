// settings.js - Settings page logic for AI Fact Checker

// DOM element references
const settingsForm = document.getElementById('settingsForm');
const apiKeyInput = document.getElementById('apiKey');
const apiEndpointInput = document.getElementById('apiEndpoint');
const modelInput = document.getElementById('model');
const temperatureInput = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperatureValue');
const maxTokensInput = document.getElementById('maxTokens');
const toggleApiKeyBtn = document.getElementById('toggleApiKey');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const statusMessage = document.getElementById('statusMessage');

// Default settings
const DEFAULTS = {
  apiKey: 'sk-c56277c688e54dd68aca6bef6e37dcb8',
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-v4-flash',
  temperature: 0.3,
  maxTokens: 4096
};

// Initialize the page
document.addEventListener('DOMContentLoaded', loadSettings);

// Event listeners
settingsForm.addEventListener('submit', handleSave);
testConnectionBtn.addEventListener('click', handleTestConnection);
toggleApiKeyBtn.addEventListener('click', toggleApiKeyVisibility);
temperatureInput.addEventListener('input', updateTemperatureDisplay);

/**
 * Load saved settings and populate the form
 */
async function loadSettings() {
  try {
    const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const merged = { ...DEFAULTS, ...settings };

    apiKeyInput.value = merged.apiKey || '';
    apiEndpointInput.value = merged.apiEndpoint || '';
    modelInput.value = merged.model || '';
    temperatureInput.value = merged.temperature ?? 0.3;
    maxTokensInput.value = merged.maxTokens || 4096;

    updateTemperatureDisplay();
  } catch (error) {
    showStatus('Failed to load settings. Please try again.', 'error');
    console.error('Load settings error:', error);
  }
}

/**
 * Save settings
 */
async function handleSave(event) {
  event.preventDefault();

  const apiKey = apiKeyInput.value.trim();

  // Basic validation: DeepSeek API keys start with 'sk-'
  if (apiKey && !apiKey.startsWith('sk-')) {
    showStatus('Warning: API key does not start with "sk-". DeepSeek keys typically start with "sk-". Please double-check your key.', 'error');
    return;
  }

  if (apiKey && apiKey.length < 20) {
    showStatus('Warning: API key appears too short. Please double-check your key.', 'error');
    return;
  }

  const settings = {
    apiKey,
    apiEndpoint: apiEndpointInput.value.trim() || DEFAULTS.apiEndpoint,
    model: modelInput.value.trim() || DEFAULTS.model,
    temperature: parseFloat(temperatureInput.value) || 0.3,
    maxTokens: parseInt(maxTokensInput.value, 10) || 4096
  };

  try {
    await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings
    });
    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    showStatus('Failed to save settings: ' + error.message, 'error');
    console.error('Save settings error:', error);
  }
}

/**
 * Test the API connection with current form values
 */
async function handleTestConnection() {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus('Please enter an API key first.', 'error');
    return;
  }

  testConnectionBtn.disabled = true;
  testConnectionBtn.textContent = 'Testing...';
  hideStatus();

  const settings = {
    apiKey,
    apiEndpoint: apiEndpointInput.value.trim() || DEFAULTS.apiEndpoint,
    model: modelInput.value.trim() || DEFAULTS.model,
    temperature: parseFloat(temperatureInput.value) || 0.3,
    maxTokens: parseInt(maxTokensInput.value, 10) || 4096
  };

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'testConnection',
      settings
    });

    if (response.error) {
      showStatus(response.error, 'error');
    } else {
      showStatus(response.message || 'Connection successful!', 'success');
    }
  } catch (error) {
    showStatus('Connection test failed: ' + error.message, 'error');
    console.error('Test connection error:', error);
  } finally {
    testConnectionBtn.disabled = false;
    testConnectionBtn.textContent = 'Test Connection';
  }
}

/**
 * Toggle API key visibility
 */
function toggleApiKeyVisibility() {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleApiKeyBtn.innerHTML = isPassword ? '&#128064;' : '&#128065;';
}

/**
 * Update the temperature display value
 */
function updateTemperatureDisplay() {
  temperatureValue.textContent = temperatureInput.value;
}

/**
 * Show a status message
 */
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.classList.remove('hidden');

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusMessage.classList.add('hidden');
    }, 3000);
  }
}

/**
 * Hide the status message
 */
function hideStatus() {
  statusMessage.classList.add('hidden');
}
