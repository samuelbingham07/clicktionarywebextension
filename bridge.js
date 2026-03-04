// SpanishLens Bridge Content Script
// Injected into the hosted website to pass chrome.storage data to the page

// Listen for requests from the website
window.addEventListener('message', async (event) => {
  // Only accept messages from our own page
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith('SPANISHLENS_')) return;

  const { type, payload } = event.data;

  if (type === 'SPANISHLENS_GET_WORDS') {
    chrome.storage.local.get('wordBank', (data) => {
      window.postMessage({
        type: 'SPANISHLENS_WORDS_RESPONSE',
        words: data.wordBank || []
      }, '*');
    });
  }

  if (type === 'SPANISHLENS_SAVE_WORDS') {
    chrome.storage.local.set({ wordBank: payload.words }, () => {
      window.postMessage({ type: 'SPANISHLENS_SAVE_RESPONSE', success: true }, '*');
    });
  }

  if (type === 'SPANISHLENS_DELETE_WORD') {
    chrome.storage.local.get('wordBank', (data) => {
      const words = (data.wordBank || []).filter(w => w.id !== payload.id);
      chrome.storage.local.set({ wordBank: words }, () => {
        window.postMessage({ type: 'SPANISHLENS_DELETE_RESPONSE', success: true }, '*');
      });
    });
  }

  if (type === 'SPANISHLENS_UPDATE_WORD') {
    chrome.storage.local.get('wordBank', (data) => {
      const words = data.wordBank || [];
      const i = words.findIndex(w => w.id === payload.id);
      if (i > -1) words[i] = { ...words[i], ...payload.updates };
      chrome.storage.local.set({ wordBank: words }, () => {
        window.postMessage({ type: 'SPANISHLENS_UPDATE_RESPONSE', success: true }, '*');
      });
    });
  }
});

// Signal to the page that the extension bridge is ready
window.postMessage({ type: 'SPANISHLENS_BRIDGE_READY' }, '*');
