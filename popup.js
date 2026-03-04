// SpanishLens Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  chrome.runtime.sendMessage({ type: 'GET_WORDS' }, ({ words }) => {
    const total = words.length;
    const mastered = words.filter(w => w.strength >= 4).length;

    document.getElementById('totalWords').textContent = total;
    document.getElementById('masteredWords').textContent = mastered;

    const list = document.getElementById('wordList');
    if (total === 0) return;

    // Show 5 most recent
    const recent = [...words].reverse().slice(0, 5);
    list.innerHTML = recent.map(w => `
      <div class="word-item">
        <span class="word-es">${w.spanish}</span>
        <span class="word-en">${w.english || '—'}</span>
      </div>
    `).join('');
  });

  document.getElementById('openWordBank').addEventListener('click', () => {
    // Opens the companion website — update URL to your hosted site
    chrome.tabs.create({ url: 'https://your-spanishlens-site.com' });
  });
});
