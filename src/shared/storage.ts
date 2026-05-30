import type { HistoryEntry, SummaryStyle } from './types';

const HISTORY_KEY = 'history';
const MAX_ENTRIES = 20;

function uid(): string {
  return crypto.randomUUID();
}

export async function saveToHistory(entry: {
  url: string;
  title: string;
  summaryMarkdown: string;
  style: SummaryStyle;
  rawText: string;
}): Promise<HistoryEntry[]> {
  const record: HistoryEntry = {
    id: uid(),
    url: entry.url,
    title: entry.title,
    summaryMarkdown: entry.summaryMarkdown,
    style: entry.style,
    rawText: entry.rawText,
    timestamp: Date.now(),
  };

  const result = await chrome.storage.local.get(HISTORY_KEY);
  const existing: HistoryEntry[] = (result[HISTORY_KEY] as HistoryEntry[]) ?? [];

  const filtered = existing.filter(
    (e) => !(e.url === record.url && e.style === record.style),
  );
  const updated = [record, ...filtered].slice(0, MAX_ENTRIES);

  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  return updated;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return (result[HISTORY_KEY] as HistoryEntry[]) ?? [];
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}

export async function deleteFromHistory(id: string): Promise<HistoryEntry[]> {
  const entries = await getHistory();
  const updated = entries.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  return updated;
}
