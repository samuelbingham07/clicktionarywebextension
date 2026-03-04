// SpanishLens Popup Script

const WORDBANK_BASE = 'https://samuelbingham07.github.io/clicktionarywebextension/';

document.addEventListener('DOMContentLoaded', async () => {
  chrome.runtime.sendMessage({ type: 'GET_WORDS' }, ({ words }) => {
    const total = words.length;
    const mastered = words.filter(w => w.strength >= 4).length;

    document.getElementById('totalWords').textContent = total;
    document.getElementById('masteredWords').textContent = mastered;

    const list = document.getElementById('wordList');
    if (total === 0) return;

    const recent = [...words].reverse().slice(0, 5);
    list.innerHTML = recent.map(w => `
      <div class="word-item">
        <span class="word-es">${w.spanish}</span>
        <span class="word-en">${w.english || '—'}</span>
      </div>
    `).join('');
  });

  document.getElementById('openWordBank').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_WORDS' }, ({ words }) => {
      // Encode words into the URL hash — website reads them on load, no bridge needed
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(words))));
      chrome.tabs.create({ url: WORDBANK_BASE + '#words=' + encoded });
    });
  });
});
