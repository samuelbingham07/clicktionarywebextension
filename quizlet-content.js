// Clicktionary — Quizlet integration content script
// Injected into quizlet.com set editor pages
// Listens for INJECT_QUIZLET_CARD messages from background.js

// Fill a React-controlled input/textarea with text.
// Tries execCommand first (most reliable for React), falls back to native setter.
function fillInput(el, value) {
  el.focus();

  // Select all existing text
  el.setSelectionRange ? el.setSelectionRange(0, el.value.length) : null;

  // execCommand insertText triggers the browser's native input pipeline,
  // which React's synthetic event system picks up correctly.
  const inserted = document.execCommand('insertText', false, value);

  if (!inserted || el.value !== value) {
    // Fallback: native prototype setter + input event
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// Return ALL inputs matching term-like selectors
function findTermInputs() {
  const selectors = [
    'textarea[placeholder*="Term"]',
    'textarea[placeholder*="term"]',
    'input[placeholder*="Term"]',
    'input[placeholder*="term"]',
    '[aria-label*="Term"]',
    '[data-testid*="term"]',
  ];
  for (const sel of selectors) {
    const els = [...document.querySelectorAll(sel)];
    if (els.length) return els;
  }
  return [];
}

// Find the LAST empty term input (the newly added card row)
function findLastEmptyTermInput() {
  const all = findTermInputs();
  // Walk from end to find first empty
  for (let i = all.length - 1; i >= 0; i--) {
    if (!all[i].value.trim()) return all[i];
  }
  return null;
}

// Find the definition input paired with a given term input
function findDefinitionInput(termEl) {
  // Try within the same card row
  const row = termEl.closest(
    '[class*="Row"], [class*="Card"], [class*="card"], [class*="row"], li, [data-testid*="card"]'
  );
  if (row) {
    const defSelectors = [
      'textarea[placeholder*="Definition"]',
      'textarea[placeholder*="definition"]',
      'input[placeholder*="Definition"]',
      'input[placeholder*="definition"]',
      '[aria-label*="Definition"]',
    ];
    for (const sel of defSelectors) {
      const def = row.querySelector(sel);
      if (def) return def;
    }
  }
  // Fallback: next textarea/text input in document order
  const allInputs = [...document.querySelectorAll('textarea, input[type="text"]')];
  const idx = allInputs.indexOf(termEl);
  return idx >= 0 ? allInputs[idx + 1] || null : null;
}

// Click the "Add card" button and wait for the new row to appear
async function clickAddCard() {
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  const addBtn = buttons.find(btn =>
    /add\s*(a\s*)?card/i.test(btn.textContent.trim()) ||
    /\+\s*add/i.test(btn.textContent.trim())
  );
  if (!addBtn) return false;
  const countBefore = findTermInputs().length;
  addBtn.click();
  // Wait until a new row appears (up to 1.5s)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (findTermInputs().length > countBefore) break;
  }
  return true;
}

async function injectCard(term, definition) {
  let termEl = findLastEmptyTermInput();

  if (!termEl) {
    const clicked = await clickAddCard();
    if (clicked) termEl = findLastEmptyTermInput();
  }

  if (!termEl) {
    return {
      success: false,
      error: 'Could not find a term input. Make sure you are on a Quizlet set editor page (quizlet.com/create-set or a set edit page).'
    };
  }

  const defEl = findDefinitionInput(termEl);
  if (!defEl) {
    return { success: false, error: 'Could not find the definition input.' };
  }

  fillInput(termEl, term);
  // Small pause so React processes the term input before we move to definition
  await new Promise(r => setTimeout(r, 80));
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

// On load, check if there's a pending card queued by background.js
// (used when a new tab was opened to handle the card)
chrome.storage.local.get('quizletPending', (r) => {
  if (!r.quizletPending) return;
  const { term, definition } = r.quizletPending;
  chrome.storage.local.remove('quizletPending');
  setTimeout(() => injectCard(term, definition), 1500);
});
