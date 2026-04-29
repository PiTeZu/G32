// content.js - Captures text selection and communicates with the extension

let lastSelection = '';

// Listen for text selection events on the page
document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';

  if (text && text !== lastSelection) {
    lastSelection = text;
    // Store the selection in session storage for the side panel to retrieve
    chrome.runtime.sendMessage({
      action: 'selectionChanged',
      text: text.substring(0, 5000) // Limit length to avoid storage issues
    }).catch(() => {
      // Extension context may not be available, that's OK
    });
  }
});

// Also listen for keyboard selection (Shift + arrow keys)
document.addEventListener('keyup', (event) => {
  if (event.shiftKey) {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    if (text && text !== lastSelection) {
      lastSelection = text;
      chrome.runtime.sendMessage({
        action: 'selectionChanged',
        text: text.substring(0, 5000)
      }).catch(() => {});
    }
  }
});

// Handle request for current selection from side panel or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelection') {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';
    sendResponse({ text: text.substring(0, 5000) });
    return true;
  }
});
