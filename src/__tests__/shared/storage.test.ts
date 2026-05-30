import { describe, it, expect, beforeEach } from 'vitest';
import { saveToHistory, getHistory, clearHistory, deleteFromHistory } from '../../shared/storage';
import { resetStorage } from '../setup';
import type { SummaryStyle } from '../../shared';

beforeEach(() => {
  resetStorage();
});

function makeEntry(overrides: Partial<{
  url: string;
  title: string;
  summaryMarkdown: string;
  style: SummaryStyle;
  rawText: string;
}> = {}) {
  return {
    url: 'https://example.com/article',
    title: 'Test Article',
    summaryMarkdown: '## Summary\n\nTest summary content.',
    style: 'concise' as SummaryStyle,
    rawText: 'Raw article text.',
    ...overrides,
  };
}

async function countHistory(): Promise<number> {
  return (await getHistory()).length;
}

// Helper to check ID format: UUID v4
function isValidId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

describe('saveToHistory', () => {
  it('saves a new entry and returns the updated list', async () => {
    const entry = makeEntry();
    const result = await saveToHistory(entry);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: entry.url,
      title: entry.title,
      style: entry.style,
    });
    expect(isValidId(result[0].id)).toBe(true);
    expect(typeof result[0].timestamp).toBe('number');
  });

  it('replaces existing entry with same url + style (dedup)', async () => {
    await saveToHistory(makeEntry({ summaryMarkdown: 'Old summary' }));
    await saveToHistory(makeEntry({ summaryMarkdown: 'New summary' }));

    const history = await getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].summaryMarkdown).toBe('New summary');
  });

  it('keeps different styles as separate entries', async () => {
    await saveToHistory(makeEntry({ style: 'concise' }));
    await saveToHistory(makeEntry({ style: 'detailed' }));

    const history = await getHistory();
    expect(history).toHaveLength(2);
  });

  it('orders entries newest first', async () => {
    await saveToHistory(makeEntry({ style: 'concise' }));
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    await saveToHistory(makeEntry({ style: 'detailed' }));

    const history = await getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].style).toBe('detailed'); // most recent first
    expect(history[1].style).toBe('concise');
  });

  it('limits to MAX_ENTRIES (20)', async () => {
    for (let i = 0; i < 25; i++) {
      await saveToHistory(makeEntry({
        url: `https://example.com/article-${i}`,
        title: `Article ${i}`,
        style: 'concise',
      }));
    }
    const history = await getHistory();
    expect(history.length).toBeLessThanOrEqual(20);
  });
});

describe('getHistory', () => {
  it('returns empty array when no history exists', async () => {
    const history = await getHistory();
    expect(history).toEqual([]);
  });

  it('returns all saved entries', async () => {
    await saveToHistory(makeEntry({ style: 'concise' }));
    await saveToHistory(makeEntry({ style: 'detailed' }));

    const history = await getHistory();
    expect(history).toHaveLength(2);
  });
});

describe('clearHistory', () => {
  it('removes all history entries', async () => {
    await saveToHistory(makeEntry());
    await saveToHistory(makeEntry({ style: 'detailed' }));

    await clearHistory();

    const history = await getHistory();
    expect(history).toEqual([]);
  });

  it('is safe to call on empty history', async () => {
    await expect(clearHistory()).resolves.not.toThrow();
  });
});

describe('deleteFromHistory', () => {
  it('removes a specific entry by id', async () => {
    await saveToHistory(makeEntry({ style: 'concise' }));
    await saveToHistory(makeEntry({ style: 'detailed' }));

    const history = await getHistory();
    const targetId = history[0].id;

    const updated = await deleteFromHistory(targetId);
    expect(updated).toHaveLength(1);
    expect(updated.find((e) => e.id === targetId)).toBeUndefined();
  });

  it('returns the full list after removal', async () => {
    await saveToHistory(makeEntry({ style: 'concise' }));
    await saveToHistory(makeEntry({ style: 'detailed' }));
    await saveToHistory(makeEntry({ style: 'academic' }));

    const history = await getHistory();
    const targetId = history[1].id;

    const updated = await deleteFromHistory(targetId);
    expect(updated).toHaveLength(2);
  });

  it('does nothing if id does not exist', async () => {
    await saveToHistory(makeEntry());
    const updated = await deleteFromHistory('nonexistent-id');
    expect(updated).toHaveLength(1);
  });
});
