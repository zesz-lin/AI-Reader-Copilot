import type {
  AppMessage, AppResponse, SummaryResponse,
  ArticleRecordResponse, HistoryListResponse,
  ArticleRecord, SidePanelMessage,
} from '../shared';
import { saveToHistory, getHistory, clearHistory, deleteFromHistory } from '../shared';
import { generateSummary, generateSummaryStream } from '../ai';


// ── Language ──────────────────────────────────────────────────────────

let lang: 'zh' | 'en' = 'zh';

// Init from storage, keep in sync
chrome.storage.local.get('language').then((r) => {
  if (r.language === 'zh' || r.language === 'en') lang = r.language;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.language?.newValue) lang = changes.language.newValue;
});

function t(zh: string, en: string): string {
  return lang === 'en' ? en : zh;
}

// ── Error translation ─────────────────────────────────────────────────

const ERR_DICT = {
  noConnection:  { zh: '无法建立连接，该页面未加载内容脚本。（试试刷新?）',     en: 'Cannot establish connection. Content script not loaded. (Try refreshing?)' },
  portClosed:    { zh: '消息通道已关闭，请重试。',                             en: 'Message port closed. Please try again.' },
  noArticle:     { zh: '没有可摘要的文章',                                     en: 'No article to summarize.' },
  noActiveTab:   { zh: '没有活动标签页',                                       en: 'No active tab found.' },
  extractFail:   { zh: '提取失败',                                             en: 'Extraction failed.' },
  unknownMsg:    { zh: '未知消息类型',                                         en: 'Unknown message type.' },
  unknownErr:    { zh: '未知错误',                                             en: 'Unknown error.' },
};

function humanError(err: unknown): string {
  let msg = '';
  if (err instanceof Error) {
    msg = err.message;
  } else if (err && typeof err === 'object' && 'message' in err) {
    msg = (err as { message: string }).message || '';
  } else {
    msg = String(err);
  }

  if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
    return t(ERR_DICT.noConnection.zh, ERR_DICT.noConnection.en);
  }
  if (msg.includes('message port closed')) return t(ERR_DICT.portClosed.zh, ERR_DICT.portClosed.en);
  return msg || t(ERR_DICT.unknownErr.zh, ERR_DICT.unknownErr.en);
}

// ── Side panel ────────────────────────────────────────────────────────

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({ windowId: tab.windowId! });
  });
});

// ── Keyboard shortcuts ────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === 'extract-article' || command === 'summarize-concise') {
    chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' }, () => void chrome.runtime.lastError);
    if (command === 'summarize-concise' && lastArticle) {
      streamSummaryToSidePanel('concise', 200, false, false);
    }
  }
});

// ── SPA navigation ────────────────────────────────────────────────────

chrome.webNavigation?.onHistoryStateUpdated?.addListener((details) => {
  if (details.frameId !== 0) return;
  chrome.tabs.sendMessage(details.tabId, { type: 'EXTRACT_ARTICLE' }, () => void chrome.runtime.lastError);
});

// ── State ─────────────────────────────────────────────────────────────

let lastArticle: ArticleRecord | null = null;
let streamAbortController: AbortController | null = null;

// ── Archive redirect ─────────────────────────────────────────────────

async function redirectToArchive(targetUrl: string): Promise<void> {
  const archiveUrl = `https://archive.ph/${targetUrl}`;

  // Check if already on archive.ph to prevent double-redirect
  if (targetUrl.includes('archive.ph') || targetUrl.includes('archive.is')) return;

  console.log('[ai-reader-copilot] Redirecting to archive.ph:', archiveUrl);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await chrome.tabs.update(tab.id, { url: archiveUrl });
}

// ── Title translation ────────────────────────────────────────────────

async function maybeTranslateTitle(title: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['apiKey', 'baseUrl', 'model', 'autoTranslateTitle']);
    const apiKey = result.apiKey as string | undefined;
    const autoTranslate = result.autoTranslateTitle !== false; // default true
    if (!apiKey || !autoTranslate) return;

    const baseUrl = (result.baseUrl as string) || 'https://api.deepseek.com/v1';
    const model = (result.model as string) || 'deepseek-reasoner';

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Translate the following title to Chinese. Output only the translation, nothing else.' },
          { role: 'user', content: title },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });

    if (!res.ok) return;
    const data = await res.json();
    const translated = data.choices?.[0]?.message?.content?.trim();
    if (translated) {
      chrome.runtime.sendMessage<SidePanelMessage>({
        type: 'TITLE_TRANSLATED', translatedTitle: translated,
      }).catch(() => {});
    }
  } catch {
    // Silently ignore
  }
}

// ── Streaming helper ──────────────────────────────────────────────────

async function streamSummaryToSidePanel(style: string, wordCount: number, force: boolean, bilingual: boolean, customPrompt?: string) {
  if (!lastArticle) return;

  // Abort any previous stream
  streamAbortController?.abort();
  const controller = new AbortController();
  streamAbortController = controller;

  const cacheKey = bilingual ? `${style}:w${wordCount}:zh` : `${style}:w${wordCount}`;

  try {
    const stream = generateSummaryStream(
      { title: lastArticle.title, textContent: lastArticle.rawText, content: '' },
      style as Parameters<typeof generateSummaryStream>[1],
      wordCount,
      bilingual,
      controller.signal,
      customPrompt,
    );

    let fullContent = '';
    for await (const chunk of stream) {
      fullContent += chunk;
      chrome.runtime.sendMessage<SidePanelMessage>({
        type: 'SUMMARY_CHUNK', content: chunk, done: false,
      }).catch(() => {});
    }

    chrome.runtime.sendMessage<SidePanelMessage>({
      type: 'SUMMARY_CHUNK', content: '', done: true,
      summaryMarkdown: fullContent, style: style as SidePanelMessage['style'],
    }).catch(() => {});

    const s = style as 'concise' | 'detailed' | 'academic';
    lastArticle = {
      ...lastArticle, summaryMarkdown: fullContent,
      summaries: { ...lastArticle.summaries, [cacheKey]: fullContent },
    };

    await saveToHistory({
      url: lastArticle.url, title: lastArticle.title,
      summaryMarkdown: fullContent, style: s, rawText: lastArticle.rawText,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.log('[ai-reader-copilot] Stream aborted by user');
      // Don't send empty done — user paused, keep partial content
      return;
    }
    console.error('[ai-reader-copilot] Stream summary failed:', err);
    chrome.runtime.sendMessage<SidePanelMessage>({
      type: 'SUMMARY_CHUNK', content: '', done: true, summaryMarkdown: '',
    }).catch(() => {});
  } finally {
    if (streamAbortController === controller) streamAbortController = null;
  }
}

// ── Message dispatch ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: AppMessage, sender, sendResponse) => {
    switch (message.type) {

      case 'PAGE_INFO': {
        sendResponse({ status: 'ok' } satisfies AppResponse);
        break;
      }

      case 'ARTICLE_EXTRACTED': {
        lastArticle = {
          url: message.payload.url, title: message.payload.title,
          summaryMarkdown: null, summaries: {}, rawText: message.payload.textContent,
        };
        sendResponse({ status: 'ok' } satisfies AppResponse);

        // Auto-translate title if API is configured and title likely needs it
        const title = message.payload.title;
        if (title && !/[一-鿿]/.test(title)) {
          maybeTranslateTitle(title);
        }
        break;
      }

      case 'NO_ARTICLE_FOUND': {
        // All content-script tiers failed — redirect to archive.ph
        const url = message.url;
        if (lastArticle?.url === url) lastArticle = null;
        sendResponse({ status: 'ok' } satisfies AppResponse);
        redirectToArchive(url);
        break;
      }

      case 'GET_LAST_ARTICLE': {
        sendResponse({ status: 'ok', article: lastArticle } satisfies ArticleRecordResponse);
        break;
      }

      case 'GENERATE_SUMMARY': {
        (async () => {
          try {
            if (!lastArticle) {
              sendResponse({ status: 'error', error: '没有可摘要的文章\nNo article to summarize.' } satisfies SummaryResponse);
              return;
            }

            const { style, wordCount, customPrompt, force, bilingual = false } = message;
            const cacheKey = bilingual ? `${style}:w${wordCount}:zh` : `${style}:w${wordCount}`;

            if (!force && lastArticle.summaries[cacheKey]) {
              sendResponse({
                status: 'ok', summaryMarkdown: lastArticle.summaries[cacheKey], style, cached: true,
              } satisfies SummaryResponse);
              return;
            }

            sendResponse({ status: 'ok', streaming: true, style } satisfies SummaryResponse);
            streamSummaryToSidePanel(style, wordCount, !!force, bilingual, customPrompt);
          } catch (err) {
            sendResponse({ status: 'error', error: humanError(err) } satisfies SummaryResponse);
          }
        })();
        return true;
      }

      case 'EXTRACT_ARTICLE': {
        (async () => {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) {
              sendResponse({ status: 'error', error: '没有活动标签页\nNo active tab found.' });
              return;
            }

            chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' }, (response) => {
              if (chrome.runtime.lastError) {
                sendResponse({ status: 'error', error: humanError(chrome.runtime.lastError) });
                return;
              }

              if (response?.status === 'ok' && response.article) {
                const sameUrl = lastArticle?.url === response.article.url;
                lastArticle = {
                  url: response.article.url, title: response.article.title,
                  summaryMarkdown: sameUrl ? lastArticle!.summaryMarkdown : null,
                  summaries: sameUrl ? { ...lastArticle!.summaries } : {},
                  rawText: response.article.textContent,
                };
                sendResponse({ status: 'ok', article: lastArticle });
              } else {
                sendResponse({ status: 'error', error: response?.error || '提取失败\nExtraction failed.' });
                // Also redirect to archive.ph
                if (tab.url) redirectToArchive(tab.url);
              }
            });
          } catch (err) {
            sendResponse({ status: 'error', error: humanError(err) });
          }
        })();
        return true;
      }

      case 'SAVE_TO_HISTORY': {
        saveToHistory(message.payload)
          .then((entries) => sendResponse({ status: 'ok', entries } satisfies HistoryListResponse))
          .catch((err) => sendResponse({ status: 'error', error: humanError(err) } satisfies HistoryListResponse));
        return true;
      }

      case 'GET_HISTORY': {
        getHistory()
          .then((entries) => sendResponse({ status: 'ok', entries } satisfies HistoryListResponse))
          .catch((err) => sendResponse({ status: 'error', error: humanError(err) } satisfies HistoryListResponse));
        return true;
      }

      case 'CLEAR_HISTORY': {
        clearHistory()
          .then(() => sendResponse({ status: 'ok', entries: [] } satisfies HistoryListResponse))
          .catch((err) => sendResponse({ status: 'error', error: humanError(err) } satisfies HistoryListResponse));
        return true;
      }

      case 'STOP_STREAMING': {
        streamAbortController?.abort();
        streamAbortController = null;
        sendResponse({ status: 'ok' } satisfies AppResponse);
        break;
      }

      case 'REDIRECT_TO_ARCHIVE': {
        redirectToArchive(message.url);
        sendResponse({ status: 'ok' } satisfies AppResponse);
        return true;
      }

      case 'DELETE_HISTORY_ENTRY': {
        deleteFromHistory(message.id)
          .then((entries) => sendResponse({ status: 'ok', entries } satisfies HistoryListResponse))
          .catch((err) => sendResponse({ status: 'error', error: humanError(err) } satisfies HistoryListResponse));
        return true;
      }

      default: {
        const _exhaustive: never = message;
        sendResponse({ status: 'error', error: '未知消息类型\nUnknown message type.' } satisfies AppResponse);
      }
    }
  },
);
