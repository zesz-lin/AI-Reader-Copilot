import type { ArticleData, AIConfig, SummaryStyle } from '../shared';

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
  // Match exactly 'anthropic.com' or 'anthropic.net' as a domain (not a substring)
  return /(?:^|\.)anthropic\.(com|net)(?:[/:#?]|$)/.test(baseUrl);
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const config = await readConfig();
  if (!config.apiKey) return { ok: false, message: 'NO_API_KEY' };

  try {
    const anthropic = isAnthropicUrl(config.baseUrl);
    const body = anthropic
      ? JSON.stringify({ model: config.model, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] })
      : JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });

    const endpoint = anthropic ? `${config.baseUrl}/v1/messages` : `${config.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (anthropic) {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(endpoint, { method: 'POST', headers, body });
    if (res.ok) return { ok: true, message: 'SUCCESS' };
    let errBody = '';
    try { errBody = await res.text(); } catch { /* */ }
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
    // Custom mode: use the user's prompt as the system prompt (no base prompt)
    system = customPrompt.replace(/\{wordCount\}/g, String(wordCount));

    // Append word limit if not unlimited
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

export function computeMaxTokens(wordCount: number): number {
  // 1 word ≈ 1.5 tokens; add headroom for glossary + formatting
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
      const t = line.trim();
      if (t.startsWith('event: ')) {
        currentEvent = t.slice(7).trim();
      } else if (t.startsWith('data: ')) {
        const d = t.slice(6);
        if (d === '[DONE]') continue;
        try {
          const parsed = JSON.parse(d);
          // Handle error events from Anthropic
          if (parsed.type === 'error') {
            throw new Error(parsed.error?.message || 'Anthropic API error');
          }
          // Extract text from content_block_delta events
          if (currentEvent === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const text = parsed.delta.text || '';
            if (text) {
              fullContent += text;
              yield text;
            }
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      } // else: blank line = event separator, ignore
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

  if (!config.apiKey) throw new Error('API 密钥未配置 / API key not configured.');
  if (!article.textContent?.trim()) throw new Error('文章无文本内容 / Article has no text content.');

  const { system, user } = buildPrompt(article, style, wordCount, bilingual, customPrompt);
  const maxTokens = computeMaxTokens(wordCount);

  const truncatedUser =
    user.length > MAX_INPUT_LENGTH
      ? user.slice(0, MAX_INPUT_LENGTH) + '\n\n[Article truncated]'
      : user;

  const anthropic = isAnthropicUrl(config.baseUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (anthropic) {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';

    const body = JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: truncatedUser }],
      temperature: config.temperature,
      stream: true,
    });

    const res = await fetch(`${config.baseUrl}/v1/messages`, {
      method: 'POST', headers, body, signal,
    });

    if (!res.ok) {
      let e = '';
      try { e = await res.text(); } catch { /* */ }
      throw new Error(`API 错误 ${res.status} / API error ${res.status}: ${e || res.statusText}`);
    }

    return yield* anthropicParseStream(res.body!.getReader(), new TextDecoder());
  }

  // OpenAI-compatible providers
  headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody(config, system, truncatedUser, maxTokens, true)),
    signal,
  });

  if (!res.ok) {
    let e = '';
    try { e = await res.text(); } catch { /* */ }
    throw new Error(`API 错误 ${res.status} / API error ${res.status}: ${e || res.statusText}`);
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
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const d = t.slice(6);
      if (d === '[DONE]') continue;
      try {
        const p = JSON.parse(d);
        const c: string | undefined = p.choices?.[0]?.delta?.content;
        if (c) { fullContent += c; yield c; }
      } catch { /* */ }
    }
  }
  return fullContent;
}
