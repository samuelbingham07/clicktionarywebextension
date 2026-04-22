// Clicktionary — Quizlet integration content script
// Injected into quizlet.com set editor pages

chrome.storage.local.get('quizletPending', (r) => {
  if (!r.quizletPending) return;
  const { term, definition } = r.quizletPending;
  chrome.storage.local.remove('quizletPending');
  // Ask background to run via executeScript (world:MAIN) to bypass Quizlet's CSP
  chrome.runtime.sendMessage({ type: 'FILL_QUIZLET_PENDING', term, definition });
});
