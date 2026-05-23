# AI Reader Copilot

AI-powered browser extension for intelligent article summarization. Built with Manifest V3, React, TypeScript, and Tailwind CSS.

## Features

| Feature | Description |
|---|---|
| **Smart Extraction** | Three-tier paywall bypass — clean Readability, aggressive DOM unwrap, archive.ph redirect |
| **AI Summarization** | Vocabulary-level styles (3K/6K/10K), adjustable word count, bilingual output |
| **Custom Prompts** | Write your own system prompt with `{wordCount}` variable |
| **Streaming** | Real-time SSE streaming with pause/resume |
| **Multi-Provider** | DeepSeek (default), OpenAI, Anthropic, Ollama — OpenAI-compatible API |
| **Title Translation** | Auto-translate article titles via AI (toggleable) |
| **Export** | Copy Markdown, download `.md` file, persistent history (20 entries) |
| **Dark/Light Theme** | System-aware with manual toggle |
| **i18n** | Chinese / English UI, language-specific error messages |
| **Keyboard Shortcuts** | `Ctrl+Shift+E` extract, `Ctrl+Shift+S` summarize |

## Architecture

```
src/
├── ai/client.ts            OpenAI-compatible API client + streaming
├── background/
│   ├── index.ts             Service worker (message dispatch, state, cache)
│   └── archive.ts           archive.ph redirect helper
├── content/index.ts         Content script (DOM extraction, retry logic)
├── readability/
│   ├── parser.ts            Readability wrapper (standard + aggressive)
│   └── paywall.ts           Paywall element removal selectors
├── shared/
│   ├── types.ts             Shared type definitions
│   ├── message.ts           Message schema (discriminated union, 12 variants)
│   └── storage.ts           chrome.storage.local CRUD (history, config)
└── sidebar/
    ├── App.tsx              Main React UI (tabs, settings, streaming)
    ├── i18n.tsx              I18n context + dictionary (~60 keys)
    ├── MarkdownView.tsx     Markdown renderer (marked)
    ├── export.ts            Download / copy utilities
    ├── useTheme.ts          Dark/light theme hook
    └── index.css            Tailwind + markdown-body styles
```

### Communication Topology

```
Content Script ←→ Background ←→ Side Panel
     │                │              │
     │  PAGE_INFO     │              │  GET_LAST_ARTICLE
     │  ARTICLE_      │              │  GENERATE_SUMMARY
     │  EXTRACTED     │              │  EXTRACT_ARTICLE
     │  NO_ARTICLE_   │              │  STOP_STREAMING
     │  FOUND         │              │  SAVE_TO_HISTORY
     │                │              │  REDIRECT_TO_ARCHIVE
     │                │              │
     │                │  SUMMARY_CHUNK (streaming push)
     │                │  ARCHIVE_STATUS
     │                │  TITLE_TRANSLATED
     │                │              │
     └────────────────┘──────────────┘
```

### Data Flow

1. **Extraction**: Content script clones DOM → removes paywall elements → Readability → sends `ARTICLE_EXTRACTED` → background stores in `lastArticle`
2. **Fallback**: If extraction fails (text < 300 chars), retry after 2.5s with aggressive mode. If still fails, redirect tab to `https://archive.ph/<url>`
3. **Summarization**: Side panel sends `GENERATE_SUMMARY` → background checks cache → calls OpenAI-compatible API with streaming → pushes `SUMMARY_CHUNK` chunks to side panel → stores result in `chrome.storage.local` history
4. **Title Translation**: After extraction, background detects non-CJK title → calls API with minimal prompt → pushes `TITLE_TRANSLATED` to side panel

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
cd ai-reader-copilot
npm install
npm run build
```

### Build Pipeline

| Step | Tool | Output |
|---|---|---|
| Side Panel (React + Tailwind) | Vite | `dist/assets/index-*.js`, `dist/assets/index-*.css` |
| Background + Content scripts | esbuild (IIFE) | `dist/background.js`, `dist/content.js` |
| Manifest + icons | Copy | `dist/manifest.json`, `dist/icons/` |

### Load Extension

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder
4. Click the extension icon in the toolbar to open the Side Panel

### Configuration

Open the **Settings** tab (⚙ in bottom nav):

| Setting | Default | Description |
|---|---|---|
| Provider | DeepSeek | API provider presets with auto-fill URL/model |
| API Key | *(empty)* | Your API key (`sk-...`) |
| Base URL | `https://api.deepseek.com/v1` | OpenAI-compatible endpoint |
| Model | `deepseek-reasoner` | Model identifier |
| Temperature | 0.3 | 0.0–2.0, controls output randomness |
| Auto-translate title | On | Auto-translate article title via AI |
| Language | 中文 | UI language (Chinese / English) |
| Theme | System | Dark / Light mode |

## Permissions

| Permission | Reason |
|---|---|
| `sidePanel` | Chrome Side Panel API |
| `activeTab` | Access current page for extraction |
| `storage` | Save settings, history, cache |
| `webNavigation` | Detect SPA navigation, retrigger extraction |

## Tech Stack

- **Runtime**: Chrome Extension Manifest V3
- **Framework**: React 18 + TypeScript 5
- **Styling**: Tailwind CSS 3 (dark mode via `class` strategy)
- **Build**: Vite 5 + esbuild
- **Markdown**: marked
- **Content Extraction**: @mozilla/readability
- **API**: OpenAI-compatible chat completions (DeepSeek, OpenAI, Anthropic, Ollama)

## License

MIT
