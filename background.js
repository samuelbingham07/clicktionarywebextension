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
  return result.supabase_session || null;
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
  const session = await getSession();
  if (!session?.refresh_token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const data = await res.json();
  if (data.access_token) {
    await chrome.storage.local.set({ supabase_session: data });
    return data;
  }
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
    // Check duplicate first
    const existing = await supabaseFetch(
      `/words?spanish=eq.${encodeURIComponent(entry.spanish.toLowerCase())}&select=id`
    );
    if (existing && existing.length > 0) return true;

    // Get user id from session
    const userId = session.user?.id;
    if (!userId) {
      console.error('Clicktionary: no user id in session');
      return false;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/words`, {
      method: 'POST',
      headers: {
        ...(await getAuthHeaders()),
        'Prefer': 'return=minimal'
      },
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

    if (!res.ok) {
      const err = await res.text();
      console.error('Clicktionary: failed to save word:', res.status, err);
      return false;
    }
    return true;
  }

  // Fallback: local storage if not signed in
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
