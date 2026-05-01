// Clicktionary Bridge Content Script
// Injected into the hosted website to pass chrome.storage data to the page

const BRIDGE_ORIGIN = 'https://samuelbingham07.github.io';


// Listen for requests from the website
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith('CLICKTIONARY_')) return;

  const { type, payload } = event.data;

  if (type === 'CLICKTIONARY_GET_SESSION') {
    chrome.storage.local.get('supabase_session', (data) => {
      window.postMessage({
        type: 'CLICKTIONARY_SESSION_RESPONSE',
        session: data.supabase_session || null
      }, BRIDGE_ORIGIN);
    });
  }

  if (type === 'CLICKTIONARY_GET_WORDS') {
    chrome.storage.local.get('wordBank', (data) => {
      window.postMessage({
        type: 'CLICKTIONARY_WORDS_RESPONSE',
        words: data.wordBank || []
      }, BRIDGE_ORIGIN);
    });
  }

  if (type === 'CLICKTIONARY_SAVE_WORDS') {
    chrome.storage.local.set({ wordBank: payload.words }, () => {
      window.postMessage({ type: 'CLICKTIONARY_SAVE_RESPONSE', success: true }, BRIDGE_ORIGIN);
    });
  }

  if (type === 'CLICKTIONARY_DELETE_WORD') {
    chrome.storage.local.get('wordBank', (data) => {
      const words = (data.wordBank || []).filter(w => w.id !== payload.id);
      chrome.storage.local.set({ wordBank: words }, () => {
        window.postMessage({ type: 'CLICKTIONARY_DELETE_RESPONSE', success: true }, BRIDGE_ORIGIN);
      });
    });
  }

  if (type === 'CLICKTIONARY_UPDATE_WORD') {
    chrome.storage.local.get('wordBank', (data) => {
      const words = data.wordBank || [];
      const i = words.findIndex(w => w.id === payload.id);
      if (i > -1) words[i] = { ...words[i], ...payload.updates };
      chrome.storage.local.set({ wordBank: words }, () => {
        window.postMessage({ type: 'CLICKTIONARY_UPDATE_RESPONSE', success: true }, BRIDGE_ORIGIN);
      });
    });
  }

  if (type === 'CLICKTIONARY_GET_CUSTOM_LANGUAGES') {
    chrome.storage.local.get('customLanguages', (data) => {
      window.postMessage({
        type: 'CLICKTIONARY_CUSTOM_LANGUAGES_RESPONSE',
        customLanguages: data.customLanguages || []
      }, BRIDGE_ORIGIN);
    });
  }

  if (type === 'CLICKTIONARY_ADD_CUSTOM_LANGUAGE') {
    chrome.storage.local.get('customLanguages', (data) => {
      const existing = data.customLanguages || [];
      const code = `custom_${Date.now()}`;
      const newLang = { code, name: payload.name, flag: '📝' };
      existing.push(newLang);
      chrome.storage.local.set({ customLanguages: existing }, () => {
        window.postMessage({
          type: 'CLICKTIONARY_ADD_CUSTOM_LANGUAGE_RESPONSE',
          customLanguage: newLang
        }, BRIDGE_ORIGIN);
      });
    });
  }
});

// Signal to the page that the extension bridge is ready, including any stored session
chrome.storage.local.get('supabase_session', (data) => {
  window.postMessage({
    type: 'CLICKTIONARY_BRIDGE_READY',
    session: data.supabase_session || null
  }, BRIDGE_ORIGIN);
});
