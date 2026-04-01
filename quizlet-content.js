// Clicktionary — Quizlet integration content script
// Injected into quizlet.com set editor pages
// Listens for INJECT_QUIZLET_CARD messages from background.js

// React's controlled inputs ignore direct .value assignments.
// This bypasses the synthetic event system by using the native setter.
function setReactInputValue(el, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
    'value'
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Find the first empty term input in the editor
function findEmptyTermInput() {
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
    const empty = els.find(el => !el.value.trim());
    if (empty) return empty;
  }
  return null;
}

// Find the definition input that corresponds to a given term input
function findDefinitionInput(termEl) {
  // Try within the same card row first
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
  // Fallback: the next textarea/text input after the term input
  const allInputs = [...document.querySelectorAll('textarea, input[type="text"]')];
  const idx = allInputs.indexOf(termEl);
  return idx >= 0 ? allInputs[idx + 1] || null : null;
}

// Click the "Add card" button and wait for a new row to appear
async function clickAddCard() {
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  const addBtn = buttons.find(btn =>
    /add\s*(a\s*)?card/i.test(btn.textContent.trim()) ||
    /\+\s*add/i.test(btn.textContent.trim())
  );
  if (addBtn) {
    addBtn.click();
    await new Promise(r => setTimeout(r, 700));
    return true;
  }
  return false;
}

async function injectCard(term, definition) {
  let termEl = findEmptyTermInput();

  if (!termEl) {
    const clicked = await clickAddCard();
    if (clicked) termEl = findEmptyTermInput();
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

  termEl.focus();
  setReactInputValue(termEl, term);

  defEl.focus();
  setReactInputValue(defEl, definition);

  // Return focus to term so the user can see what was filled
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
  // Wait for editor to render
  setTimeout(() => injectCard(term, definition), 1200);
});
