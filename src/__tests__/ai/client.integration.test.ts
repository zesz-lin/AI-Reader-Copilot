import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateSummaryStream } from '../../ai/client';
import { chrome, resetStorage } from '../setup';
import type { ArticleData } from '../../shared';

// ── Helpers ────────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<ArticleData> = {}): ArticleData {
  return {
    title: 'Test Article',
    textContent: 'This is the article text content used for testing the summary generation.',
    content: '<p>Test article content.</p>',
    ...overrides,
  };
}

/** Build an OpenAI SSE chunk for a delta content piece. Finishes with [DONE]. */
function makeChunksOpenAI(text: string): string[] {
  if (!text) return [`data: [DONE]\n\n`];
  const chunks: string[] = [];
  let i = 0;
  // Split text into small delta pieces to simulate streaming
  while (i < text.length) {
    const end = Math.min(i + 8, text.length);
    const piece = text.slice(i, end);
    chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
    i = end;
  }
  chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  chunks.push('data: [DONE]\n\n');
  return chunks;
}

/** Build Anthropic SSE chunks for a text delta. */
function makeChunksAnthropic(text: string): string[] {
  if (!text) return ['event: message_stop\ndata: {"type":"message_stop"}\n\n'];
  const chunks: string[] = [
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  ];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + 8, text.length);
    const piece = text.slice(i, end);
    chunks.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } })}\n\n`);
    i = end;
  }
  chunks.push('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
  chunks.push('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  return chunks;
}

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
}

/** Save and restore globalThis.fetch to keep state clean between tests. */
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchSuccess(chunks: string[]): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: createMockStream(chunks),
    text: vi.fn().mockResolvedValue(''),
    headers: new Headers(),
  }) as unknown as typeof globalThis.fetch;
}

function mockFetchError(status: number, body: string): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'Internal Server Error',
    body: null,
    text: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  }) as unknown as typeof globalThis.fetch;
}

/** Read all yielded values from a generator, ignoring the final return. */
async function collectStream(gen: AsyncGenerator<string, string, undefined>): Promise<{
  yielded: string[];
  full: string;
}> {
  const yielded: string[] = [];
  let full = '';
  for await (const chunk of gen) {
    yielded.push(chunk);
    full += chunk;
  }
  return { yielded, full };
}

// ── Integration: OpenAI-compatible ─────────────────────────────────────

describe('generateSummaryStream – OpenAI-compatible', () => {
  beforeEach(async () => {
    resetStorage();
    await chrome.storage.local.set({
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('yields chunks from a successful streaming response', async () => {
    const text = 'This is the summary response.';
    mockFetchSuccess(makeChunksOpenAI(text));

    const gen = generateSummaryStream(makeArticle());
    const { yielded, full } = await collectStream(gen);

    expect(yielded.length).toBeGreaterThan(0);
    expect(full).toBe(text);
  });

  it('yields nothing for empty response text', async () => {
    mockFetchSuccess(makeChunksOpenAI(''));

    const gen = generateSummaryStream(makeArticle());
    const { yielded, full } = await collectStream(gen);

    expect(yielded).toEqual([]);
    expect(full).toBe('');
  });

  it('throws on 401 unauthorized', async () => {
    mockFetchError(401, 'Invalid API key');

    await expect(async () => {
      const gen = generateSummaryStream(makeArticle());
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow(/API 错误 401/);
  });

  it('throws on 500 server error', async () => {
    mockFetchError(500, 'Server error');

    await expect(async () => {
      const gen = generateSummaryStream(makeArticle());
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow(/API 错误 500/);
  });

  it('aborts before fetch', async () => {
    // Mock fetch to reject — when the signal is already aborted, fetch should reject
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')) as unknown as typeof globalThis.fetch;

    const controller = new AbortController();
    controller.abort();

    const gen = generateSummaryStream(makeArticle(), 'concise', 200, false, controller.signal);

    await expect(async () => {
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow();
  });

  it('preserves custom style and custom prompt', async () => {
    const text = 'Custom summary.';
    mockFetchSuccess(makeChunksOpenAI(text));

    const gen = generateSummaryStream(
      makeArticle({ title: 'Custom Article' }),
      'custom',
      100,
      false,
      undefined,
      'Write a brief summary in one sentence.',
    );
    const { full } = await collectStream(gen);

    expect(full).toBe(text);
  });

  it('sends bilingual mode', async () => {
    const text = 'English summary.\n---\n## 中文版\nChinese summary.';
    mockFetchSuccess(makeChunksOpenAI(text));

    const gen = generateSummaryStream(makeArticle(), 'concise', 200, true);
    const { full } = await collectStream(gen);

    expect(full).toContain('中文版');
  });

  it('truncates article textContent when it exceeds MAX_INPUT_LENGTH', async () => {
    const longText = 'A'.repeat(25000);
    mockFetchSuccess(makeChunksOpenAI('Summarised.'));

    const gen = generateSummaryStream(makeArticle({ textContent: longText }));
    const { full } = await collectStream(gen);

    expect(full).toBe('Summarised.');
  });
});

// ── Integration: Anthropic ─────────────────────────────────────────────

describe('generateSummaryStream – Anthropic', () => {
  beforeEach(async () => {
    resetStorage();
    await chrome.storage.local.set({
      apiKey: 'sk-ant-test-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('yields chunks from content_block_delta events', async () => {
    const text = 'This is the Anthropic response.';
    mockFetchSuccess(makeChunksAnthropic(text));

    const gen = generateSummaryStream(makeArticle());
    const { yielded, full } = await collectStream(gen);

    expect(yielded.length).toBeGreaterThan(0);
    expect(full).toBe(text);
  });

  it('yields nothing for empty response', async () => {
    mockFetchSuccess(makeChunksAnthropic(''));

    const gen = generateSummaryStream(makeArticle());
    const { yielded, full } = await collectStream(gen);

    expect(yielded).toEqual([]);
    expect(full).toBe('');
  });

  it('throws on 401 unauthorized', async () => {
    mockFetchError(401, 'Unauthorized');

    await expect(async () => {
      const gen = generateSummaryStream(makeArticle());
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow(/API 错误 401/);
  });

  it('throws on 500 server error', async () => {
    mockFetchError(500, 'Overloaded');

    await expect(async () => {
      const gen = generateSummaryStream(makeArticle());
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow(/API 错误 500/);
  });
});

// ── Edge cases (provider-agnostic) ─────────────────────────────────

describe('generateSummaryStream – edge cases', () => {
  beforeEach(() => {
    resetStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('throws if API key is missing', async () => {
    await chrome.storage.local.set({
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    await expect(async () => {
      const gen = generateSummaryStream(makeArticle());
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow(/API 密钥未配置/);
  });

  it('throws if article has no textContent', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    await expect(async () => {
      const gen = generateSummaryStream(makeArticle({ textContent: '' }));
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow(/文章无文本内容/);
  });

  it('throws if article textContent is only whitespace', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    await expect(async () => {
      const gen = generateSummaryStream(makeArticle({ textContent: '   \n  \t  ' }));
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow(/文章无文本内容/);
  });
});
