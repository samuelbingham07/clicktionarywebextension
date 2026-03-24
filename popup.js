// Clicktionary Popup Script

const WORDBANK_URL = 'https://samuelbingham07.github.io/clicktionarywebextension/';
const SUPABASE_URL = 'https://incvqtbkfntzdvbingqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluY3ZxdGJrZm50emR2YmluZ3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTc3NzAsImV4cCI6MjA4OTg5Mzc3MH0.QCIoHwvt41QcLJ3ilSezTntNGzXyFFpHQf-7kz6mKzU';

let isSignUp = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Check if already signed in
  chrome.runtime.sendMessage({ type: 'GET_SESSION' }, async ({ session }) => {
    document.getElementById('loadingPanel').style.display = 'none';
    if (session) {
      showMainPanel(session);
    } else {
      document.getElementById('authPanel').style.display = 'block';
    }
  });

  // ── Auth toggle (Sign In ↔ Sign Up) ──
  document.getElementById('authToggleLink').addEventListener('click', () => {
    isSignUp = !isSignUp;
    document.getElementById('authTitle').textContent = isSignUp ? 'Create an account' : 'Sign in to Clicktionary';
    document.getElementById('authSubmit').textContent = isSignUp ? 'Sign Up' : 'Sign In';
    document.getElementById('authToggleText').textContent = isSignUp ? 'Already have an account?' : "Don't have an account?";
    document.getElementById('authToggleLink').textContent = isSignUp ? 'Sign In' : 'Sign Up';
    clearMessages();
  });

  // ── Submit auth form ──
  document.getElementById('authSubmit').addEventListener('click', async () => {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    clearMessages();

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    document.getElementById('authSubmit').textContent = 'Please wait...';
    document.getElementById('authSubmit').disabled = true;

    const type = isSignUp ? 'SIGN_UP' : 'SIGN_IN';
    chrome.runtime.sendMessage({ type, email, password }, (res) => {
      document.getElementById('authSubmit').disabled = false;
      document.getElementById('authSubmit').textContent = isSignUp ? 'Sign Up' : 'Sign In';

      if (res.success) {
        if (res.needsConfirmation) {
          showSuccess('Check your email to confirm your account, then sign in.');
          isSignUp = false;
          document.getElementById('authTitle').textContent = 'Sign in to Clicktionary';
          document.getElementById('authSubmit').textContent = 'Sign In';
        } else {
          document.getElementById('authPanel').style.display = 'none';
          showMainPanel(res.user);
        }
      } else {
        showError(res.error || 'Something went wrong. Please try again.');
      }
    });
  });

  // Allow pressing Enter to submit
  document.getElementById('passwordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('authSubmit').click();
  });
});

function showError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.style.display = 'block';
}

function showSuccess(msg) {
  const el = document.getElementById('authSuccess');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearMessages() {
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authSuccess').style.display = 'none';
}

async function showMainPanel(user) {
  document.getElementById('mainPanel').style.display = 'block';
  document.getElementById('userEmail').textContent = user.email || '';

  // Load words
  chrome.runtime.sendMessage({ type: 'GET_WORDS' }, ({ words }) => {
    const total = words.length;
    const mastered = words.filter(w => w.strength >= 4).length;

    document.getElementById('totalWords').textContent = total;
    document.getElementById('masteredWords').textContent = mastered;

    const list = document.getElementById('wordList');
    if (total === 0) return;

    const recent = [...words].slice(0, 5);
    list.innerHTML = recent.map(w => `
      <div class="word-item">
        <span class="word-es">${w.spanish}</span>
        <span class="word-en">${w.english || '—'}</span>
      </div>
    `).join('');
  });

  // Open word bank — pass session token in hash so website can auth
  document.getElementById('openWordBank').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, ({ session }) => {
      if (session) {
        const token = encodeURIComponent(session.access_token);
        const refresh = encodeURIComponent(session.refresh_token);
        chrome.tabs.create({ url: `${WORDBANK_URL}#token=${token}&refresh=${refresh}` });
      }
    });
  });

  // Sign out
  document.getElementById('signOutBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, () => {
      document.getElementById('mainPanel').style.display = 'none';
      document.getElementById('authPanel').style.display = 'block';
      document.getElementById('emailInput').value = '';
      document.getElementById('passwordInput').value = '';
      clearMessages();
    });
  });
}
