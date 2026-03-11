# Clicktionary 🔍

Highlight Spanish text on any webpage to get English definitions, then practice your saved words on your hosted word bank site.

## Project Structure

All files live in a single folder:

```
clicktionarywebextension/
├── manifest.json       ← Extension config
├── content.js          ← Runs on every page, detects highlights
├── content.css         ← Tooltip styles
├── background.js       ← Service worker, manages chrome.storage
├── bridge.js           ← Unused currently (see Notes)
├── popup.html          ← Extension popup UI
├── popup.js            ← Encodes words into URL and opens website
├── icon16.png
├── icon48.png
├── icon128.png
└── index.html          ← Word bank & practice site (hosted on GitHub Pages)
```

## How It Works

1. **Highlighting** — `content.js` detects when you select text on any webpage
2. **Definition lookup** — tries the [Free Dictionary API](https://dictionaryapi.dev/) for single words, falls back to [MyMemory](https://mymemory.translated.net/) for phrases
3. **Saving** — clicking "＋ Add to Word Bank" stores the word in `chrome.storage.local` via `background.js`
4. **Website** — clicking "Open Word Bank & Practice" in the popup encodes your saved words as a base64 string in the URL hash and opens your GitHub Pages site
5. **Display** — `index.html` reads the words from the URL hash on load and renders them

## Setup

### 1. Load the extension in Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this folder

### 2. Website
The word bank is hosted on GitHub Pages at:
`https://samuelbingham07.github.io/clicktionarywebextension/`

To update the site, push changes to the GitHub repo and Pages will rebuild automatically (~30 seconds).

### 3. Reload after changes
After editing any extension file, go to `chrome://extensions` and click the **reload icon** on the Clicktionary card. Then close and reopen any tabs you want the changes to apply to.

## Features

- ✅ Tooltip with definition, part of speech, and example sentence
- ✅ Fallback translation API for phrases
- ✅ One-click "Add to Word Bank" with duplicate detection
- ✅ Extension popup shows recent words and stats
- ✅ Word bank website with search and filter (All / Learning / Mastered)
- ✅ Flashcard practice mode with flip animation
- ✅ Multiple choice practice mode
- ✅ Mastery strength tracking (0–5 score), saved to localStorage

## Notes

- **Deleting words** on the website only affects the current session view — it does not remove words from the extension's storage. To permanently delete a word, close and reopen the word bank via the popup.
- **Practice scores** are saved to `localStorage` in your browser and persist between visits.
- **bridge.js** is included but currently inactive. It was an earlier attempt at two-way sync between the extension and website. The URL hash approach is used instead.
