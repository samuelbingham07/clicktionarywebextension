// Clicktionary Background Service Worker
// Handles auth and word bank storage via Supabase

const SUPABASE_URL = 'https://incvqtbkfntzdvbingqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluY3ZxdGJrZm50emR2YmluZ3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTc3NzAsImV4cCI6MjA4OTg5Mzc3MH0.QCIoHwvt41QcLJ3ilSezTntNGzXyFFpHQf-7kz6mKzU';

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
