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
  anthropic: { label: 'Anthropic', url: 'https://api.anthropic.com/v1',    model: 'claude-sonnet-4-20250514' },
  ollama:    { label: 'Ollama',    url: 'http://localhost:11434/v1',       model: 'llama3' },
};

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const config = await readConfig();
  if (!config.apiKey) return { ok: false, message: '请先填写 API 密钥' };

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
    });
    if (res.ok) return { ok: true, message: '连接成功' };
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

const PROMPT_CFG: Record<SummaryStyle, PromptConfig> = {
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

function buildPrompt(
  article: ArticleData,
  style: SummaryStyle,
  wordCount: number,
  bilingual: boolean,
  customPrompt?: string,
): { system: string; user: string } {
  let system: string;

  if (style === 'custom' && customPrompt) {
    // Use user's custom prompt, inject word count if not unlimited
    system = customPrompt;
    if (wordCount > 0) {
      system = system.replace(/\{wordCount\}/g, String(wordCount));
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

function buildBody(config: AIConfig, system: string, user: string, maxTokens: number, stream: boolean) {
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

const MAX_INPUT_LENGTH = 24000;

function computeMaxTokens(wordCount: number): number {
  // 1 word ≈ 1.5 tokens; add headroom for glossary + formatting
  return Math.ceil(wordCount * 2) + 600;
}

// ── Non-streaming ──────────────────────────────────────────────────────

export async function generateSummary(
  article: ArticleData,
  style: SummaryStyle = 'concise',
  wordCount = 200,
  bilingual = false,
  customPrompt?: string,
): Promise<string> {
  const config = await readConfig();

  if (!config.apiKey) throw new Error('API key not configured.');
  if (!article.textContent?.trim()) throw new Error('Article has no text content.');

  const { system, user } = buildPrompt(article, style, wordCount, bilingual, customPrompt);
  const maxTokens = computeMaxTokens(wordCount);

  const truncatedUser =
    user.length > MAX_INPUT_LENGTH
      ? user.slice(0, MAX_INPUT_LENGTH) + '\n\n[Article truncated]'
      : user;

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify(buildBody(config, system, truncatedUser, maxTokens, false)),
  });

  if (!res.ok) {
    let e = '';
    try { e = await res.text(); } catch { /* */ }
    throw new Error(`API error ${res.status}: ${e || res.statusText}`);
  }

  const data = await res.json();
  const content: string | undefined = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('API response missing content');
  return content;
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

  if (!config.apiKey) throw new Error('API key not configured.');
  if (!article.textContent?.trim()) throw new Error('Article has no text content.');

  const { system, user } = buildPrompt(article, style, wordCount, bilingual, customPrompt);
  const maxTokens = computeMaxTokens(wordCount);

  const truncatedUser =
    user.length > MAX_INPUT_LENGTH
      ? user.slice(0, MAX_INPUT_LENGTH) + '\n\n[Article truncated]'
      : user;

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify(buildBody(config, system, truncatedUser, maxTokens, true)),
    signal,
  });

  if (!res.ok) {
    let e = '';
    try { e = await res.text(); } catch { /* */ }
    throw new Error(`API error ${res.status}: ${e || res.statusText}`);
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
