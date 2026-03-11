// Clicktionary Bridge Content Script
// Injected into the hosted website to pass chrome.storage data to the page

console.log('Clicktionary: bridge.js injected ✓');

// Listen for requests from the website
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith('CLICKTIONARY_')) return;

  console.log('Clicktionary bridge received:', event.data.type);

  const { type, payload } = event.data;

  if (type === 'CLICKTIONARY_GET_WORDS') {
    chrome.storage.local.get('wordBank', (data) => {
      window.postMessage({
        type: 'CLICKTIONARY_WORDS_RESPONSE',
        words: data.wordBank || []
      }, '*');
    });
  }

  if (type === 'CLICKTIONARY_SAVE_WORDS') {
    chrome.storage.local.set({ wordBank: payload.words }, () => {
      window.postMessage({ type: 'CLICKTIONARY_SAVE_RESPONSE', success: true }, '*');
    });
  }

  if (type === 'CLICKTIONARY_DELETE_WORD') {
    chrome.storage.local.get('wordBank', (data) => {
      const words = (data.wordBank || []).filter(w => w.id !== payload.id);
      chrome.storage.local.set({ wordBank: words }, () => {
        window.postMessage({ type: 'CLICKTIONARY_DELETE_RESPONSE', success: true }, '*');
      });
    });
  }

  if (type === 'CLICKTIONARY_UPDATE_WORD') {
    chrome.storage.local.get('wordBank', (data) => {
      const words = data.wordBank || [];
      const i = words.findIndex(w => w.id === payload.id);
      if (i > -1) words[i] = { ...words[i], ...payload.updates };
      chrome.storage.local.set({ wordBank: words }, () => {
        window.postMessage({ type: 'CLICKTIONARY_UPDATE_RESPONSE', success: true }, '*');
      });
    });
  }
});

// Signal to the page that the extension bridge is ready
console.log('Clicktionary: sending BRIDGE_READY signal');
window.postMessage({ type: 'CLICKTIONARY_BRIDGE_READY' }, '*');
console.log('Clicktionary: BRIDGE_READY sent');
