// Clicktionary — Quizlet integration content script
// Injected into quizlet.com set editor pages
// Quizlet uses ProseMirror: contenteditable divs with pm-placeholder attributes

function isProseMirrorEmpty(el) {
  // Empty ProseMirror has only a trailing <br>, no real text
  return !el.textContent.trim();
}

function fillProseMirror(el, value) {
  el.focus();

  // Place cursor inside the element
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);

  // ProseMirror handles beforeinput events with inputType 'insertText'
  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true, cancelable: true,
    inputType: 'insertText',
    data: value
  });
  el.dispatchEvent(beforeInput);

  if (!beforeInput.defaultPrevented) {
    // Fallback: execCommand if ProseMirror didn't handle it
    document.execCommand('insertText', false, value);
  }
}

function findAllTermInputs() {
  return [...document.querySelectorAll(
    'div.ProseMirror[pm-placeholder="Enter term"], [aria-placeholder="Enter term"]'
  )];
}

function findLastEmptyTermInput() {
  const all = findAllTermInputs();
  console.log(`[Clicktionary] Found ${all.length} term inputs`);
  for (let i = all.length - 1; i >= 0; i--) {
    if (isProseMirrorEmpty(all[i])) return all[i];
  }
  return null;
}

function findDefinitionInput(termEl) {
  // Each card row contains one term and one definition ProseMirror
  const row = termEl.closest('[class*="SetEditorRow"], [class*="SetEditor-term"], [class*="row"], [class*="card"], li');
  if (row) {
    const def = row.querySelector(
      'div.ProseMirror[pm-placeholder="Enter definition"], [aria-placeholder="Enter definition"]'
    );
    if (def) return def;
  }

  // Fallback: next ProseMirror in document order
  const all = [...document.querySelectorAll('div.ProseMirror[pm-placeholder], [aria-placeholder]')];
  const idx = all.indexOf(termEl);
  console.log(`[Clicktionary] Term at index ${idx} of ${all.length} ProseMirror els`);
  return idx >= 0 ? all[idx + 1] || null : null;
}

async function clickAddCard() {
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  const addBtn = buttons.find(btn => /add\s*(a\s*)?card/i.test(btn.textContent.trim()));
  if (!addBtn) {
    console.log('[Clicktionary] No "Add card" button found. Button texts:', buttons.slice(0, 10).map(b => b.textContent.trim()));
    return false;
  }
  const countBefore = findAllTermInputs().length;
  addBtn.click();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (findAllTermInputs().length > countBefore) break;
  }
  return true;
}

async function injectCard(term, definition) {
  console.log(`[Clicktionary] Injecting: "${term}" / "${definition}"`);

  let termEl = findLastEmptyTermInput();

  if (!termEl) {
    await clickAddCard();
    termEl = findLastEmptyTermInput();
  }

  if (!termEl) {
    console.log('[Clicktionary] No empty term input found');
    return { success: false, error: 'Could not find an empty card slot. Make sure you are on a Quizlet set editor page.' };
  }

  const defEl = findDefinitionInput(termEl);
  if (!defEl) {
    console.log('[Clicktionary] No definition input found');
    return { success: false, error: 'Could not find the definition input.' };
  }

  console.log('[Clicktionary] Filling term and definition');
  fillProseMirror(termEl, term);
  await new Promise(r => setTimeout(r, 80));
  fillProseMirror(defEl, definition);

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
