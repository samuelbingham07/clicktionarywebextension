// Clicktionary — Quizlet integration content script
// Injected into quizlet.com set editor pages

// Fill a React-controlled input, textarea, or contenteditable element
function fillInput(el, value) {
  el.focus();

  if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
    // contenteditable: select all then insert
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, value);
    return;
  }

  // input / textarea: try execCommand first (works with React's synthetic events)
  if (el.setSelectionRange) el.setSelectionRange(0, el.value.length);
  const inserted = document.execCommand('insertText', false, value);

  if (!inserted || el.value !== value) {
    // Fallback: native prototype setter
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// All selectors to try for term inputs — includes contenteditable
const TERM_SELECTORS = [
  'textarea[placeholder*="Term"]',
  'textarea[placeholder*="term"]',
  'input[placeholder*="Term"]',
  'input[placeholder*="term"]',
  '[aria-label*="Term"]',
  '[data-testid*="term"]',
  '[contenteditable="true"][aria-label*="Term"]',
  '[contenteditable="true"][aria-label*="term"]',
  '[contenteditable="true"][placeholder*="Term"]',
  '[contenteditable="true"][placeholder*="term"]',
];

const DEF_SELECTORS = [
  'textarea[placeholder*="Definition"]',
  'textarea[placeholder*="definition"]',
  'input[placeholder*="Definition"]',
  'input[placeholder*="definition"]',
  '[aria-label*="Definition"]',
  '[aria-label*="definition"]',
  '[contenteditable="true"][aria-label*="Definition"]',
  '[contenteditable="true"][aria-label*="definition"]',
  '[contenteditable="true"][placeholder*="Definition"]',
  '[contenteditable="true"][placeholder*="definition"]',
];

function findAll(selectors) {
  for (const sel of selectors) {
    const els = [...document.querySelectorAll(sel)];
    if (els.length) return { sel, els };
  }
  return null;
}

function isEmpty(el) {
  return !(el.value || el.textContent || '').trim();
}

function findLastEmptyTermInput() {
  const found = findAll(TERM_SELECTORS);
  if (!found) {
    console.log('[Clicktionary] No term inputs found. Tried:', TERM_SELECTORS);
    return null;
  }
  console.log(`[Clicktionary] Found ${found.els.length} term inputs via "${found.sel}"`);
  for (let i = found.els.length - 1; i >= 0; i--) {
    if (isEmpty(found.els[i])) return found.els[i];
  }
  return null;
}

function findDefinitionInput(termEl) {
  // Try within the same card row first
  const row = termEl.closest(
    '[class*="Row"], [class*="Card"], [class*="card"], [class*="row"], li, [data-testid*="card"]'
  );
  if (row) {
    const found = findAll(DEF_SELECTORS.map(s => s)); // search within row
    if (found) {
      const inRow = found.els.find(el => row.contains(el));
      if (inRow) return inRow;
    }
  }

  // Fallback: next focusable input/textarea/contenteditable in document order
  const all = [...document.querySelectorAll(
    'textarea, input[type="text"], [contenteditable="true"]'
  )];
  const idx = all.indexOf(termEl);
  console.log(`[Clicktionary] Term el at index ${idx} of ${all.length} inputs`);
  return idx >= 0 ? all[idx + 1] || null : null;
}

async function clickAddCard() {
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  const addBtn = buttons.find(btn =>
    /add\s*(a\s*)?card/i.test(btn.textContent.trim()) ||
    /\+\s*add/i.test(btn.textContent.trim())
  );
  if (!addBtn) {
    console.log('[Clicktionary] No "Add card" button found');
    return false;
  }
  const countBefore = findAll(TERM_SELECTORS)?.els.length || 0;
  console.log(`[Clicktionary] Clicking "Add card", currently ${countBefore} term inputs`);
  addBtn.click();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    const countAfter = findAll(TERM_SELECTORS)?.els.length || 0;
    if (countAfter > countBefore) {
      console.log(`[Clicktionary] New row appeared (${countAfter} inputs now)`);
      return true;
    }
  }
  console.log('[Clicktionary] Row count did not increase after clicking Add card');
  return true; // clicked but count didn't change — proceed anyway
}

async function injectCard(term, definition) {
  console.log(`[Clicktionary] Injecting: "${term}" / "${definition}"`);

  let termEl = findLastEmptyTermInput();

  if (!termEl) {
    await clickAddCard();
    termEl = findLastEmptyTermInput();
  }

  if (!termEl) {
    console.log('[Clicktionary] Still no term input after Add card click');
    return {
      success: false,
      error: 'Could not find a term input. Make sure you are on a Quizlet set editor page (quizlet.com/create-set or a set edit page).'
    };
  }

  const defEl = findDefinitionInput(termEl);
  if (!defEl) {
    console.log('[Clicktionary] Could not find definition input');
    return { success: false, error: 'Could not find the definition input.' };
  }

  console.log('[Clicktionary] Filling term:', termEl.tagName, termEl.getAttribute('aria-label') || termEl.placeholder || '');
  fillInput(termEl, term);
  await new Promise(r => setTimeout(r, 80));

  console.log('[Clicktionary] Filling definition:', defEl.tagName, defEl.getAttribute('aria-label') || defEl.placeholder || '');
  fillInput(defEl, definition);

  termEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'INJECT_QUIZLET_CARD') {
    injectCard(message.term, message.definition).then(sendResponse);
    return true;
  }
});

chrome.storage.local.get('quizletPending', (r) => {
  if (!r.quizletPending) return;
  const { term, definition } = r.quizletPending;
  chrome.storage.local.remove('quizletPending');
  setTimeout(() => injectCard(term, definition), 1500);
});
