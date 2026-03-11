// Clicktionary Content Script
// Detects highlighted Spanish text, fetches definitions, shows tooltip

let tooltip = null;
let hideTimeout = null;

// ── Create tooltip element ──────────────────────────────────────────────────
function createTooltip() {
  const el = document.createElement('div');
  el.id = 'clicktionary-tooltip';
  el.innerHTML = `
    <div class="ct-header">
      <span class="ct-word"></span>
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

// ── Position tooltip near selection ────────────────────────────────────────
function positionTooltip(rect) {
  const t = getTooltip();
  const margin = 10;
  let top = rect.bottom + window.scrollY + margin;
  let left = rect.left + window.scrollX;

  t.style.display = 'block';
  t.style.visibility = 'hidden';

  // Keep within viewport
  const tWidth = t.offsetWidth || 300;
  const maxLeft = window.scrollX + window.innerWidth - tWidth - margin;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  // If below fold, show above selection
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

// ── Fetch definition from MyMemory / Free Dictionary API ───────────────────
async function fetchDefinition(word) {
  const clean = word.trim().toLowerCase();

  // Try Free Dictionary API first (works for single words)
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/es/${encodeURIComponent(clean)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]) {
        const entry = data[0];
        const meaning = entry.meanings?.[0];
        return {
          word: entry.word,
          pos: meaning?.partOfSpeech || '',
          definition: meaning?.definitions?.[0]?.definition || '',
          example: meaning?.definitions?.[0]?.example || '',
          source: 'dictionary'
        };
      }
    }
  } catch (_) {}

  // Fallback: MyMemory Translation API (good for phrases too)
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=es|en`
    );
    if (res.ok) {
      const data = await res.json();
      const translation = data?.responseData?.translatedText;
      if (translation && translation.toLowerCase() !== clean) {
        return {
          word: clean,
          pos: '',
          definition: translation,
          example: '',
          source: 'translation'
        };
      }
    }
  } catch (_) {}

  return null;
}

// ── Main: handle text selection ─────────────────────────────────────────────
let lastWord = '';
let lastDefinition = null;

document.addEventListener('mouseup', async (e) => {
  // Don't trigger inside our own tooltip
  if (e.target.closest('#clicktionary-tooltip')) return;

  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (!text || text.length < 2 || text.length > 100) {
    // Small delay so clicking inside tooltip doesn't close it
    hideTimeout = setTimeout(hideTooltip, 200);
    return;
  }

  // Basic check: does it look like it could be Spanish?
  // (Contains at least one letter, allow accented chars)
  if (!/[a-záéíóúüñ]/i.test(text)) return;

  clearTimeout(hideTimeout);

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const t = getTooltip();
  lastWord = text;
  lastDefinition = null;

  // Reset UI
  t.querySelector('.ct-word').textContent = text;
  t.querySelector('.ct-loading').style.display = 'block';
  t.querySelector('.ct-result').style.display = 'none';
  t.querySelector('.ct-error').style.display = 'none';
  t.querySelector('.ct-saved-msg').style.display = 'none';
  t.querySelector('.ct-add-btn').style.display = 'inline-flex';

  positionTooltip(rect);

  const def = await fetchDefinition(text);
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
});

// ── Add to Word Bank ────────────────────────────────────────────────────────
async function addToWordBank() {
  if (!lastWord) return;

  const entry = {
    id: Date.now(),
    spanish: lastWord,
    english: lastDefinition?.definition || '',
    pos: lastDefinition?.pos || '',
    addedAt: new Date().toISOString(),
    nextReview: new Date().toISOString(),
    strength: 0   // 0-5 mastery score
  };

  // Load existing bank
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
