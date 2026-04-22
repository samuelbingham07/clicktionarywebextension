// Clicktionary Background Service Worker
// Handles auth and word bank storage via Supabase

const SUPABASE_URL = 'https://incvqtbkfntzdvbingqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluY3ZxdGJrZm50emR2YmluZ3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTc3NzAsImV4cCI6MjA4OTg5Mzc3MH0.QCIoHwvt41QcLJ3ilSezTntNGzXyFFpHQf-7kz6mKzU';

// ── Google OAuth ───────────────────────────────────────────────────────────────
// SETUP REQUIRED:
//   1. Google Cloud Console → APIs & Services → Credentials
//      → Create OAuth 2.0 Client ID → Web application
//      → Authorized redirect URIs: https://<your-extension-id>.chromiumapp.org/
//   2. Supabase Dashboard → Authentication → Providers → Google → Enable
//      → Paste the same Client ID + Client Secret
//   3. Replace the placeholder below with your actual Client ID
const GOOGLE_CLIENT_ID = '534128476683-9j6vsej1ree0pb431vl9kmd6ajkvr4qu.apps.googleusercontent.com';

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

async function signInWithGoogle() {
  if (GOOGLE_CLIENT_ID.startsWith('REPLACE_WITH')) {
    return { success: false, error: 'Google Client ID not configured. See background.js for setup instructions.' };
  }

  const nonce = generateNonce();
  const hashedNonce = await sha256hex(nonce);
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'token id_token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('nonce', hashedNonce); // Google encodes the hash; Supabase verifies with raw nonce
  authUrl.searchParams.set('prompt', 'select_account');

  return new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          const error = chrome.runtime.lastError?.message || 'Sign-in cancelled';
          await chrome.storage.local.set({ googleAuthError: error });
          resolve({ success: false, error });
          return;
        }
        try {
          const hash = new URL(redirectUrl).hash.substring(1);
          const params = new URLSearchParams(hash);
          const idToken = params.get('id_token');
          const accessToken = params.get('access_token');

          if (!idToken) {
            resolve({ success: false, error: 'No id_token received from Google.' });
            return;
          }

          // Exchange with Supabase using id_token grant
          const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=id_token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
              provider: 'google',
              id_token: idToken,
              access_token: accessToken,
              nonce: nonce  // raw (unhashed) nonce — Supabase hashes it to verify
            })
          });

          const data = await res.json();
          if (data.access_token) {
            await chrome.storage.local.set({ supabase_session: data });
            await chrome.storage.local.remove('googleAuthError');
            syncLocalWordsToSupabase();
            // Re-open the popup (it likely closed when the auth window opened)
            try { chrome.action.openPopup(); } catch (_) {}
            resolve({ success: true, user: data.user });
          } else {
            const error = data.error_description || data.msg || 'Google sign-in failed. Make sure Google is enabled in your Supabase dashboard.';
            await chrome.storage.local.set({ googleAuthError: error });
            resolve({ success: false, error });
          }
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      }
    );
  });
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function getSession() {
  const result = await chrome.storage.local.get('supabase_session');
  const session = result.supabase_session || null;
  if (!session) return null;
  // Auto-refresh if token is expired or about to expire (within 60s)
  if (session.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
    const refreshed = await refreshSession();
    return refreshed || null;
  }
  return session;
}

async function getAuthHeaders() {
  const session = await getSession();
  if (!session) return null;
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`
  };
}

async function supabaseFetch(path, options = {}) {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  if (!res.ok) {
    console.error('Supabase error:', res.status, await res.text());
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function signInWithEmail(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (data.access_token) {
    await chrome.storage.local.set({ supabase_session: data });
    syncLocalWordsToSupabase();
    return { success: true, user: data.user };
  }
  return { success: false, error: data.error_description || data.msg || 'Sign in failed' };
}

async function signUpWithEmail(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (data.access_token) {
    await chrome.storage.local.set({ supabase_session: data });
    syncLocalWordsToSupabase();
    return { success: true, user: data.user };
  }
  // If email confirmation required
  if (data.id) {
    return { success: true, needsConfirmation: true };
  }
  return { success: false, error: data.error_description || data.msg || 'Sign up failed' };
}

async function signOut() {
  const headers = await getAuthHeaders();
  if (headers) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST', headers
    }).catch(() => {});
  }
  await chrome.storage.local.remove('supabase_session');
  return { success: true };
}

async function refreshSession() {
  const result = await chrome.storage.local.get('supabase_session');
  const session = result.supabase_session || null;
  if (!session?.refresh_token) return null;
  try {
    const res = await Promise.race([
      fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]);
    const data = await res.json();
    if (data.access_token) {
      await chrome.storage.local.set({ supabase_session: data });
      return data;
    }
  } catch (_) {}
  return null;
}

// ── Word Bank ──────────────────────────────────────────────────────────────────

async function getWords() {
  // Try Supabase first
  const data = await supabaseFetch('/words?select=*&order=added_at.desc');
  if (data !== null) return data.map(row => ({
    id: row.id,
    spanish: row.spanish,
    english: row.english,
    pos: row.pos,
    strength: row.strength,
    language: row.language || 'es',
    addedAt: row.added_at
  }));

  // Fallback to local storage if not signed in
  const local = await chrome.storage.local.get('wordBank');
  return local.wordBank || [];
}

async function addWord(entry) {
  const session = await getSession();

  if (session) {
    // Try to refresh session first if it might be stale
    let headers = await getAuthHeaders();

    const trySupabaseInsert = async (hdrs) => {
      const userId = session.user?.id;
      if (!userId) return 'no_user';

      const res = await fetch(`${SUPABASE_URL}/rest/v1/words`, {
        method: 'POST',
        headers: { ...hdrs, 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({
          user_id: userId,
          spanish: entry.spanish.toLowerCase(),
          english: entry.english || '',
          pos: entry.pos || '',
          strength: 0,
          language: entry.language || 'es',
          added_at: new Date().toISOString()
        })
      });
      if (res.ok) return 'ok';
      if (res.status === 401) return '401';
      console.error('Clicktionary: failed to save word:', res.status, await res.text());
      return 'error';
    };

    let result = await trySupabaseInsert(headers);

    // On 401, attempt token refresh and retry once
    if (result === '401') {
      const refreshed = await refreshSession();
      if (refreshed) {
        headers = await getAuthHeaders();
        result = await trySupabaseInsert(headers);
      }
    }

    if (result === 'ok' || result === 'duplicate') return true;

    // Supabase failed — fall back to local storage so the word is not lost
    console.warn('Clicktionary: Supabase unavailable, saving locally');
  }

  // Local storage fallback (used when not signed in, or Supabase fails)
  try {
    const local = await chrome.storage.local.get('wordBank');
    const words = local.wordBank || [];
    const exists = words.find(w => w.spanish.toLowerCase() === entry.spanish.toLowerCase());
    if (exists) return true;
    words.push(entry);
    await chrome.storage.local.set({ wordBank: words });
    return true;
  } catch (e) {
    console.error('Clicktionary: local storage fallback failed', e);
    return false;
  }
}

async function syncLocalWordsToSupabase() {
  const local = await chrome.storage.local.get('wordBank');
  const words = local.wordBank || [];
  if (!words.length) return;

  const session = await getSession();
  if (!session?.user?.id) return;

  const headers = await getAuthHeaders();
  const userId = session.user.id;

  for (const word of words) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/words`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({
          user_id: userId,
          spanish: (word.spanish || '').toLowerCase(),
          english: word.english || '',
          pos: word.pos || '',
          strength: word.strength || 0,
          language: word.language || 'es',
          added_at: word.addedAt || new Date().toISOString()
        })
      });
    } catch (_) {}
  }

  await chrome.storage.local.remove('wordBank');
}

async function deleteWord(id) {
  const session = await getSession();
  if (session) {
    await supabaseFetch(`/words?id=eq.${id}`, { method: 'DELETE' });
    return true;
  }
  const local = await chrome.storage.local.get('wordBank');
  const words = (local.wordBank || []).filter(w => w.id !== id);
  await chrome.storage.local.set({ wordBank: words });
  return true;
}

async function updateWord(id, updates) {
  const session = await getSession();
  if (session) {
    const body = {};
    if (updates.strength !== undefined) body.strength = updates.strength;
    await supabaseFetch(`/words?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    return true;
  }
  const local = await chrome.storage.local.get('wordBank');
  const words = local.wordBank || [];
  const i = words.findIndex(w => w.id === id);
  if (i > -1) { words[i] = { ...words[i], ...updates }; await chrome.storage.local.set({ wordBank: words }); }
  return true;
}

// ── Quizlet integration ───────────────────────────────────────────────────────

const QUIZLET_EDITOR_PATTERNS = [
  /^https:\/\/quizlet\.com\/create-set/,
  /^https:\/\/quizlet\.com\/[^/]+\/edit/,
  /^https:\/\/quizlet\.com\/[^/]+\/autosaved/,
];

function isQuizletEditorTab(url) {
  return url && QUIZLET_EDITOR_PATTERNS.some(p => p.test(url));
}

// Runs in the page's MAIN world — same JS context as ProseMirror
// Must be declared async so chrome.scripting.executeScript awaits the result
async function quizletFillCard(term, definition) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  term = term.replace(/\.+$/, '').trim();
  definition = definition.replace(/\.+$/, '').trim();

  function allPm() {
    return [...document.querySelectorAll('[pm-placeholder]')];
  }
  function isDefinitionField(el) {
    const p = el.getAttribute('pm-placeholder').toLowerCase();
    return p.includes('definition') || p.includes('english');
  }
  function isTermField(el) { return !isDefinitionField(el); }
  function isEmpty(el) { return !el.textContent.trim(); }

  function fill(el, value) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    // Dispatch beforeinput — ProseMirror's primary input handler
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: value
    }));
    // Also try execCommand as fallback
    if (!el.textContent.trim()) {
      document.execCommand('insertText', false, value);
    }
  }

  // Find the last empty term field
  let termEl = allPm().filter(isTermField).reverse().find(isEmpty);

  if (!termEl) {
    // Click Add card
    const btn = [...document.querySelectorAll('button')].find(b => /add\s*(a\s*)?card/i.test(b.textContent));
    if (!btn) return { success: false, error: 'No "Add card" button found.' };
    const before = allPm().filter(isTermField).length;
    btn.click();
    for (let i = 0; i < 20; i++) {
      await wait(100);
      if (allPm().filter(isTermField).length > before) break;
    }
    termEl = allPm().filter(isTermField).reverse().find(isEmpty);
  }

  if (!termEl) return { success: false, error: 'No empty term slot found.' };

  // Mark the card's parent so we can find the definition field even after React re-renders
  const card = termEl.closest('li, [class*="TermRow"], [class*="SetEditorRow"]') || termEl.parentElement;
  card.setAttribute('data-ct-card', 'true');

  fill(termEl, term);
  await wait(300);

  // Find definition field within the same card by marker
  let defEl = null;
  for (let i = 0; i < 15; i++) {
    await wait(100);
    const markedCard = document.querySelector('[data-ct-card]');
    if (markedCard) {
      defEl = [...markedCard.querySelectorAll('[pm-placeholder]')].find(isDefinitionField);
    }
    // Fallback: scan all pm fields
    if (!defEl) defEl = allPm().find(el => isDefinitionField(el) && isEmpty(el));
    if (defEl) break;
  }
  if (card) card.removeAttribute('data-ct-card');

  if (!defEl) return { success: false, error: 'Definition field not found.' };

  fill(defEl, definition);
  await wait(200);

  return { success: true };
}

async function sendToQuizlet(term, definition) {
  const tabs = await chrome.tabs.query({ url: 'https://quizlet.com/*' });
  const editorTab = tabs.find(t => isQuizletEditorTab(t.url));

  if (editorTab) {
    await chrome.tabs.update(editorTab.id, { active: true });
    await chrome.windows.update(editorTab.windowId, { focused: true });
    // Small delay to let the tab come into focus before scripting
    await new Promise(r => setTimeout(r, 300));
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: editorTab.id },
        world: 'MAIN',
        func: quizletFillCard,
        args: [term, definition]
      });
      return results[0]?.result || { success: false, error: 'No result from script.' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // No editor tab — open create-set and queue the card
  await chrome.storage.local.set({ quizletPending: { term, definition } });
  chrome.tabs.create({ url: 'https://quizlet.com/create-set' });
  return { success: true, opened: true };
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SIGN_IN_GOOGLE') {
    signInWithGoogle().then(sendResponse);
    return true;
  }
  if (message.type === 'SIGN_IN') {
    signInWithEmail(message.email, message.password).then(sendResponse);
    return true;
  }
  if (message.type === 'SIGN_UP') {
    signUpWithEmail(message.email, message.password).then(sendResponse);
    return true;
  }
  if (message.type === 'SIGN_OUT') {
    signOut().then(sendResponse);
    return true;
  }
  if (message.type === 'GET_SESSION') {
    getSession().then(session => sendResponse({ session }));
    return true;
  }
  if (message.type === 'GET_ENABLED') {
    chrome.storage.local.get('extensionEnabled', (r) => {
      // Default to enabled (true) if never set
      sendResponse({ enabled: !!r.extensionEnabled });
    });
    return true;
  }
  if (message.type === 'SET_ENABLED') {
    chrome.storage.local.set({ extensionEnabled: message.enabled }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (message.type === 'GET_LANGUAGE') {
    chrome.storage.local.get('selectedLanguage', (r) => {
      sendResponse({ language: r.selectedLanguage || 'es' });
    });
    return true;
  }
  if (message.type === 'SET_LANGUAGE') {
    chrome.storage.local.set({ selectedLanguage: message.language }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (message.type === 'GET_CUSTOM_LANGUAGES') {
    chrome.storage.local.get('customLanguages', (r) => {
      sendResponse({ customLanguages: r.customLanguages || [] });
    });
    return true;
  }
  if (message.type === 'ADD_CUSTOM_LANGUAGE') {
    chrome.storage.local.get('customLanguages', (r) => {
      const existing = r.customLanguages || [];
      const code = `custom_${Date.now()}`;
      const newLang = { code, name: message.name, flag: '📝' };
      existing.push(newLang);
      chrome.storage.local.set({ customLanguages: existing }, () => {
        sendResponse({ code, language: newLang });
      });
    });
    return true;
  }
  if (message.type === 'SEND_TO_QUIZLET') {
    sendToQuizlet(message.term, message.definition).then(sendResponse);
    return true;
  }
  if (message.type === 'FILL_QUIZLET_PENDING') {
    const tabId = sender.tab.id;
    setTimeout(async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: quizletFillCard,
          args: [message.term, message.definition]
        });
      } catch (_) {}
    }, 1500);
    return false;
  }
  if (message.type === 'ADD_WORD') {
    addWord(message.entry).then(success => sendResponse({ success }));
    return true;
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
