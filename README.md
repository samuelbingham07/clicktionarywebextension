# SpanishLens 🔍

Highlight Spanish text on any webpage to get English definitions, then practice your saved words.

## Project Structure

```
spanishlens/
├── extension/          ← Load this folder in Chrome
│   ├── manifest.json
│   ├── content.js      ← Runs on every page, detects highlights
│   ├── content.css     ← Tooltip styles
│   ├── background.js   ← Service worker, manages storage
│   ├── popup.html      ← Extension popup UI
│   └── popup.js
└── website/
    └── index.html      ← Word bank & practice site
```

## Setup

### 1. Add placeholder icons (required)
Chrome requires icon files. Create simple 16×16, 48×48, and 128×128 PNG files
named `icon16.png`, `icon48.png`, `icon128.png` and place them in `/extension`.
You can use any image editor, or find free icons at https://icons8.com

### 2. Load the extension
1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 3. Host the website
Open `website/index.html` directly in your browser for local testing.
For production, host it on any static host (GitHub Pages, Netlify, Vercel).

### 4. Connect them
In `popup.js`, update this line with your hosted URL:
```js
chrome.tabs.create({ url: 'https://your-spanishlens-site.com' });
```

## How It Works

- **Content script** detects `mouseup` events and reads selected text
- Calls the [Free Dictionary API](https://dictionaryapi.dev/) for single words
- Falls back to [MyMemory](https://mymemory.translated.net/) for phrases
- Word bank stored in `chrome.storage.local` (persists across sessions)
- Website reads the same storage when opened from the extension

## Features

- ✅ Tooltip with definition, part of speech, and example sentence
- ✅ One-click "Add to Word Bank"
- ✅ Duplicate detection
- ✅ Extension popup shows recent words & stats
- ✅ Word bank website with search and filter
- ✅ Flashcard practice mode
- ✅ Multiple choice practice mode
- ✅ Spaced repetition strength tracking (0–5 mastery score)
