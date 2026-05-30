import type { ArticleData, AIConfig, SummaryStyle } from '../shared';

// ── Lightweight i18n for service worker context ────────────────────────

let _lang: 'zh' | 'en' = 'zh';

chrome.storage.local.get('language').then((r) => {
  if (r.language === 'zh' || r.language === 'en') _lang = r.language;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.language?.newValue) _lang = changes.language.newValue;
});

function t(zh: string, en: string): string {
  return _lang === 'en' ? en : zh;
}

const DEFAULT_CONFIG: AIConfig = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-reasoner',
  temperature: 0.3,
};

// ── Provider presets ───────────────────────────────────────────────────

interface ProviderPreset { label: string; url: string; model: string }

export const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek:  { label: 'DeepSeek',  url: 'https://api.deepseek.com/v1',     model: 'deepseek-reasoner' },
  openai:    { label: 'OpenAI',    url: 'https://api.openai.com/v1',       model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', url: 'https://api.anthropic.com',       model: 'claude-sonnet-4-20250514' },
  ollama:    { label: 'Ollama',    url: 'http://localhost:11434/v1',       model: 'llama3.2' },
};

export function isAnthropicUrl(baseUrl: string): boolean {
  return /(?:^|\.)anthropic\.(com|net)(?:[/:#?]|$)/.test(baseUrl);
}

// ── Anthropic API helper ──────────────────────────────────────────────

interface AnthropicRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  system?: string;
  messages: { role: string; content: string }[];
  maxTokens: number;
  temperature?: number;
  stream?: boolean;
}

export function buildAnthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
}

export function buildAnthropicEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/messages`;
}

export function buildAnthropicBody(req: AnthropicRequest): string {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: req.messages,
  };
  if (req.system) body.system = req.system;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stream !== undefined) body.stream = req.stream;
  return JSON.stringify(body);
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const config = await readConfig();
  if (!config.apiKey) return { ok: false, message: 'NO_API_KEY' };

  try {
    const anthropic = isAnthropicUrl(config.baseUrl);

    const body = anthropic
      ? buildAnthropicBody({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 5,
        })
      : JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });

    const endpoint = anthropic
      ? buildAnthropicEndpoint(config.baseUrl)
      : `${config.baseUrl}/chat/completions`;

    const headers = anthropic
      ? buildAnthropicHeaders(config.apiKey)
      : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` };

    const res = await fetch(endpoint, { method: 'POST', headers, body });
    if (res.ok) return { ok: true, message: 'SUCCESS' };
    let errBody = '';
    try { errBody = await res.text(); } catch (e) { console.warn('[ai-reader-copilot] Failed to read error body:', e); }
    return { ok: false, message: errBody ? errBody.slice(0, 300) : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function readConfig(): Promise<AIConfig> {
  const result = await chrome.storage.local.get(['apiKey', 'baseUrl', 'model', 'temperature']);
  return {
    apiKey: (result.apiKey as string) || DEFAULT_CONFIG.apiKey,
    baseUrl: (result.baseUrl as string) || DEFAULT_CONFIG.baseUrl,
    model: (result.model as string) || DEFAULT_CONFIG.model,
    temperature: typeof result.temperature === 'number' ? result.temperature : DEFAULT_CONFIG.temperature,
  };
}

// ── Prompts (vocabulary-level based, 2 sections: Summary + Glossary) ───

interface PromptConfig {
  vocabLevel: string;
  summaryDepth: string;
}

export const PROMPT_CFG: Record<SummaryStyle, PromptConfig> = {
  custom: {
    vocabLevel: 'appropriate vocabulary for the topic',
    summaryDepth: 'Follow the custom instructions below for structure and depth.',
  },
  concise: {
    vocabLevel: 'simple vocabulary (approximately 3000-word level, suitable for middle-school readers)',
    summaryDepth: 'Cover the main argument and conclusion concisely in flowing paragraph form (not bullet points).',
  },
  detailed: {
    vocabLevel: 'moderate vocabulary (approximately 6000-word level, suitable for college-educated readers)',
    summaryDepth: 'Cover the main argument, key evidence, supporting details, and conclusion in flowing paragraph form (not bullet points). Be thorough.',
  },
  academic: {
    vocabLevel: 'advanced academic vocabulary (approximately 10000-word level, suitable for scholarly readers)',
    summaryDepth: 'Cover the theoretical framework, methodology, key findings, critical analysis, and conclusion in flowing paragraph form (not bullet points). Use formal academic register.',
  },
};

export function buildPrompt(
  article: ArticleData,
  style: SummaryStyle,
  wordCount: number,
  bilingual: boolean,
  customPrompt?: string,
): { system: string; user: string } {
  let system: string;

  if (style === 'custom' && customPrompt) {
    system = customPrompt.replace(/\{wordCount\}/g, String(wordCount));

    if (wordCount > 0) {
      system += `\n\n**Strictly limit the output to ${wordCount}–${Math.ceil(wordCount * 1.2)} words.**`;
    }
  } else {
    const cfg = PROMPT_CFG[style];

    const maxWords = Math.ceil(wordCount * 1.2);
    const wcConstraint = wordCount > 0
      ? `**Strictly limit the summary to ${wordCount}–${maxWords} words.** Do NOT exceed ${maxWords} words under any circumstances.`
      : '';

    system = `You are a reading assistant. Summarize the article in English using ${cfg.vocabLevel}.

Output exactly two sections in Markdown:

## Summary
A flowing prose summary of the entire article. ${wcConstraint}
${cfg.summaryDepth}

## Glossary
- **Term**: Brief definition — only terms essential to understanding the article

Rules: output only the Markdown, no preamble.${wordCount > 0 ? ' The word limit is a hard constraint.' : ''}`;
  }

  if (bilingual) {
    system += `\n\nAfter the English summary, add a horizontal rule (---) and provide a complete Chinese translation with the same structure under a "## 中文版" heading.`;
  }

  const byline = article.byline ? `\nBy: ${article.byline}` : '';
  const user = `Please analyze the following article:\n\nTitle: ${article.title}${byline}\n\n${article.textContent}`;
  return { system, user };
}

export function buildBody(config: AIConfig, system: string, user: string, maxTokens: number, stream: boolean) {
  return {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: config.temperature,
    max_tokens: maxTokens,
    stream,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

export const MAX_INPUT_LENGTH = 24000;

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.8 ? truncated.slice(0, lastSpace) : truncated) + '\n\n' + t('[文章已截断]', '[Article truncated]');
}

export function computeMaxTokens(wordCount: number): number {
  return Math.ceil(wordCount * 2) + 600;
}

// ── Anthropic SSE stream parser ────────────────────────────────────────

export async function* anthropicParseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
): AsyncGenerator<string, string, undefined> {
  let buffer = '';
  let fullContent = '';
  let currentEvent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('event: ')) {
        currentEvent = trimmed.slice(7).trim();
      } else if (trimmed.startsWith('data: ')) {
        const d = trimmed.slice(6);
        if (d === '[DONE]') continue;
        try {
          const parsed = JSON.parse(d);
          if (parsed.type === 'error') {
            throw new Error(parsed.error?.message || t('Anthropic API 错误', 'Anthropic API error'));
          }
          if (currentEvent === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const text = parsed.delta.text || '';
            if (text) {
              fullContent += text;
              yield text;
            }
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            console.warn('[ai-reader-copilot] Anthropic SSE JSON parse error, skipping line');
            continue;
          }
          throw e;
        }
      }
    }
  }
  return fullContent;
}

// ── Streaming ──────────────────────────────────────────────────────────

export async function* generateSummaryStream(
  article: ArticleData,
  style: SummaryStyle = 'concise',
  wordCount = 200,
  bilingual = false,
  signal?: AbortSignal,
  customPrompt?: string,
): AsyncGenerator<string, string, undefined> {
  const config = await readConfig();

  if (!config.apiKey) throw new Error(t('API 密钥未配置', 'API key not configured.'));
  if (!article.textContent?.trim()) throw new Error(t('文章无文本内容', 'Article has no text content.'));

  const { system, user } = buildPrompt(article, style, wordCount, bilingual, customPrompt);
  const maxTokens = computeMaxTokens(wordCount);

  const truncatedUser = truncateAtWordBoundary(user, MAX_INPUT_LENGTH);

  const anthropic = isAnthropicUrl(config.baseUrl);

  if (anthropic) {
    const headers = buildAnthropicHeaders(config.apiKey);
    const body = buildAnthropicBody({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      system,
      messages: [{ role: 'user', content: truncatedUser }],
      maxTokens,
      temperature: config.temperature,
      stream: true,
    });

    const res = await fetch(buildAnthropicEndpoint(config.baseUrl), {
      method: 'POST', headers, body, signal,
    });

    if (!res.ok) {
      let e = '';
      try { e = await res.text(); } catch (err) { console.warn('[ai-reader-copilot] Failed to read Anthropic error body:', err); }
      throw new Error(`${t('API 错误', 'API error')} ${res.status}: ${e || res.statusText}`);
    }

    return yield* anthropicParseStream(res.body!.getReader(), new TextDecoder());
  }

  // OpenAI-compatible providers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody(config, system, truncatedUser, maxTokens, true)),
    signal,
  });

  if (!res.ok) {
    let e = '';
    try { e = await res.text(); } catch (err) { console.warn('[ai-reader-copilot] Failed to read OpenAI error body:', err); }
    throw new Error(`${t('API 错误', 'API error')} ${res.status}: ${e || res.statusText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const d = trimmed.slice(6);
      if (d === '[DONE]') continue;
      try {
        const p = JSON.parse(d);
        const c: string | undefined = p.choices?.[0]?.delta?.content;
        if (c) { fullContent += c; yield c; }
      } catch {
        console.warn('[ai-reader-copilot] OpenAI SSE JSON parse error, skipping line');
      }
    }
  }
  return fullContent;
}
