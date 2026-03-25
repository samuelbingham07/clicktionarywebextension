// Clicktionary Content Script
// Detects highlighted text, fetches definitions, shows tooltip

let tooltip = null;
let hideTimeout = null;
let currentLanguage = 'es'; // default, updated from storage

const LANGUAGE_NAMES = {
  es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ar: 'Arabic'
};

// ── Keep language in sync with storage ──────────────────────────────────────
chrome.storage.local.get('selectedLanguage', (r) => {
  if (r.selectedLanguage) currentLanguage = r.selectedLanguage;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('selectedLanguage' in changes) {
    currentLanguage = changes.selectedLanguage.newValue;
  }
});

// ── Create tooltip element ──────────────────────────────────────────────────
function createTooltip() {
  const el = document.createElement('div');
  el.id = 'clicktionary-tooltip';
  el.innerHTML = `
    <div class="ct-header">
      <div class="ct-header-left">
        <span class="ct-lang"></span>
        <span class="ct-word"></span>
      </div>
      <button class="ct-close">✕</button>
    </div>
    <div class="ct-body">
      <div class="ct-loading">Looking up...</div>
      <div class="ct-result" style="display:none">
        <div class="ct-pos"></div>
        <div class="ct-definition"></div>
        <div class="ct-examples"></div>
      </div>
      <div class="ct-error" style="display:none">
        <div class="ct-error-msg">Add failed — no definition found.</div>
        <div class="ct-error-sub">Enter your own to save this word:</div>
        <input class="ct-custom-input" placeholder="Enter your own definition…" />
      </div>
    </div>
    <div class="ct-footer">
      <button class="ct-add-btn">＋ Add to Word Bank</button>
      <span class="ct-saved-msg">✓ Saved!</span>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('.ct-close').addEventListener('click', hideTooltip);
  el.querySelector('.ct-add-btn').addEventListener('click', () => addToWordBank());
  el.querySelector('.ct-custom-input').addEventListener('input', (e) => {
    el.querySelector('.ct-add-btn').style.display = e.target.value.trim() ? 'inline-flex' : 'none';
  });
  el.querySelector('.ct-custom-input').addEventListener('mousedown', (e) => e.stopPropagation());
  return el;
}

function getTooltip() {
  if (!tooltip) tooltip = createTooltip();
  return tooltip;
}

// ── Position tooltip ────────────────────────────────────────────────────────
function positionTooltip(rect) {
  const t = getTooltip();
  const margin = 10;
  let top = rect.bottom + window.scrollY + margin;
  let left = rect.left + window.scrollX;

  t.style.display = 'block';
  t.style.visibility = 'hidden';

  const tWidth = t.offsetWidth || 300;
  const maxLeft = window.scrollX + window.innerWidth - tWidth - margin;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  if (top + 200 > window.scrollY + window.innerHeight) {
    top = rect.top + window.scrollY - 200 - margin;
  }

  t.style.top = `${top}px`;
  t.style.left = `${left}px`;
  t.style.visibility = 'visible';
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

// ── Translation helpers ──────────────────────────────────────────────────────

// Lingva Translate: Google Translate quality, free, no API key
const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
];

const MYMEMORY_CODES = { zh: 'zh-CN' };

function fetchWithTimeout(url, ms = 2000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

// ── Translation cache (in-memory; reset on extension reload) ────────────────
const defCache = new Map();

// ── Fetch translation (Lingva primary, MyMemory fallback) ───────────────────
async function fetchDefinition(word, langCode) {
  const cacheKey = `${langCode}:${word.toLowerCase()}`;
  if (defCache.has(cacheKey)) return defCache.get(cacheKey);
  const clean = word.trim();
  const encoded = encodeURIComponent(clean);

  // 1. Race all Lingva instances in parallel — first valid response wins
  const lingva = await Promise.any(
    LINGVA_INSTANCES.map(base =>
      fetchWithTimeout(`${base}/api/v1/${langCode}/en/${encoded}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
          const t = data?.translation;
          if (!t || t.toLowerCase() === clean.toLowerCase()) return Promise.reject();
          return t;
        })
    )
  ).catch(() => null);

  if (lingva) {
    const result = { word: clean, pos: '', definition: lingva, example: '' };
    defCache.set(cacheKey, result);
    return result;
  }

  // 2. Fallback: MyMemory
  try {
    const mmCode = MYMEMORY_CODES[langCode] || langCode;
    const r = await fetchWithTimeout(
      `https://api.mymemory.translated.net/get?q=${encoded}&langpair=${mmCode}|en`
    );
    if (r.ok) {
      const data = await r.json();
      const t = data?.responseData?.translatedText;
      if (t && t.toLowerCase() !== clean.toLowerCase()) {
        const result = { word: clean, pos: '', definition: t, example: '' };
        defCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (_) {}

  defCache.set(cacheKey, null);
  return null;
}

// ── Detect if text could be in selected language ────────────────────────────
function couldBeSelectedLanguage(text, langCode) {
  // For CJK and non-latin scripts, check for appropriate unicode ranges
  if (langCode === 'zh') return /[\u4e00-\u9fff]/.test(text);
  if (langCode === 'ja') return /[\u3040-\u30ff\u4e00-\u9fff]/.test(text);
  if (langCode === 'ko') return /[\uac00-\ud7af]/.test(text);
  if (langCode === 'ar') return /[\u0600-\u06ff]/.test(text);
  if (langCode === 'ru') return /[\u0400-\u04ff]/.test(text);
  // Latin-script languages — just check for letters
  return /[a-zA-ZÀ-ž]/.test(text);
}

// ── Main: handle text selection ─────────────────────────────────────────────
let lastWord = '';
let lastDefinition = null;
let selectionDebounce = null;
let requestId = 0; // incremented on every new mouseup; stale async calls check this

document.addEventListener('mouseup', (e) => {
  if (e.target.closest('#clicktionary-tooltip')) return;

  clearTimeout(selectionDebounce);
  clearTimeout(hideTimeout);
  const myId = ++requestId;

  // Debounce 50ms so the final mouseup of a double-click wins.
  // Reading storage inside the timeout means the value is always fresh —
  // no race condition if the user toggles off and highlights immediately.
  selectionDebounce = setTimeout(() => {
    if (myId !== requestId) return;
    try {
      chrome.storage.local.get('extensionOff', (r) => {
        if (myId !== requestId) return;
        if (r.extensionOff) { hideTooltip(); return; }
        handleSelection(myId);
      });
    } catch (_) {
      // Extension context invalidated (e.g. after a reload) — show tooltip anyway
      handleSelection(myId);
    }
  }, 50);
});

async function handleSelection(myId) {
  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (!text || text.length < 1 || text.length > 100) {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hideTooltip, 200);
    return;
  }

  if (!couldBeSelectedLanguage(text, currentLanguage)) return;

  clearTimeout(hideTimeout);

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const t = getTooltip();
  lastWord = text;
  lastDefinition = null;

  t.querySelector('.ct-lang').textContent = LANGUAGE_NAMES[currentLanguage] || '';
  t.querySelector('.ct-word').textContent = text;
  t.querySelector('.ct-loading').style.display = 'block';
  t.querySelector('.ct-result').style.display = 'none';
  t.querySelector('.ct-error').style.display = 'none';
  t.querySelector('.ct-saved-msg').style.display = 'none';
  t.querySelector('.ct-add-btn').style.display = 'none';

  positionTooltip(rect);

  const def = await fetchDefinition(text, currentLanguage);

  // If a newer mouseup fired while we were fetching, discard this result
  if (myId !== requestId) return;

  lastDefinition = def;
  t.querySelector('.ct-loading').style.display = 'none';

  if (def) {
    t.querySelector('.ct-pos').textContent = def.pos ? `(${def.pos})` : '';
    t.querySelector('.ct-definition').textContent = def.definition;
    t.querySelector('.ct-examples').textContent = def.example ? `"${def.example}"` : '';
    t.querySelector('.ct-result').style.display = 'block';
    t.querySelector('.ct-add-btn').style.display = 'inline-flex';
  } else {
    t.querySelector('.ct-custom-input').value = '';
    t.querySelector('.ct-error').style.display = 'block';
    // add button stays hidden until user types their own definition
  }
}

// ── Add to Word Bank ────────────────────────────────────────────────────────
async function addToWordBank() {
  if (!lastWord) return;

  const t = getTooltip();
  const customInput = t.querySelector('.ct-custom-input');
  const english = lastDefinition?.definition || customInput.value.trim();

  const entry = {
    id: Date.now(),
    spanish: lastWord,
    english,
    pos: lastDefinition?.pos || '',
    language: currentLanguage,
    addedAt: new Date().toISOString(),
    strength: 0
  };

  chrome.runtime.sendMessage({ type: 'ADD_WORD', entry }, (response) => {
    if (response?.success) {
      const t = getTooltip();
      t.querySelector('.ct-add-btn').style.display = 'none';
      t.querySelector('.ct-saved-msg').style.display = 'inline';
    }
  });
}

// ── Close on outside click + speculative prefetch ───────────────────────────
document.addEventListener('mousedown', (e) => {
  if (tooltip && !e.target.closest('#clicktionary-tooltip')) {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hideTooltip, 150);
  }

  // Speculatively warm the cache: if there's already a selection when the user
  // clicks (e.g. double-click in progress), kick off the fetch immediately so
  // the result may be ready by the time mouseup fires.
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (text && text.length >= 1 && text.length <= 100 && couldBeSelectedLanguage(text, currentLanguage)) {
    const key = `${currentLanguage}:${text.toLowerCase()}`;
    if (!defCache.has(key)) fetchDefinition(text, currentLanguage);
  }
});
