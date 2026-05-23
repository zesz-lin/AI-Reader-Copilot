import type { ArticleData, ArticleRecord, SummaryStyle, HistoryEntry } from './types';

// ── Content script → Background ────────────────────────────────────────

export interface PageInfoMessage {
  type: 'PAGE_INFO';
  payload: { url: string; title: string };
  timestamp: number;
}

export interface ArticleExtractedMessage {
  type: 'ARTICLE_EXTRACTED';
  payload: ArticleData & { url: string };
  timestamp: number;
}

export interface NoArticleFoundMessage {
  type: 'NO_ARTICLE_FOUND';
  url: string;
}

// ── Side panel → Background ────────────────────────────────────────────

export interface GenerateSummaryMessage {
  type: 'GENERATE_SUMMARY';
  style: SummaryStyle;
  wordCount: number;
  customPrompt?: string;
  force?: boolean;
  bilingual?: boolean;
}

export interface StopStreamingMessage {
  type: 'STOP_STREAMING';
}

export interface GetLastArticleMessage {
  type: 'GET_LAST_ARTICLE';
}

export interface ExtractArticleMessage {
  type: 'EXTRACT_ARTICLE';
}

export interface SaveToHistoryMessage {
  type: 'SAVE_TO_HISTORY';
  payload: {
    url: string;
    title: string;
    summaryMarkdown: string;
    style: SummaryStyle;
    rawText: string;
  };
}

export interface RedirectToArchiveMessage {
  type: 'REDIRECT_TO_ARCHIVE';
  url: string;
}

export interface GetHistoryMessage { type: 'GET_HISTORY'; }
export interface ClearHistoryMessage { type: 'CLEAR_HISTORY'; }

export interface DeleteHistoryEntryMessage {
  type: 'DELETE_HISTORY_ENTRY';
  id: string;
}

// ── Background → Side panel (push) ─────────────────────────────────────

export interface SummaryChunkMessage {
  type: 'SUMMARY_CHUNK';
  content: string;
  done: boolean;
  summaryMarkdown?: string;
  style?: SummaryStyle;
}

export interface ArchiveStatusMessage {
  type: 'ARCHIVE_STATUS';
  status: 'fetching' | 'done' | 'error';
  article?: ArticleRecord;
}

export interface TitleTranslatedMessage {
  type: 'TITLE_TRANSLATED';
  translatedTitle: string;
}

// ── Background → Content script ────────────────────────────────────────

export type ContentScriptMessage = ExtractArticleMessage;

// ── Unions ─────────────────────────────────────────────────────────────

export type AppMessage =
  | PageInfoMessage | ArticleExtractedMessage | NoArticleFoundMessage
  | GenerateSummaryMessage | GetLastArticleMessage | ExtractArticleMessage
  | SaveToHistoryMessage | GetHistoryMessage | ClearHistoryMessage
  | DeleteHistoryEntryMessage | RedirectToArchiveMessage | StopStreamingMessage;

export type SidePanelMessage = SummaryChunkMessage | ArchiveStatusMessage | TitleTranslatedMessage;

// ── Response shapes ────────────────────────────────────────────────────

export interface AppResponse { status: 'ok' | 'error'; error?: string; }

export interface SummaryResponse extends AppResponse {
  summaryMarkdown?: string;
  style?: SummaryStyle;
  cached?: boolean;
  streaming?: boolean;
}

export interface ArticleRecordResponse extends AppResponse {
  article: ArticleRecord | null;
}

export interface HistoryListResponse extends AppResponse {
  entries: HistoryEntry[];
}
