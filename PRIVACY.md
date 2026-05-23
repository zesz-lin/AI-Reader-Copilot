# Privacy Policy

**AI Reader Copilot** does not collect, store, or transmit any personal data to external servers.

## Data Storage

All data is stored **locally** on your device using the browser's built-in storage APIs:

| Storage | Data | Location |
|---|---|---|
| `chrome.storage.local` | API key, base URL, model, temperature, language, auto-translate preference | Your browser profile |
| `chrome.storage.local` | Summary history (max 20 entries: URL, title, markdown) | Your browser profile |
| `localStorage` | Theme preference, language preference | Your browser profile |

## Network Requests

The extension makes network requests **only** to:

| Endpoint | Purpose | When |
|---|---|---|
| `{baseUrl}/chat/completions` (configurable) | AI summarization and title translation | Only when you click "Summarize" or auto-translate is enabled |
| `https://archive.ph/{url}` | Paywall bypass fallback | Only when article extraction fails on the current page |

### What is sent to the AI API

- The **article text** extracted from the current page (title + body text)
- Your configured **API key** (as an `Authorization: Bearer` header)
- A **system prompt** describing the summarization format

### What is NOT sent

- No browsing history
- No cookies or authentication tokens
- No personal identifiers
- No analytics or telemetry
- No data to the extension developer

## Third-Party Services

### AI API Provider

When you configure an API provider (DeepSeek, OpenAI, Anthropic, Ollama), you are subject to that provider's privacy policy and terms of service. The extension itself does not intermediate or log any API traffic.

### archive.ph

The archive.ph fallback redirects your browser tab to `https://archive.ph/<url>` when local extraction fails. This is a direct browser navigation — the extension does not proxy, cache, or log this request.

## Data Retention

- **Settings**: Persist until you clear them or uninstall the extension
- **History**: Stored locally, up to 20 entries. Older entries are automatically removed. You can clear history at any time from the History tab.
- **Cache**: In-memory only (per-style summaries during a session). Lost when the service worker is terminated.

## Your Control

- **API Key**: Stored locally in `chrome.storage.local`. You can clear it anytime from the Settings tab.
- **History**: Clear individually or all at once from the History tab.
- **Auto-Translate**: Toggle on/off in Settings.
- **Uninstall**: Removing the extension deletes all locally stored data.

## Permissions Justification

| Permission | Justification |
|---|---|
| `activeTab` | Required to extract article content from the current page when you click "Extract" |
| `storage` | Required to save your API configuration and summary history locally |
| `sidePanel` | Required to display the extension UI in Chrome's Side Panel |
| `webNavigation` | Required to detect page navigations in single-page apps for re-extraction |

## Contact

This extension is developed as an open-source project. For questions or issues, please open an issue on the GitHub repository.

---

*Last updated: 2026-05-23*
