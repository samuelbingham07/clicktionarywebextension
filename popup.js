// Clicktionary Popup Script

const WORDBANK_URL = 'https://samuelbingham07.github.io/clicktionarywebextension/';
const SUPABASE_URL = 'https://incvqtbkfntzdvbingqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluY3ZxdGJrZm50emR2YmluZ3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTc3NzAsImV4cCI6MjA4OTg5Mzc3MH0.QCIoHwvt41QcLJ3ilSezTntNGzXyFFpHQf-7kz6mKzU';

const LANGUAGES = [
  { code: 'es', name: 'Spanish',    flag: '🇪🇸' },
  { code: 'fr', name: 'French',     flag: '🇫🇷' },
  { code: 'de', name: 'German',     flag: '🇩🇪' },
  { code: 'it', name: 'Italian',    flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian',    flag: '🇷🇺' },
  { code: 'zh', name: 'Chinese',    flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese',   flag: '🇯🇵' },
  { code: 'ko', name: 'Korean',     flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic',     flag: '🇸🇦' },
];

let isSignUp = false;
let mainPanelSetup = false;
let currentLangCode = 'es'; // updated whenever language loads

// ── Translation helpers ──────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Lingva Translate (Google Translate quality, free, no API key)
const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
];

const MYMEMORY_CODES = { zh: 'zh-CN' };

async function translate(text, fromLang, toLang) {
  const clean = text.trim();
  if (!clean) return null;

  // 1. Try Lingva instances
  for (const base of LINGVA_INSTANCES) {
    try {
      const res = await fetchWithTimeout(
        `${base}/api/v1/${fromLang}/${toLang}/${encodeURIComponent(clean)}`
      );
      if (res.ok) {
        const data = await res.json();
        const t = data?.translation;
        if (t && t.toLowerCase() !== clean.toLowerCase()) return t;
      }
    } catch (_) {}
  }

  // 2. Fallback: MyMemory
  try {
    const from = MYMEMORY_CODES[fromLang] || fromLang;
    const to   = MYMEMORY_CODES[toLang]   || toLang;
    const res = await fetchWithTimeout(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=${from}|${to}`
    );
    if (res.ok) {
      const data = await res.json();
      const t = data?.responseData?.translatedText;
      if (t && t.toLowerCase() !== clean.toLowerCase()) return t;
    }
  } catch (_) {}

  return null;
}

document.addEventListener('DOMContentLoaded', async () => {
  // ── Enable/disable toggle (works regardless of sign-in state) ──
  chrome.storage.local.get('extensionOff', (r) => {
    setToggleUI(!r.extensionOff);
  });

  document.getElementById('enableToggle').addEventListener('change', (e) => {
    const on = e.target.checked;
    chrome.storage.local.set({ extensionOff: !on });
    setToggleUI(on);
  });

  // Check for a Google auth error stored while the popup was closed
  chrome.storage.local.get('googleAuthError', (r) => {
    if (r.googleAuthError) {
      chrome.storage.local.remove('googleAuthError');
      // Delay so authPanel is visible first
      setTimeout(() => showError(r.googleAuthError), 100);
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
    document.getElementById('loadingPanel').style.display = 'none';
    if (chrome.runtime.lastError || !response) {
      document.getElementById('authPanel').style.display = 'block';
      return;
    }
    if (response.session) {
      showMainPanel(response.session);
    } else {
      document.getElementById('authPanel').style.display = 'block';
    }
  });

  // If the popup stays open during auth, react as soon as the session is saved
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.supabase_session?.newValue) {
      const user = changes.supabase_session.newValue.user;
      document.getElementById('authPanel').style.display = 'none';
      document.getElementById('loadingPanel').style.display = 'none';
      showMainPanel(user);
    }
    if (changes.googleAuthError?.newValue) {
      chrome.storage.local.remove('googleAuthError');
      document.getElementById('loadingPanel').style.display = 'none';
      document.getElementById('authPanel').style.display = 'block';
      showError(changes.googleAuthError.newValue);
      // Reset the Google button
      const btn = document.getElementById('googleSignInBtn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google`;
      }
    }
  });

  // ── Google Sign In ──
  document.getElementById('googleSignInBtn').addEventListener('click', () => {
    const btn = document.getElementById('googleSignInBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    clearMessages();

    chrome.runtime.sendMessage({ type: 'SIGN_IN_GOOGLE' }, (res) => {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        Continue with Google`;
      if (res.success) {
        document.getElementById('authPanel').style.display = 'none';
        showMainPanel(res.user);
      } else {
        showError(res.error || 'Google sign-in failed. Please try again.');
      }
    });
  });

  // ── Auth tabs (Sign In ↔ Create Account) ──
  function setAuthTab(signUp) {
    isSignUp = signUp;
    document.getElementById('authSubmit').textContent = signUp ? 'Create Account' : 'Sign In';
    document.getElementById('tabSignIn').style.color = signUp ? '#aaa' : '#f0b400';
    document.getElementById('tabSignIn').style.borderBottomColor = signUp ? 'transparent' : '#f0b400';
    document.getElementById('tabSignUp').style.color = signUp ? '#f0b400' : '#aaa';
    document.getElementById('tabSignUp').style.borderBottomColor = signUp ? '#f0b400' : 'transparent';
    clearMessages();
  }
  document.getElementById('tabSignIn').addEventListener('click', () => setAuthTab(false));
  document.getElementById('tabSignUp').addEventListener('click', () => setAuthTab(true));

  // ── Submit auth form ──
  document.getElementById('authSubmit').addEventListener('click', async () => {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    clearMessages();

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    document.getElementById('authSubmit').textContent = 'Please wait...';
    document.getElementById('authSubmit').disabled = true;

    const type = isSignUp ? 'SIGN_UP' : 'SIGN_IN';
    chrome.runtime.sendMessage({ type, email, password }, (res) => {
      document.getElementById('authSubmit').disabled = false;
      document.getElementById('authSubmit').textContent = isSignUp ? 'Sign Up' : 'Sign In';

      if (res.success) {
        if (res.needsConfirmation) {
          showSuccess('Check your email to confirm your account, then sign in.');
          isSignUp = false;
          document.getElementById('authTitle').textContent = 'Sign in to Clicktionary';
          document.getElementById('authSubmit').textContent = 'Sign In';
        } else {
          document.getElementById('authPanel').style.display = 'none';
          showMainPanel(res.user);
        }
      } else {
        showError(res.error || 'Something went wrong. Please try again.');
      }
    });
  });

  document.getElementById('passwordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('authSubmit').click();
  });
});

function showError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.style.display = 'block';
}

function showSuccess(msg) {
  const el = document.getElementById('authSuccess');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearMessages() {
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authSuccess').style.display = 'none';
}

function setToggleUI(enabled) {
  document.getElementById('enableToggle').checked = enabled;
  const label = document.getElementById('toggleLabel');
  label.textContent = enabled ? 'On' : 'Off';
  label.className = 'toggle-label' + (enabled ? ' on' : '');
}

function setAddMsg(text, success) {
  const el = document.getElementById('addWordMsg');
  el.textContent = text;
  el.className = 'add-word-msg ' + (success ? 'success' : 'error');
}

function updateTranslateFromLabel() {
  const LANG_MAP = {};
  LANGUAGES.forEach(l => { LANG_MAP[l.code] = l; });
  const lang = LANG_MAP[currentLangCode];
  const code = lang ? lang.code.toUpperCase() : '→';
  document.getElementById('translateFromEn').textContent = `→ ${code}`;
  document.getElementById('addWordTarget').placeholder = `Word in ${lang ? lang.name : 'target language'}…`;
}

function showMainPanel(user) {
  document.getElementById('mainPanel').style.display = 'block';
  document.getElementById('userEmail').textContent = user.email || '';

  if (!mainPanelSetup) {
    mainPanelSetup = true;
    setupMainPanelListeners();
  }

  refreshLangAndWords();
}

function setupMainPanelListeners() {
  // ── Add Word manually ──
  document.getElementById('addWordToggle').addEventListener('click', () => {
    const form = document.getElementById('addWordForm');
    const isOpen = form.style.display !== 'none';
    form.style.display = isOpen ? 'none' : 'block';
    document.getElementById('addWordToggle').textContent = isOpen ? '＋ Add word manually' : '✕ Cancel';
    if (!isOpen) {
      document.getElementById('addWordMsg').textContent = '';
      document.getElementById('addWordMsg').className = 'add-word-msg';
    }
  });

  document.getElementById('translateToEn').addEventListener('click', async () => {
    const word = document.getElementById('addWordTarget').value.trim();
    if (!word) return;
    const btn = document.getElementById('translateToEn');
    btn.disabled = true;
    btn.textContent = '…';
    const result = await translate(word, currentLangCode, 'en');
    btn.disabled = false;
    btn.textContent = '→ EN';
    if (result) {
      document.getElementById('addWordEnglish').value = result;
    } else {
      setAddMsg('Could not translate — try typing it manually.', false);
    }
  });

  document.getElementById('translateFromEn').addEventListener('click', async () => {
    const word = document.getElementById('addWordEnglish').value.trim();
    if (!word) return;
    const btn = document.getElementById('translateFromEn');
    btn.disabled = true;
    btn.textContent = '…';
    const result = await translate(word, 'en', currentLangCode);
    btn.disabled = false;
    updateTranslateFromLabel();
    if (result) {
      document.getElementById('addWordTarget').value = result;
    } else {
      setAddMsg('Could not translate — try typing it manually.', false);
    }
  });

  document.getElementById('addWordSave').addEventListener('click', () => {
    const target = document.getElementById('addWordTarget').value.trim();
    const english = document.getElementById('addWordEnglish').value.trim();
    if (!target && !english) {
      setAddMsg('Enter at least one field.', false);
      return;
    }
    const entry = {
      id: Date.now(),
      spanish: target || english,   // 'spanish' column holds any language word
      english: english || '',
      pos: '',
      language: currentLangCode,
      addedAt: new Date().toISOString(),
      strength: 0
    };
    document.getElementById('addWordSave').disabled = true;
    chrome.runtime.sendMessage({ type: 'ADD_WORD', entry }, (response) => {
      document.getElementById('addWordSave').disabled = false;
      if (response?.success) {
        setAddMsg('✓ Saved!', true);
        document.getElementById('addWordTarget').value = '';
        document.getElementById('addWordEnglish').value = '';
        loadWords(currentLangCode);
      } else {
        setAddMsg('Failed to save. Try again.', false);
      }
    });
  });

  // ── Allow Enter key in add-word inputs ──
  document.getElementById('addWordTarget').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('addWordSave').click();
  });
  document.getElementById('addWordEnglish').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('addWordSave').click();
  });

  // Toggle language picker
  document.getElementById('langChangeBtn').addEventListener('click', () => {
    const picker = document.getElementById('langPicker');
    const btn = document.getElementById('langChangeBtn');
    const isOpen = picker.style.display !== 'none';
    picker.style.display = isOpen ? 'none' : 'block';
    btn.textContent = isOpen ? 'Change ▾' : 'Close ▴';
  });

  // Show new wordbank form
  document.getElementById('newWordBankBtn').addEventListener('click', () => {
    document.getElementById('newWordBankForm').style.display = 'flex';
    document.getElementById('newWordBankInput').focus();
  });

  // Allow Enter in new wordbank input
  document.getElementById('newWordBankInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('newWordBankSave').click();
  });

  // Save new wordbank
  document.getElementById('newWordBankSave').addEventListener('click', () => {
    const name = document.getElementById('newWordBankInput').value.trim();
    if (!name) return;
    chrome.runtime.sendMessage({ type: 'ADD_CUSTOM_LANGUAGE', name }, ({ code }) => {
      document.getElementById('newWordBankForm').style.display = 'none';
      document.getElementById('newWordBankInput').value = '';
      chrome.runtime.sendMessage({ type: 'SET_LANGUAGE', language: code }, () => {
        document.getElementById('langPicker').style.display = 'none';
        document.getElementById('langChangeBtn').textContent = 'Change ▾';
        refreshLangAndWords();
      });
    });
  });

  // Open word bank
  document.getElementById('openWordBank').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, ({ session }) => {
      if (session) {
        const token = encodeURIComponent(session.access_token);
        const refresh = encodeURIComponent(session.refresh_token);
        chrome.tabs.create({ url: `${WORDBANK_URL}#token=${token}&refresh=${refresh}` });
      }
    });
  });

  // Sign out
  document.getElementById('signOutBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, () => {
      document.getElementById('mainPanel').style.display = 'none';
      document.getElementById('authPanel').style.display = 'block';
      document.getElementById('emailInput').value = '';
      document.getElementById('passwordInput').value = '';
      clearMessages();
      mainPanelSetup = false;
    });
  });
}

function refreshLangAndWords() {
  chrome.runtime.sendMessage({ type: 'GET_LANGUAGE' }, ({ language }) => {
    chrome.runtime.sendMessage({ type: 'GET_CUSTOM_LANGUAGES' }, ({ customLanguages }) => {
      const allLanguages = [...LANGUAGES, ...(customLanguages || [])];
      const currentLang = allLanguages.find(l => l.code === language) || LANGUAGES[0];

      currentLangCode = language;

      // Update lang bar
      document.getElementById('langFlag').textContent = currentLang.flag;
      document.getElementById('langName').textContent = currentLang.name;
      document.getElementById('saveTip').textContent =
        `Highlight ${currentLang.name} text on any webpage to save words`;

      // Update add-word form labels
      updateTranslateFromLabel();

      // Build built-in lang grid
      const grid = document.getElementById('langGrid');
      grid.innerHTML = LANGUAGES.map(l => `
        <button class="lang-btn ${l.code === language ? 'active' : ''}" data-code="${l.code}" title="${l.name}">
          <span class="flag">${l.flag}</span>
          <span class="code">${l.code.toUpperCase()}</span>
        </button>
      `).join('');

      // Build custom lang list
      const customList = document.getElementById('customLangList');
      const custom = customLanguages || [];
      if (custom.length > 0) {
        customList.innerHTML = `<div class="lang-label" style="margin-top:8px">Custom wordbanks</div>` +
          custom.map(l => `
            <div class="custom-lang-item ${l.code === language ? 'active' : ''}" data-code="${l.code}">
              <span>${l.flag}</span>
              <span>${l.name}</span>
            </div>
          `).join('');
      } else {
        customList.innerHTML = '';
      }

      // Click handlers for built-in lang buttons
      grid.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const code = btn.dataset.code;
          chrome.runtime.sendMessage({ type: 'SET_LANGUAGE', language: code }, () => {
            document.getElementById('langPicker').style.display = 'none';
            document.getElementById('langChangeBtn').textContent = 'Change ▾';
            refreshLangAndWords();
          });
        });
      });

      // Click handlers for custom lang items
      customList.querySelectorAll('.custom-lang-item').forEach(item => {
        item.addEventListener('click', () => {
          const code = item.dataset.code;
          chrome.runtime.sendMessage({ type: 'SET_LANGUAGE', language: code }, () => {
            document.getElementById('langPicker').style.display = 'none';
            document.getElementById('langChangeBtn').textContent = 'Change ▾';
            refreshLangAndWords();
          });
        });
      });

      loadWords(language);
    });
  });
}

function loadWords(language) {
  chrome.runtime.sendMessage({ type: 'GET_WORDS' }, ({ words }) => {
    const filtered = words.filter(w => (w.language || 'es') === language);
    const total = filtered.length;
    const mastered = filtered.filter(w => w.strength >= 4).length;

    document.getElementById('totalWords').textContent = total;
    document.getElementById('masteredWords').textContent = mastered;

    // Language breakdown across all words
    const breakdown = document.getElementById('langBreakdown');
    const counts = {};
    words.forEach(w => { const l = w.language || 'es'; counts[l] = (counts[l] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (entries.length > 1) {
      const LANG_MAP = {};
      LANGUAGES.forEach(l => { LANG_MAP[l.code] = l; });
      breakdown.style.display = 'flex';
      breakdown.innerHTML = entries.map(([code, n]) => {
        const l = LANG_MAP[code];
        return `<span style="font-size:10px;font-family:Arial,sans-serif;background:#fffde7;border:1px solid #f0d9a0;border-radius:4px;padding:2px 6px;color:#764c0f">${l ? l.flag + ' ' : ''}${n}</span>`;
      }).join('');
    } else {
      breakdown.style.display = 'none';
    }

    const list = document.getElementById('wordList');
    if (total === 0) {
      list.innerHTML = '<div class="empty-state">No words yet — highlight some text!</div>';
      return;
    }

    const recent = filtered.slice(0, 5);
    list.innerHTML = recent.map(w => `
      <div class="word-item">
        <span class="word-es">${w.spanish}</span>
        <span class="word-en">${w.english || '—'}</span>
      </div>
    `).join('');
  });
}
