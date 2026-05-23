import type {
  ArticleExtractedMessage,
  NoArticleFoundMessage,
  AppResponse,
  ContentScriptMessage,
} from '../shared';
import { extractArticle, extractArticleAggressive } from '../readability/parser';

const MIN_TEXT_LENGTH = 300;
const RETRY_DELAY = 2500;

function sendArticle(article: { title: string; textContent: string; content: string; excerpt?: string; byline?: string }): void {
  chrome.runtime
    .sendMessage<ArticleExtractedMessage, AppResponse>({
      type: 'ARTICLE_EXTRACTED',
      payload: { url: window.location.href, ...article },
      timestamp: Date.now(),
    })
    .then((r) => console.log('[ai-reader-copilot] ARTICLE_EXTRACTED ack:', r))
    .catch((e) => console.error('[ai-reader-copilot] ARTICLE_EXTRACTED failed:', e));
}

function sendNoArticle(): void {
  chrome.runtime
    .sendMessage<NoArticleFoundMessage>({
      type: 'NO_ARTICLE_FOUND',
      url: window.location.href,
    })
    .catch(() => {});
}

// ── Tiered extraction ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function extractWithFallback(): Promise<void> {
  // Tier 1: standard extraction
  let article = extractArticle(document);

  if (article && article.textContent.length >= MIN_TEXT_LENGTH) {
    sendArticle(article);
    return;
  }

  // Tier 1 got nothing or too-short content → try harder
  console.log('[ai-reader-copilot] Tier 1 short (%d chars), waiting for delayed content...',
    article?.textContent.length ?? 0);

  // Don't send Tier 1 partial result — wait for Tier 2

  // Tier 2: wait for JS-loaded content, then aggressive extraction
  await sleep(RETRY_DELAY);

  article = extractArticleAggressive(document);

  if (article && article.textContent.length >= MIN_TEXT_LENGTH) {
    console.log('[ai-reader-copilot] Tier 2 success (%d chars)', article.textContent.length);
    sendArticle(article);
    return;
  }

  if (article) {
    console.log('[ai-reader-copilot] Tier 2 partial (%d chars)', article.textContent.length);
    sendArticle(article);
  } else {
    console.log('[ai-reader-copilot] All tiers failed — triggering archive fallback');
    sendNoArticle();
  }
}

// ── Inbound messages ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentScriptMessage, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_ARTICLE') {
      // Try tier 1 first for manual extract
      let article = extractArticle(document);
      if (!article || article.textContent.length < MIN_TEXT_LENGTH) {
        article = extractArticleAggressive(document);
      }

      if (!article) {
        sendResponse({ status: 'error', error: 'No article detected on this page' });
        return;
      }

      const payload = { url: window.location.href, ...article };

      chrome.runtime.sendMessage<ArticleExtractedMessage, AppResponse>({
        type: 'ARTICLE_EXTRACTED', payload, timestamp: Date.now(),
      });

      sendResponse({ status: 'ok', article: payload });
    }
  },
);

// ── Bootstrap ──────────────────────────────────────────────────────────

extractWithFallback();
