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
        <div class="ct-translation"></div>
        <div class="ct-pos"></div>
        <div class="ct-definition"></div>
        <div class="ct-examples"></div>
      </div>
      <div class="ct-error" style="display:none">
        <div class="ct-error-msg">No definition found.</div>
        <div class="ct-error-sub">Enter your own to save this word:</div>
        <input class="ct-custom-input" placeholder="Enter your own definition…" />
      </div>
    </div>
    <div class="ct-footer">
      <button class="ct-add-btn">＋ Add to Word Bank</button>
      <button class="ct-quizlet-btn" title="Send to Quizlet">Q</button>
      <span class="ct-saved-msg">✓ Saved!</span>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('.ct-close').addEventListener('click', hideTooltip);
  el.querySelector('.ct-add-btn').addEventListener('click', () => addToWordBank());
  el.querySelector('.ct-quizlet-btn').addEventListener('click', () => sendToQuizlet());
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

// ── Merriam-Webster Spanish-English Dictionary (Spanish only) ────────────────
const MW_SPANISH_KEY = '5caf730b-006d-45c5-99ed-6a3c136216cc';

// Strip attached clitic pronouns from Spanish verb forms so we can look up
// the base verb. Clitics attach to infinitives, gerunds, and imperatives.
// e.g. explicarme → explicar, diciéndote → diciendo, dámelo → da
const CLITIC_RE = /(?:me|te|se|nos|os|le|les|lo|la|los|las){1,2}$/i;
const VERB_STEM_RE = /(?:ar|er|ir|arse|erse|irse|ando|iendo|ándome|iéndome)$/i;

function stripClitics(word) {
  const w = word.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents for matching
  const stripped = w.replace(CLITIC_RE, '');
  if (stripped === w || stripped.length < 2) return null;
  // Only return if what's left looks like a verb form
  return VERB_STEM_RE.test(stripped) ? stripped : null;
}

async function mwLookup(word) {
  const r = await fetchWithTimeout(
    `https://www.dictionaryapi.com/api/v3/references/spanish/json/${encodeURIComponent(word)}?key=${MW_SPANISH_KEY}`,
    3000
  );
  if (!r.ok) return null;
  const data = await r.json();
  if (!data?.length || typeof data[0] === 'string') return null;

  const entry = data[0];
  const pos = entry.fl || '';
  const gram = entry.gram || '';
  const defs = entry.shortdef || [];
  const infinitive = entry.cxs?.[0]?.cxtis?.[0]?.cxt || null;

  if (!defs.length && !infinitive) return null;
  return { pos, gram, infinitive, meanings: defs.map(d => ({ pos, text: d })), example: '' };
}

async function fetchMerriamWebsterDefinition(word) {
  try {
    const clean = word.toLowerCase();

    // 1. Try exact word
    const exact = await mwLookup(clean);
    if (exact) return exact;

    // 2. Try stripping clitics and looking up the base verb
    const base = stripClitics(clean);
    if (base && base !== clean) {
      const result = await mwLookup(base);
      if (result) return { ...result, baseForm: base };
    }

    return null;
  } catch (_) {
    return null;
  }
}

// ── Fetch definition from Wiktionary for the original foreign word ───────────
// Looks up the word in English Wiktionary and extracts the section for
// the target language, giving us pos, definition, and examples in English.
async function fetchWiktionaryDefinition(word, langCode) {
  const WIKT_LANG = {
    es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese',
    ko: 'Korean', ar: 'Arabic'
  };
  const langName = WIKT_LANG[langCode];
  if (!langName) return null;

  try {
    const r = await fetchWithTimeout(
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word.toLowerCase())}`,
      3000
    );
    if (!r.ok) return null;
    const data = await r.json();

    // Response is keyed by language code; each value is an array of POS sections
    const sections = data[langCode];
    if (!sections?.length) return null;

    const stripHtml = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    // Collect up to 3 definitions across all POS sections
    const meanings = [];
    for (const section of sections) {
      const pos = section.partOfSpeech || '';
      for (const d of (section.definitions || [])) {
        if (meanings.length >= 3) break;
        const text = stripHtml(d.definition || '');
        if (text) meanings.push({ pos, text });
      }
      if (meanings.length >= 3) break;
    }

    if (!meanings.length) return null;

    // Primary example from the first definition that has one
    let example = '';
    for (const section of sections) {
      for (const d of (section.definitions || [])) {
        const ex = d.parsedExamples?.[0]?.example;
        if (ex) { example = stripHtml(ex); break; }
      }
      if (example) break;
    }

    return { pos: meanings[0].pos, meanings, example };
  } catch (_) {
    return null;
  }
}

// ── Fetch translation + dictionary definition in parallel ────────────────────
async function fetchDefinition(word, langCode) {
  const cacheKey = `${langCode}:${word.toLowerCase()}`;
  if (defCache.has(cacheKey)) return defCache.get(cacheKey);
  const clean = word.trim();
  const encoded = encodeURIComponent(clean);

  // Run translation and Wiktionary lookup simultaneously
  const [translation, dict] = await Promise.all([
    // Translation: Lingva (parallel race) → MyMemory fallback
    Promise.any(
      LINGVA_INSTANCES.map(base =>
        fetchWithTimeout(`${base}/api/v1/${langCode}/en/${encoded}`)
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(data => {
            const t = data?.translation;
            if (!t) return Promise.reject();
            return t;
          })
      )
    ).catch(async () => {
      try {
        const mmCode = MYMEMORY_CODES[langCode] || langCode;
        const r = await fetchWithTimeout(
          `https://api.mymemory.translated.net/get?q=${encoded}&langpair=${mmCode}|en`
        );
        if (r.ok) {
          const data = await r.json();
          const t = data?.responseData?.translatedText;
          if (t) return t;
        }
      } catch (_) {}
      return null;
    }),
    // Dictionary: MW for Spanish, Wiktionary for all other languages
    langCode === 'es'
      ? fetchMerriamWebsterDefinition(clean)
      : fetchWiktionaryDefinition(clean, langCode)
  ]);

  if (!translation && !dict) {
    defCache.set(cacheKey, null);
    return null;
  }

  const result = { word: clean, translation: translation || '', dict };
  defCache.set(cacheKey, result);
  return result;
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

// ── Page scan: prefetch definitions for hard words ──────────────────────────

function extractHardWords(langCode) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  const words = [];
  let node;

  while ((node = walker.nextNode()) && words.length < 300) {
    // Skip script/style content
    const parent = node.parentElement?.tagName;
    if (parent === 'SCRIPT' || parent === 'STYLE' || parent === 'NOSCRIPT') continue;

    const text = node.textContent;
    let matches;

    if (langCode === 'zh' || langCode === 'ja') {
      matches = text.match(/[\u4e00-\u9fff\u3040-\u30ff]{2,4}/g) || [];
    } else if (langCode === 'ko') {
      matches = text.match(/[\uac00-\ud7af]{2,6}/g) || [];
    } else if (langCode === 'ar') {
      matches = text.match(/[\u0600-\u06ff]{4,}/g) || [];
    } else if (langCode === 'ru') {
      matches = text.match(/[\u0400-\u04ff]{5,}/g) || [];
    } else {
      // Latin-script: 7+ chars filters out articles, prepositions, common short words
      matches = text.match(/[a-zA-ZÀ-ž]{7,}/g) || [];
    }

    for (const w of matches) {
      const lc = w.toLowerCase();
      if (!seen.has(lc)) {
        seen.add(lc);
        words.push(w);
      }
    }
  }

  // Longer words are statistically less common → harder vocabulary
  return words.sort((a, b) => b.length - a.length).slice(0, 10);
}

async function prefetchHardWords() {
  // Wait for page to settle and for storage read to complete
  await new Promise(r => setTimeout(r, 2000));

  chrome.storage.local.get('extensionOff', async (r) => {
    if (r.extensionOff) return;

    const words = extractHardWords(currentLanguage);
    for (const word of words) {
      const key = `${currentLanguage}:${word.toLowerCase()}`;
      if (!defCache.has(key)) {
        fetchDefinition(word, currentLanguage); // fire and forget
        await new Promise(r => setTimeout(r, 500)); // stagger to avoid rate limits
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', prefetchHardWords);
} else {
  prefetchHardWords();
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
  t.querySelector('.ct-quizlet-btn').style.display = 'none';

  positionTooltip(rect);

  const def = await fetchDefinition(text, currentLanguage);

  // If a newer mouseup fired while we were fetching, discard this result
  if (myId !== requestId) return;

  lastDefinition = def;
  t.querySelector('.ct-loading').style.display = 'none';

  if (def) {
    t.querySelector('.ct-translation').textContent = def.translation || '';

    const { dict } = def;
    if (dict) {
      // Part of speech + gender (e.g. "noun · masculine"), with base form if clitics stripped
      const posLabel = [dict.pos, dict.gram].filter(Boolean).join(' · ');
      const baseNote = dict.baseForm ? ` · from ${dict.baseForm}` : '';
      t.querySelector('.ct-pos').textContent = posLabel ? `(${posLabel}${baseNote})` : '';

      // For conjugated verbs MW returns the infinitive instead of definitions
      if (dict.infinitive && !dict.meanings?.length) {
        t.querySelector('.ct-definition').textContent = `→ ${dict.infinitive}`;
      } else if (dict.meanings?.length) {
        const lines = dict.meanings.map((m, i) => `${i + 1}. ${m.text}`);
        t.querySelector('.ct-definition').textContent = lines.join('\n');
      } else {
        t.querySelector('.ct-definition').textContent = '';
      }

      t.querySelector('.ct-examples').textContent = dict.example ? `"${dict.example}"` : '';
    } else {
      t.querySelector('.ct-pos').textContent = '';
      t.querySelector('.ct-definition').textContent = '';
      t.querySelector('.ct-examples').textContent = '';
    }

    t.querySelector('.ct-result').style.display = 'block';
    t.querySelector('.ct-add-btn').style.display = 'inline-flex';
    t.querySelector('.ct-quizlet-btn').style.display = 'inline-flex';
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
  const english = lastDefinition?.translation || customInput.value.trim();

  const entry = {
    id: Date.now(),
    spanish: lastWord,
    english,
    pos: lastDefinition?.dict?.pos || '',
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

// ── Send to Quizlet ─────────────────────────────────────────────────────────
async function sendToQuizlet() {
  if (!lastWord) return;
  const t = getTooltip();
  const customInput = t.querySelector('.ct-custom-input');
  const definition = lastDefinition?.translation || customInput.value.trim();
  if (!definition) return;

  const btn = t.querySelector('.ct-quizlet-btn');
  btn.textContent = '...';
  btn.disabled = true;

  chrome.runtime.sendMessage(
    { type: 'SEND_TO_QUIZLET', term: lastWord, definition },
    (response) => {
      if (response?.success) {
        btn.textContent = '✓';
        setTimeout(() => {
          btn.textContent = 'Q';
          btn.disabled = false;
        }, 2000);
      } else {
        btn.textContent = '✕';
        btn.title = response?.error || 'Failed to send to Quizlet';
        setTimeout(() => {
          btn.textContent = 'Q';
          btn.title = 'Send to Quizlet';
          btn.disabled = false;
        }, 2500);
      }
    }
  );
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
