import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../sidebar/i18n';
import App from '../../sidebar/App';
import { chrome, resetStorage } from '../setup';
import type {
  ArticleRecordResponse,
  HistoryListResponse,
  SummaryResponse,
  SidePanelMessage,
} from '../../shared';

// ── Helpers ────────────────────────────────────────────────────────────

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

/** Get the onMessage listener that the App registered. */
function getMessageListener(): (message: SidePanelMessage) => void {
  // App calls chrome.runtime.onMessage.addListener(listener) once
  const calls = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(1);
  return calls[0][0] as (message: SidePanelMessage) => void;
}

/** Chain sendMessage responses for the app bootstrap calls. */
function mockBootstrap(article: boolean, history = true) {
  const sendMsg = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;

  // First call: GET_LAST_ARTICLE
  sendMsg.mockResolvedValueOnce(
    article
      ? ({
          status: 'ok',
          article: {
            url: 'https://example.com/test',
            title: 'Test Article Title',
            summaryMarkdown: null,
            summaries: {},
            rawText: 'Raw text content.',
          },
        } as ArticleRecordResponse)
      : ({ status: 'ok', article: null } as ArticleRecordResponse),
  );

  // Second call: GET_HISTORY
  sendMsg.mockResolvedValueOnce(
    history
      ? ({
          status: 'ok',
          entries: [],
        } as HistoryListResponse)
      : ({ status: 'ok', entries: [] } as HistoryListResponse),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('App – initial render', () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
    // mockReset() clears mockResolvedValueOnce queue which clearAllMocks() does NOT
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockReset();
  });

  afterEach(cleanup);

  it('shows empty state when no article is loaded', async () => {
    mockBootstrap(false);
    renderApp();

    // Wait for bootstrap to complete
    await waitFor(() => {
      expect(screen.getByText('AI 阅读助手')).toBeTruthy();
    });

    // Empty state message should appear
    expect(screen.getByText(/浏览到文章页面/)).toBeTruthy();

    // Extract button should be present
    expect(screen.getByText('提取')).toBeTruthy();

    // Three bottom nav tabs
    expect(screen.getByText('📄')).toBeTruthy();
    expect(screen.getByText('📋')).toBeTruthy();
    expect(screen.getByText('⚙')).toBeTruthy();
  });

  it('shows article info when an article is pre-loaded', async () => {
    mockBootstrap(true);
    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Test Article Title')).toBeTruthy();
    });

    // Style buttons should be visible
    expect(screen.getByText('简洁')).toBeTruthy();
    expect(screen.getByText('详细')).toBeTruthy();
    expect(screen.getByText('学术')).toBeTruthy();
    expect(screen.getByText('自定义')).toBeTruthy();

    // Action buttons
    expect(screen.getByText('提取')).toBeTruthy();
    expect(screen.getByText('生成摘要')).toBeTruthy();
  });
});

// ── Summary flow ──────────────────────────────────────────────────────

describe('App – summary flow', () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockReset();
  });

  afterEach(cleanup);

  it('transitions through extracting → article-ready → summarizing → done', async () => {
    const user = userEvent.setup();
    mockBootstrap(false);
    renderApp();

    // Wait for bootstrap
    await waitFor(() => expect(screen.getByText('AI 阅读助手')).toBeTruthy());

    // Click Extract → should show "提取中" (extracting)
    const sendMsg = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      article: {
        url: 'https://example.com/test',
        title: 'Extracted Article',
        summaryMarkdown: null,
        summaries: {},
        rawText: 'Raw extracted text.',
      },
    } as ArticleRecordResponse);

    await user.click(screen.getByText('提取'));
    // React 18 batches past the intermediate 'extracting' state;
    // wait directly for the final article-ready state.
    await waitFor(() => {
      expect(screen.getByText('Extracted Article')).toBeTruthy();
    });

    // Click Summarize → should show "生成中" (generating)
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      streaming: true,
    } as SummaryResponse);

    await user.click(screen.getByText('生成摘要'));
    await waitFor(() => {
      expect(screen.getByText('生成中')).toBeTruthy();
    });

    // Simulate stream chunks via onMessage
    const listener = getMessageListener();

    listener({
      type: 'SUMMARY_CHUNK',
      content: 'This is the ',
      done: false,
    } as SidePanelMessage);
    listener({
      type: 'SUMMARY_CHUNK',
      content: 'summary content.',
      done: false,
    } as SidePanelMessage);
    listener({
      type: 'SUMMARY_CHUNK',
      content: '',
      done: true,
      summaryMarkdown: 'This is the summary content.',
      style: 'concise',
    } as SidePanelMessage);

    // Wait for done state - summary should appear
    await waitFor(() => {
      expect(screen.getByText(/This is the/)).toBeTruthy();
    });
  });

  it('pauses and continues streaming correctly — background keeps running while paused', async () => {
    const user = userEvent.setup();
    mockBootstrap(true);
    renderApp();

    await waitFor(() => expect(screen.getByText('Test Article Title')).toBeTruthy());

    // Start summarizing
    const sendMsg = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      streaming: true,
    } as SummaryResponse);

    await user.click(screen.getByText('生成摘要'));

    // Send some stream chunks
    const listener = getMessageListener();
    listener({
      type: 'SUMMARY_CHUNK',
      content: 'First part ',
      done: false,
    } as SidePanelMessage);
    listener({
      type: 'SUMMARY_CHUNK',
      content: 'of the summary.',
      done: false,
    } as SidePanelMessage);

    // Wait for stream content to render
    await waitFor(() => {
      expect(screen.getByText(/First part/)).toBeTruthy();
    });

    // Pause button should appear (text is "⏸ 暂停", use regex)
    await waitFor(() => {
      expect(screen.getByText(/暂停/)).toBeTruthy();
    });

    // Click pause — does NOT send any message to background
    await user.click(screen.getByText(/暂停/));

    // After pause: "Continue" button appears, paused content shown
    await waitFor(() => {
      expect(screen.getByText(/继续/)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/First part of the summary/)).toBeTruthy();
    });

    // While paused, the background keeps sending chunks — they accumulate in streamContent
    listener({
      type: 'SUMMARY_CHUNK',
      content: 'But wait ',
      done: false,
    } as SidePanelMessage);
    listener({
      type: 'SUMMARY_CHUNK',
      content: 'more content.',
      done: false,
    } as SidePanelMessage);

    // Click Continue — no message sent to background, just resumes display
    await user.click(screen.getByText(/继续/));

    // Now display shows accumulated streamContent (paused content cleared)
    await waitFor(() => {
      expect(screen.getByText(/First part of the summary.But wait more content/)).toBeTruthy();
    });

    // More chunks arrive after continue
    listener({
      type: 'SUMMARY_CHUNK',
      content: ' Even ',
      done: false,
    } as SidePanelMessage);
    listener({
      type: 'SUMMARY_CHUNK',
      content: 'more.',
      done: false,
    } as SidePanelMessage);

    // Complete the stream
    listener({
      type: 'SUMMARY_CHUNK',
      content: '',
      done: true,
      summaryMarkdown: 'First part of the summary.But wait more content. Even more.',
      style: 'concise',
    } as SidePanelMessage);

    // Full content should appear in final article
    await waitFor(() => {
      expect(screen.getByText(/First part of the summary.But wait more content. Even more/)).toBeTruthy();
    });
  });

  it('handles stream finishing while paused — no duplicate content', async () => {
    const user = userEvent.setup();
    mockBootstrap(true);
    renderApp();

    await waitFor(() => expect(screen.getByText('Test Article Title')).toBeTruthy());

    // Start summarizing
    const sendMsg = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      streaming: true,
    } as SummaryResponse);

    await user.click(screen.getByText('生成摘要'));

    // Send some stream chunks
    const listener = getMessageListener();
    listener({
      type: 'SUMMARY_CHUNK',
      content: 'First half ',
      done: false,
    } as SidePanelMessage);

    await waitFor(() => {
      expect(screen.getByText(/First half/)).toBeTruthy();
    });

    // Click pause
    await user.click(screen.getByText(/暂停/));

    await waitFor(() => {
      expect(screen.getByText(/继续/)).toBeTruthy();
    });

    // Stream finishes while paused — done:true arrives
    // summaryMarkdown is the COMPLETE content (background was never aborted)
    listener({
      type: 'SUMMARY_CHUNK',
      content: '',
      done: true,
      summaryMarkdown: 'First half second half.',
      style: 'concise',
    } as SidePanelMessage);

    // UI should still show the paused content (not the final merged content)
    expect(screen.getByText(/First half/)).toBeTruthy();
    expect(screen.queryByText('second half')).toBeNull();

    // Continue button still visible — click it
    await user.click(screen.getByText(/继续/));

    // Now the full article should appear, with NO duplicated content
    // The paused content 'First half ' should NOT appear twice
    await waitFor(() => {
      expect(screen.getByText(/First half second half/)).toBeTruthy();
    });

    // Verify no duplicate: only one occurrence of 'First half' in the article
    const articleText = document.body.textContent || '';
    const occurrences = (articleText.match(/First half/g) || []).length;
    expect(occurrences).toBe(1);

    // Continue button should be gone
    expect(screen.queryByText(/继续/)).toBeNull();
  });
});

// ── History tab ────────────────────────────────────────────────────────

describe('App – history tab', () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockReset();
  });

  afterEach(cleanup);

  it('shows history entries', async () => {
    const user = userEvent.setup();

    // Setup: article + history with entries
    const sendMsg = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      article: null,
    } as ArticleRecordResponse);
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      entries: [
        {
          id: '1',
          url: 'https://example.com/a',
          title: 'History Article One',
          summaryMarkdown: '## Summary\nContent.',
          style: 'concise',
          rawText: 'Raw text.',
          timestamp: Date.now() - 3600000, // 1 hour ago
        },
        {
          id: '2',
          url: 'https://example.com/b',
          title: 'History Article Two',
          summaryMarkdown: '## Summary\nOther content.',
          style: 'detailed',
          rawText: 'More raw text.',
          timestamp: Date.now() - 7200000, // 2 hours ago
        },
      ],
    } as HistoryListResponse);

    renderApp();
    await waitFor(() => expect(screen.getByText('AI 阅读助手')).toBeTruthy());

    // Click history tab
    await user.click(screen.getByText('📋'));

    // Should show history entries
    await waitFor(() => {
      expect(screen.getByText('History Article One')).toBeTruthy();
      expect(screen.getByText('History Article Two')).toBeTruthy();
    });

    // Should show style labels
    expect(screen.getByText('简洁')).toBeTruthy();
    expect(screen.getByText('详细')).toBeTruthy();
  });

  it('shows empty state when no history', async () => {
    const sendMsg = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      article: null,
    } as ArticleRecordResponse);
    sendMsg.mockResolvedValueOnce({
      status: 'ok',
      entries: [],
    } as HistoryListResponse);

    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByText('AI 阅读助手')).toBeTruthy());

    await user.click(screen.getByText('📋'));
    expect(screen.getByText('暂无历史记录')).toBeTruthy();
  });
});

// ── Settings tab ───────────────────────────────────────────────────────

describe('App – settings tab', () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
    // Mock storage.local.get to return default settings
    vi.mocked(chrome.storage.local.get).mockResolvedValue({});
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockReset();
  });

  afterEach(cleanup);

  it('renders all settings fields', async () => {
    const sendMsg = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    sendMsg.mockResolvedValueOnce({ status: 'ok', article: null } as ArticleRecordResponse);
    sendMsg.mockResolvedValueOnce({ status: 'ok', entries: [] } as HistoryListResponse);

    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByText('AI 阅读助手')).toBeTruthy());

    // Navigate to settings
    await user.click(screen.getByText('⚙'));

    // Check settings fields are present
    expect(screen.getByText('提供商')).toBeTruthy();
    expect(screen.getByText('API 密钥')).toBeTruthy();
    expect(screen.getByText('接口地址')).toBeTruthy();
    expect(screen.getByText('模型')).toBeTruthy();
    expect(screen.getByText('Temperature')).toBeTruthy();
    expect(screen.getByText('测试API连接')).toBeTruthy();
    expect(screen.getByText('自动翻译标题')).toBeTruthy();
    expect(screen.getByText('保存所有设置')).toBeTruthy();

    // Language and theme controls
    expect(screen.getByText('语言')).toBeTruthy();
    expect(screen.getByText('主题')).toBeTruthy();
  });
});

// ── Banner messages ────────────────────────────────────────────────────

describe('App – banners', () => {
  beforeEach(() => {
    resetStorage();
    vi.clearAllMocks();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockReset();
  });

  afterEach(cleanup);

  it('shows archive fetching status banner', async () => {
    mockBootstrap(true);
    renderApp();
    await waitFor(() => expect(screen.getByText('Test Article Title')).toBeTruthy());

    const listener = getMessageListener();
    listener({
      type: 'ARCHIVE_STATUS',
      status: 'fetching',
    } as SidePanelMessage);

    await waitFor(() => {
      expect(screen.getByText(/正在从 archive.ph 获取/)).toBeTruthy();
    });
  });

  it('shows archive error banner', async () => {
    mockBootstrap(true);
    renderApp();
    await waitFor(() => expect(screen.getByText('Test Article Title')).toBeTruthy());

    const listener = getMessageListener();
    listener({
      type: 'ARCHIVE_STATUS',
      status: 'error',
    } as SidePanelMessage);

    await waitFor(() => {
      expect(screen.getByText(/archive.ph 无法获取/)).toBeTruthy();
    });
  });
});
