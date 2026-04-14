// Clicktionary — Quizlet integration content script
// Injected into quizlet.com set editor pages
// Quizlet uses ProseMirror: contenteditable divs with pm-placeholder attributes

function isProseMirrorEmpty(el) {
  // Empty ProseMirror has only a trailing <br>, no real text
  return !el.textContent.trim();
}

// Inject and run code in the page's JS context (same world as ProseMirror)
function injectIntoPage(fn, ...args) {
  return new Promise((resolve) => {
    const id = `_ct_${Date.now()}`;
    window.addEventListener(id, (e) => resolve(e.detail), { once: true });
    const script = document.createElement('script');
    script.textContent = `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')}, '${id}');`;
    document.documentElement.appendChild(script);
    script.remove();
  });
}

function fillProseMirror(el, value) {
  // Mark the element so the page-context script can find it
  const marker = `_ct_pm_${Date.now()}`;
  el.setAttribute('data-ct-marker', marker);
  injectIntoPage(function(marker, value, eventId) {
    const el = document.querySelector(`[data-ct-marker="${marker}"]`);
    if (!el) { window.dispatchEvent(new CustomEvent(eventId, { detail: false })); return; }
    el.removeAttribute('data-ct-marker');
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, value);
    window.dispatchEvent(new CustomEvent(eventId, { detail: true }));
  }, marker, value);
}

function findAllTermInputs() {
  // Quizlet uses the target language as placeholder (e.g. "Enter Spanish", "Enter French")
  // Select all pm-placeholder inputs that are NOT the definition field
  return [...document.querySelectorAll('[pm-placeholder]')].filter(el =>
    !el.getAttribute('pm-placeholder').toLowerCase().includes('definition')
  );
}

function findLastEmptyTermInput() {
  const all = findAllTermInputs();
  console.log(`[Clicktionary] Found ${all.length} term inputs`);
  for (let i = all.length - 1; i >= 0; i--) {
    if (isProseMirrorEmpty(all[i])) return all[i];
  }
  return null;
}

function isDefinitionField(el) {
  const p = el.getAttribute('pm-placeholder').toLowerCase();
  return p.includes('definition') || p.includes('english');
}

function findDefinitionInput(termEl) {
  const all = [...document.querySelectorAll('[pm-placeholder]')];
  const idx = all.indexOf(termEl);
  console.log(`[Clicktionary] Term at index ${idx} of ${all.length} pm-placeholder els`);

  // Try forward first, then backward — Quizlet's DOM order varies
  for (let i = idx + 1; i < all.length; i++) {
    if (isDefinitionField(all[i])) return all[i];
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (isDefinitionField(all[i])) return all[i];
  }
  return null;
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

  console.log('[Clicktionary] Filling term');
  fillProseMirror(termEl, term);

  // Wait for Quizlet to render the definition field (it may appear after term is focused)
  let defEl2 = defEl;
  if (!defEl2) {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 100));
      defEl2 = findDefinitionInput(termEl);
      if (defEl2) break;
    }
  }

  if (!defEl2) {
    console.log('[Clicktionary] Definition field never appeared');
    return { success: false, error: 'Could not find the definition input.' };
  }

  console.log('[Clicktionary] Filling definition');
  fillProseMirror(defEl2, definition);

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
