export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

export interface ArticleData {
  title: string;
  textContent: string;
  content: string;
  excerpt?: string;
  byline?: string;
}

export type SummaryStyle = 'concise' | 'detailed' | 'academic' | 'custom';

export interface ArticleRecord {
  url: string;
  title: string;
  summaryMarkdown: string | null;
  /** Cache keys: style name (e.g. "concise") or "style:zh" for bilingual */
  summaries: Record<string, string>;
  rawText: string;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  summaryMarkdown: string;
  style: SummaryStyle;
  rawText: string;
  timestamp: number;
}
