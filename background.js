// SpanishLens Background Service Worker
// Handles word bank storage

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ADD_WORD') {
    addWord(message.entry).then(success => sendResponse({ success }));
    return true; // keep channel open for async
  }

  if (message.type === 'GET_WORDS') {
    getWords().then(words => sendResponse({ words }));
    return true;
  }

  if (message.type === 'DELETE_WORD') {
    deleteWord(message.id).then(success => sendResponse({ success }));
    return true;
  }

  if (message.type === 'UPDATE_WORD') {
    updateWord(message.id, message.updates).then(success => sendResponse({ success }));
    return true;
  }
});

async function getWords() {
  const result = await chrome.storage.local.get('wordBank');
  return result.wordBank || [];
}

async function addWord(entry) {
  try {
    const words = await getWords();
    // Avoid duplicates (same Spanish word)
    const exists = words.find(w => w.spanish.toLowerCase() === entry.spanish.toLowerCase());
    if (exists) return true; // already in bank, still success
    words.push(entry);
    await chrome.storage.local.set({ wordBank: words });
    return true;
  } catch (e) {
    console.error('SpanishLens: Failed to add word', e);
    return false;
  }
}

async function deleteWord(id) {
  try {
    const words = await getWords();
    const filtered = words.filter(w => w.id !== id);
    await chrome.storage.local.set({ wordBank: filtered });
    return true;
  } catch (e) {
    return false;
  }
}

async function updateWord(id, updates) {
  try {
    const words = await getWords();
    const idx = words.findIndex(w => w.id === id);
    if (idx === -1) return false;
    words[idx] = { ...words[idx], ...updates };
    await chrome.storage.local.set({ wordBank: words });
    return true;
  } catch (e) {
    return false;
  }
}
