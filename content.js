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

// ── Keep local state in sync with storage ───────────────────────────────────
// isEnabled mirrors storage so the mouseup check is always synchronous
let isEnabled = true; // default on until storage is read

chrome.storage.local.get(['extensionEnabled', 'selectedLanguage'], (r) => {
  // extensionEnabled=true in storage means the user toggled Off (inverted semantics)
  isEnabled = r.extensionEnabled !== true;
  if (r.selectedLanguage) currentLanguage = r.selectedLanguage;
});

// Stay in sync whenever popup changes the toggle or language
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('extensionEnabled' in changes) {
    isEnabled = changes.extensionEnabled.newValue !== true;
  }
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
      <div class="ct-error" style="display:none">Could not find definition.</div>
    </div>
    <div class="ct-footer">
      <button class="ct-add-btn">＋ Add to Word Bank</button>
      <span class="ct-saved-msg">✓ Saved!</span>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('.ct-close').addEventListener('click', hideTooltip);
  el.querySelector('.ct-add-btn').addEventListener('click', () => addToWordBank());
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

// ── Fetch translation (Lingva primary, MyMemory fallback) ───────────────────
async function fetchDefinition(word, langCode) {
  const clean = word.trim();

  // 1. Try Lingva Translate instances
  for (const base of LINGVA_INSTANCES) {
    try {
      const res = await fetchWithTimeout(
        `${base}/api/v1/${langCode}/en/${encodeURIComponent(clean)}`
      );
      if (res.ok) {
        const data = await res.json();
        const translation = data?.translation;
        if (translation && translation.toLowerCase() !== clean.toLowerCase()) {
          return { word: clean, pos: '', definition: translation, example: '' };
        }
      }
    } catch (_) {}
  }

  // 2. Fallback: MyMemory
  try {
    const mmCode = MYMEMORY_CODES[langCode] || langCode;
    const res = await fetchWithTimeout(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=${mmCode}|en`
    );
    if (res.ok) {
      const data = await res.json();
      const translation = data?.responseData?.translatedText;
      if (translation && translation.toLowerCase() !== clean.toLowerCase()) {
        return { word: clean, pos: '', definition: translation, example: '' };
      }
    }
  } catch (_) {}

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

document.addEventListener('mouseup', (e) => {
  if (e.target.closest('#clicktionary-tooltip')) return;

  // Debounce: the first mouseup of a double-click fires before the selection
  // settles. Cancel + restart so only the final event in a rapid sequence runs.
  clearTimeout(selectionDebounce);
  clearTimeout(hideTimeout);

  selectionDebounce = setTimeout(() => {
    if (!isEnabled) return; // synchronous check — no async needed
    handleSelection(e);
  }, 50);
});

async function handleSelection(e) {

  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (!text || text.length < 1 || text.length > 100) {
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

  // Show language label in header
  t.querySelector('.ct-lang').textContent = LANGUAGE_NAMES[currentLanguage] || '';
  t.querySelector('.ct-word').textContent = text;
  t.querySelector('.ct-loading').style.display = 'block';
  t.querySelector('.ct-result').style.display = 'none';
  t.querySelector('.ct-error').style.display = 'none';
  t.querySelector('.ct-saved-msg').style.display = 'none';
  t.querySelector('.ct-add-btn').style.display = 'inline-flex';

  positionTooltip(rect);

  const def = await fetchDefinition(text, currentLanguage);
  lastDefinition = def;

  t.querySelector('.ct-loading').style.display = 'none';

  if (def) {
    t.querySelector('.ct-pos').textContent = def.pos ? `(${def.pos})` : '';
    t.querySelector('.ct-definition').textContent = def.definition;
    t.querySelector('.ct-examples').textContent = def.example ? `"${def.example}"` : '';
    t.querySelector('.ct-result').style.display = 'block';
  } else {
    t.querySelector('.ct-error').style.display = 'block';
  }
}

// ── Add to Word Bank ────────────────────────────────────────────────────────
async function addToWordBank() {
  if (!lastWord) return;

  const entry = {
    id: Date.now(),
    spanish: lastWord,         // column is named 'spanish' in DB but holds any language
    english: lastDefinition?.definition || '',
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

// ── Close on outside click ──────────────────────────────────────────────────
document.addEventListener('mousedown', (e) => {
  if (tooltip && !e.target.closest('#clicktionary-tooltip')) {
    hideTimeout = setTimeout(hideTooltip, 150);
  }
});
