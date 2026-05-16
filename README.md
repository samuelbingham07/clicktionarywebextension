# Clicktionary

Highlight any word on any webpage to get instant translations in 10 languages, then save it to your personal word bank and practice with flashcards and quizzes.

Live site: [samuelbingham07.github.io/clicktionarywebextension](https://samuelbingham07.github.io/clicktionarywebextension/)

---

## Project Structure

```
clicktionarywebextension/
├── manifest.json          ← Extension config (MV3)
├── content.js             ← Tooltip on text highlight, translation lookup, word saving
├── content.css            ← Tooltip styles
├── es-dict.js             ← Bundled Spanish dictionary (~1 100 words + phrases, instant offline lookup)
├── background.js          ← Service worker: auth, Supabase sync, word bank
├── bridge.js              ← Content script injected into GitHub Pages site for auth sync
├── popup.html             ← Extension popup UI
├── popup.js               ← Popup logic: word list, language selector, auth
├── privacy.html           ← Privacy policy (hosted on GitHub Pages)
├── index.html             ← Word bank & practice site (hosted on GitHub Pages)
├── icon16.png
├── logo.png               ← Used as icon48 and favicon
└── icon128.png
```

---

## How It Works

1. **Highlight** any word or phrase on any webpage
2. **Tooltip appears** with the translation fetched from [Lingva Translate](https://lingva.ml/) (parallel race across multiple instances, 2s timeout) with [MyMemory](https://mymemory.translated.net/) as fallback
3. **Add to word bank** — saves to Supabase (when signed in) or `chrome.storage.local` (offline fallback)
4. **Website** syncs automatically via `bridge.js`, which passes the stored Supabase session to the GitHub Pages site so you stay logged in without re-authenticating
5. **Practice** on the word bank site with flashcards, multiple choice, and mastery tracking

### Translation pipeline
- **Bundled dictionary** (`es-dict.js`): ~1 100 common Spanish words and phrases resolve instantly with zero network calls. Common multi-word phrases (`soy de`, `tengo que`, `voy a`, etc.) are included.
- Lingva instances (4) are queried in parallel via `Promise.any()` with a 2s timeout — fastest one wins — for words not in the bundle
- MyMemory is the final fallback if all Lingva instances fail
- **Progressive display**: translation is shown as soon as Lingva responds; Wiktionary dictionary data (POS, definitions, examples) fills in afterwards
- On page load, the extension silently prefetches definitions for the 10 hardest words on the page (longest unique words = statistically less common vocabulary)
- Results are cached in memory so repeat lookups are instant

### Auth
- Email/password or Google OAuth via `chrome.identity.launchWebAuthFlow`
- Sessions stored in `chrome.storage.local`, synced to GitHub Pages site via `bridge.js`
- Stable extension ID: `fdbaeflfmkhkgelpaaeoihikpekkmfjj` (locked via RSA key in manifest)

### Supported languages
Spanish, French, German, Italian, Portuguese, Japanese, Chinese, Korean, Arabic, Russian

---

## Setup (development)

### Load the extension in Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder

### After editing files
Go to `chrome://extensions`, click the **reload icon** on Clicktionary, then reload any open tabs you want the changes to apply to. Content scripts do not hot-reload.

### Google OAuth (requires manual dashboard steps)
- Google Cloud Console → OAuth 2.0 Client → add authorized redirect URI:
  `https://fdbaeflfmkhkgelpaaeoihikpekkmfjj.chromiumapp.org/`
- Supabase dashboard → Authentication → Providers → Google → enable + add Client ID & Secret

---

## Features

- **Pronunciation** — 🔊 button in the tooltip speaks the word aloud using the Web Speech API with the correct language accent
- **Export Set to Quizlet** button on tooltip copies `term\tdefinition` to clipboard (paste into Quizlet → Create set → Import)
- Tooltip translation for any highlighted text, 10 languages
- Bundled Spanish dictionary for instant offline lookup (~1 100 words + phrases)
- Progressive display: translation shown immediately, dictionary data filled in after
- Parallel Lingva instances (4) with MyMemory fallback for non-bundled words
- Speculative prefetch of hard vocabulary on page load
- In-memory translation cache (instant repeat lookups)
- Add to word bank with duplicate detection
- Custom definition input if automatic lookup fails
- Google OAuth + email/password auth via Supabase
- Word bank website with search, filter, and language tabs
- Flashcard and multiple choice practice modes
- Mastery strength tracking (0–5), synced to Supabase
- On/off toggle in popup
- Works offline (falls back to local storage)

---

## Deployment

The website (`index.html`, `privacy.html`) is hosted on GitHub Pages. Push to `main` and it rebuilds automatically in ~30 seconds.

Privacy policy URL: `https://samuelbingham07.github.io/clicktionarywebextension/privacy.html`
