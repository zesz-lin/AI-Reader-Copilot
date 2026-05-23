import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isAnthropicUrl,
  computeMaxTokens,
  buildPrompt,
  buildBody,
  PROVIDERS,
  PROMPT_CFG,
  MAX_INPUT_LENGTH,
  anthropicParseStream,
  testConnection,
} from '../../ai/client';
import { chrome, resetStorage } from '../setup';
import type { ArticleData, AIConfig, SummaryStyle } from '../../shared';

// ── testConnection ───────────────────────────────────────────────────────

describe('testConnection', () => {
  beforeEach(() => {
    resetStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns NO_API_KEY when apiKey is empty', async () => {
    await chrome.storage.local.set({
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('NO_API_KEY');
  });

  it('returns SUCCESS when API responds ok (OpenAI-compatible)', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('OK'),
    }) as unknown as typeof globalThis.fetch;

    const result = await testConnection();
    expect(result.ok).toBe(true);
    expect(result.message).toBe('SUCCESS');
  });

  it('returns HTTP error when API responds with error and no body (OpenAI-compatible)', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockRejectedValue(new Error('no body')),
    }) as unknown as typeof globalThis.fetch;

    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('HTTP 401');
  });

  it('returns error body when API responds with error text (OpenAI-compatible)', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi.fn().mockResolvedValue('{"error":{"message":"Invalid model"}}'),
    }) as unknown as typeof globalThis.fetch;

    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Invalid model');
  });

  it('uses anthropic endpoint and headers when URL matches Anthropic', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-ant-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    });

    let fetchArgs: unknown[] = [];
    globalThis.fetch = vi.fn().mockImplementation((...args: unknown[]) => {
      fetchArgs = args;
      return Promise.resolve({ ok: true, status: 200, text: vi.fn().mockResolvedValue('OK') });
    }) as unknown as typeof globalThis.fetch;

    const result = await testConnection();
    expect(result.ok).toBe(true);
    // Should call /v1/messages (Anthropic endpoint)
    expect(fetchArgs[0]).toContain('/v1/messages');
    // Should include x-api-key header
    const headers = fetchArgs[1] as Record<string, Record<string, string>>;
    expect(headers?.headers?.['x-api-key']).toBe('sk-ant-key');
    expect(headers?.headers?.['anthropic-version']).toBe('2023-06-01');
  });

  it('returns network error when fetch throws', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof globalThis.fetch;

    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Failed to fetch');
  });

  it('returns network error with string representation when non-Error thrown', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    // Mock a non-Error rejection (e.g., a string)
    globalThis.fetch = vi.fn().mockRejectedValue('Network timeout') as unknown as typeof globalThis.fetch;

    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Network timeout');
  });

  it('includes Authorization Bearer header for non-Anthropic providers', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-ds-key',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
      temperature: 0.3,
    });

    let fetchHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: Record<string, unknown>) => {
      fetchHeaders = opts?.headers as Record<string, string>;
      return Promise.resolve({ ok: true, status: 200, text: vi.fn().mockResolvedValue('OK') });
    }) as unknown as typeof globalThis.fetch;

    await testConnection();
    expect(fetchHeaders['Authorization']).toBe('Bearer sk-ds-key');
    expect(fetchHeaders['x-api-key']).toBeUndefined();
  });

  it('sends correct body for Anthropic (no system/messages wrapping)', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-ant-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    });

    let requestBody = '';
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: Record<string, unknown>) => {
      requestBody = opts?.body as string;
      return Promise.resolve({ ok: true, status: 200, text: vi.fn().mockResolvedValue('OK') });
    }) as unknown as typeof globalThis.fetch;

    await testConnection();
    const body = JSON.parse(requestBody);
    // Anthropic test requests uses messages array directly, not wrapped in system
    expect(body.messages).toBeDefined();
    expect(body.messages[0].content).toBe('Hi');
    expect(body.max_tokens).toBe(5);
  });
});

// ── isAnthropicUrl ─────────────────────────────────────────────────────

describe('isAnthropicUrl', () => {
  it('returns true for api.anthropic.com', () => {
    expect(isAnthropicUrl('https://api.anthropic.com')).toBe(true);
  });

  it('returns true for anthropic.com with path', () => {
    expect(isAnthropicUrl('https://api.anthropic.com/v1')).toBe(true);
  });

  it('returns true for anthropic.net', () => {
    expect(isAnthropicUrl('https://api.anthropic.net')).toBe(true);
  });

  it('returns false for deepseek.com', () => {
    expect(isAnthropicUrl('https://api.deepseek.com/v1')).toBe(false);
  });

  it('returns false for openai.com', () => {
    expect(isAnthropicUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('returns false for localhost', () => {
    expect(isAnthropicUrl('http://localhost:11434/v1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAnthropicUrl('')).toBe(false);
  });

  it('does not match substrings like my-anthropic.com-fake', () => {
    // The regex uses \b word boundary, so this should be false
    expect(isAnthropicUrl('https://my-anthropic.com-fake.com')).toBe(false);
  });
});

// ── computeMaxTokens ───────────────────────────────────────────────────

describe('computeMaxTokens', () => {
  it('returns base 600 for 0 word count', () => {
    expect(computeMaxTokens(0)).toBe(600);
  });

  it('returns correct value for 200 words', () => {
    // ceil(200 * 2) + 600 = 400 + 600 = 1000
    expect(computeMaxTokens(200)).toBe(1000);
  });

  it('returns correct value for 400 words', () => {
    expect(computeMaxTokens(400)).toBe(1400);
  });

  it('handles odd word counts with ceil', () => {
    // ceil(150 * 2) + 600 = 300 + 600 = 900
    expect(computeMaxTokens(150)).toBe(900);
  });
});

// ── PROVIDERS ──────────────────────────────────────────────────────────

describe('PROVIDERS', () => {
  it('has all expected providers', () => {
    expect(Object.keys(PROVIDERS)).toEqual(['deepseek', 'openai', 'anthropic', 'ollama']);
  });

  it('deepseek has correct url and model', () => {
    expect(PROVIDERS.deepseek).toEqual({
      label: 'DeepSeek',
      url: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
    });
  });

  it('anthropic has correct url and model', () => {
    expect(PROVIDERS.anthropic).toEqual({
      label: 'Anthropic',
      url: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('openai has correct url and model', () => {
    expect(PROVIDERS.openai).toEqual({
      label: 'OpenAI',
      url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
  });

  it('ollama has correct url and model', () => {
    expect(PROVIDERS.ollama).toEqual({
      label: 'Ollama',
      url: 'http://localhost:11434/v1',
      model: 'llama3.2',
    });
  });

  it('every provider has label, url, and model', () => {
    for (const [key, p] of Object.entries(PROVIDERS)) {
      expect(p.label).toBeTruthy();
      expect(p.url).toBeTruthy();
      expect(p.model).toBeTruthy();
    }
  });
});

// ── PROMPT_CFG ─────────────────────────────────────────────────────────

describe('PROMPT_CFG', () => {
  it('has entries for concise, detailed, academic, custom', () => {
    expect(Object.keys(PROMPT_CFG)).toEqual(['custom', 'concise', 'detailed', 'academic']);
  });

  it('each config has vocabLevel and summaryDepth', () => {
    for (const [key, cfg] of Object.entries(PROMPT_CFG)) {
      expect(cfg.vocabLevel).toBeTruthy();
      expect(cfg.summaryDepth).toBeTruthy();
    }
  });

  it('concise uses simple vocabulary level', () => {
    expect(PROMPT_CFG.concise.vocabLevel).toContain('3000-word');
  });

  it('academic uses advanced vocabulary level', () => {
    expect(PROMPT_CFG.academic.vocabLevel).toContain('10000-word');
  });
});

// ── buildPrompt ────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<ArticleData> = {}): ArticleData {
  return {
    title: 'Test Article Title',
    textContent: 'This is the article text content for testing.',
    content: '<p>This is the article content.</p>',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('returns system and user fields', () => {
    const result = buildPrompt(makeArticle(), 'concise', 200, false);
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
  });

  it('includes the article title in the user prompt', () => {
    const article = makeArticle({ title: 'My Special Title' });
    const result = buildPrompt(article, 'concise', 200, false);
    expect(result.user).toContain('My Special Title');
  });

  it('includes byline in user prompt when provided', () => {
    const article = makeArticle({ byline: 'John Doe' });
    const result = buildPrompt(article, 'concise', 200, false);
    expect(result.user).toContain('By: John Doe');
  });

  it('omits byline when not provided', () => {
    const result = buildPrompt(makeArticle(), 'concise', 200, false);
    expect(result.user).not.toContain('By:');
  });

  it('concise style uses the correct vocabulary description', () => {
    const result = buildPrompt(makeArticle(), 'concise', 200, false);
    expect(result.system).toContain('3000-word');
  });

  it('detailed style uses the correct vocabulary description', () => {
    const result = buildPrompt(makeArticle(), 'detailed', 200, false);
    expect(result.system).toContain('6000-word');
  });

  it('academic style uses the correct vocabulary description', () => {
    const result = buildPrompt(makeArticle(), 'academic', 200, false);
    expect(result.system).toContain('10000-word');
  });

  it('includes word count constraint when wordCount > 0', () => {
    const result = buildPrompt(makeArticle(), 'concise', 400, false);
    expect(result.system).toContain('400');
    expect(result.system).toContain('Strictly limit');
  });

  it('omits word count constraint when wordCount is 0 (unlimited)', () => {
    const result = buildPrompt(makeArticle(), 'concise', 0, false);
    expect(result.system).not.toContain('Strictly limit');
  });

  it('adds bilingual section when bilingual is true', () => {
    const result = buildPrompt(makeArticle(), 'concise', 200, true);
    expect(result.system).toContain('## 中文版');
  });

  it('does not add bilingual section when bilingual is false', () => {
    const result = buildPrompt(makeArticle(), 'concise', 200, false);
    expect(result.system).not.toContain('中文版');
  });

  it('custom style with customPrompt uses the custom prompt', () => {
    const result = buildPrompt(makeArticle(), 'custom', 200, false, 'Write a TL;DR summary.');
    expect(result.system).toContain('Write a TL;DR summary');
  });

  it('custom style replaces {wordCount} placeholder', () => {
    const result = buildPrompt(makeArticle(), 'custom', 500, false, 'Limit to {wordCount} words');
    expect(result.system).toContain('Limit to 500 words');
  });

  it('custom style with wordCount > 0 adds word limit', () => {
    const result = buildPrompt(makeArticle(), 'custom', 300, false, 'My prompt');
    expect(result.system).toContain('Strictly limit the output to 300');
  });

  it('custom style with wordCount 0 does not add word limit', () => {
    const result = buildPrompt(makeArticle(), 'custom', 0, false, 'My prompt');
    expect(result.system).not.toContain('Strictly limit');
  });

  it('custom style without customPrompt falls back to prompt cfg', () => {
    // custom style but no customPrompt provided
    const result = buildPrompt(makeArticle(), 'custom', 200, false, undefined);
    // Should use the base prompt since customPrompt is falsy
    expect(result.system).toContain('You are a reading assistant');
  });

  it('includes the article textContent in the user prompt', () => {
    const article = makeArticle({ textContent: 'Some interesting text here.' });
    const result = buildPrompt(article, 'concise', 200, false);
    expect(result.user).toContain('Some interesting text here');
  });

  it('glossary section markdown is present in the system prompt', () => {
    const result = buildPrompt(makeArticle(), 'concise', 200, false);
    expect(result.system).toContain('## Glossary');
  });

  it('summary section markdown is present in the system prompt', () => {
    const result = buildPrompt(makeArticle(), 'concise', 200, false);
    expect(result.system).toContain('## Summary');
  });
});

// ── buildBody ──────────────────────────────────────────────────────────

describe('buildBody', () => {
  const config: AIConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://test.com/v1',
    model: 'test-model',
    temperature: 0.5,
  };

  it('returns object with model, messages, temperature, max_tokens, stream', () => {
    const result = buildBody(config, 'system prompt', 'user message', 1000, true);
    expect(result).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user message' },
      ],
      temperature: 0.5,
      max_tokens: 1000,
      stream: true,
    });
  });

  it('uses config temperature', () => {
    const result = buildBody({ ...config, temperature: 0.8 }, 's', 'u', 100, false);
    expect(result.temperature).toBe(0.8);
  });
});

// ── anthropicParseStream ───────────────────────────────────────────────

describe('anthropicParseStream', () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  async function collectFromStream(chunks: string[]): Promise<{
    yielded: string[];
    returned: string;
  }> {
    const stream = makeStream(chunks);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const gen = anthropicParseStream(reader, decoder);
    const yielded: string[] = [];
    let returned = '';
    for await (const chunk of gen) {
      yielded.push(chunk);
    }
    // Get the return value
    const it = anthropicParseStream(reader, decoder);
    // We need a fresh instance to get return - let's just use the gen
    returned = await gen.return('') as unknown as string;
    return { yielded, returned };
  }

  it('yields text from content_block_delta events', async () => {
    const sseData = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const stream = makeStream(sseData);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const gen = anthropicParseStream(reader, decoder);

    const yielded: string[] = [];
    for await (const chunk of gen) {
      yielded.push(chunk);
    }

    expect(yielded).toEqual(['Hello', ' world']);
  });

  it('handles empty text_delta gracefully', async () => {
    const sseData = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    ];

    const stream = makeStream(sseData);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const gen = anthropicParseStream(reader, decoder);

    const yielded: string[] = [];
    for await (const chunk of gen) {
      yielded.push(chunk);
    }

    expect(yielded).toEqual([]);
  });

  it('ignores non-text events like message_start and ping', async () => {
    const sseData = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123"}}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Only this"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const stream = makeStream(sseData);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const gen = anthropicParseStream(reader, decoder);

    const yielded: string[] = [];
    for await (const chunk of gen) {
      yielded.push(chunk);
    }

    expect(yielded).toEqual(['Only this']);
  });

  it('throws on error events', async () => {
    const sseData = [
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ];

    const stream = makeStream(sseData);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const gen = anthropicParseStream(reader, decoder);

    await expect(async () => {
      for await (const _ of gen) { /* */ }
    }).rejects.toThrow('Overloaded');
  });

  it('handles partial SSE chunks split across reads', async () => {
    const sseData = [
      'event: content_block_delta\nda',
      'ta: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"He',
      'llo"}}\n\n',
    ];

    const stream = makeStream(sseData);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const gen = anthropicParseStream(reader, decoder);

    const yielded: string[] = [];
    for await (const chunk of gen) {
      yielded.push(chunk);
    }

    expect(yielded).toEqual(['Hello']);
  });

  it('skips invalid JSON data lines silently', async () => {
    const sseData = [
      'event: content_block_delta\ndata: not-json\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Works"}}\n\n',
    ];

    const stream = makeStream(sseData);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const gen = anthropicParseStream(reader, decoder);

    const yielded: string[] = [];
    for await (const chunk of gen) {
      yielded.push(chunk);
    }

    expect(yielded).toEqual(['Works']);
  });
});
