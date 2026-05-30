import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArticleRecord, ArticleRecordResponse, SummaryResponse,
  SummaryStyle, HistoryEntry, HistoryListResponse, SidePanelMessage,
} from '../shared';
import { useI18n } from './i18n';
import { useTheme } from './useTheme';
import { PROVIDERS, testConnection } from '../ai';
import MarkdownView from './MarkdownView';
import { downloadMarkdown, copyFullMarkdown, downloadMarkdownBatch } from './export';

type Status = 'idle' | 'extracting' | 'article-ready' | 'summarizing' | 'done' | 'error';
type Tab = 'article' | 'history' | 'settings';

const STYLES = ['concise', 'detailed', 'academic', 'custom'] as const;
const STORAGE_KEYS = ['apiKey', 'baseUrl', 'model', 'temperature', 'autoTranslateTitle'] as const;
const WORD_COUNTS = [200, 400, 600, 800, 1000, -1]; // -1 = unlimited
const DEFAULT_WC: Record<SummaryStyle, number> = { concise: 200, detailed: 600, academic: 1000, custom: 400 };

const btn = 'inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200 '
  + 'border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 '
  + 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 '
  + 'hover:text-neutral-900 dark:hover:text-white '
  + 'disabled:opacity-40 disabled:cursor-not-allowed';

export default function App() {
  const { t, lang, setLang, styleLabel } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();

  const [article, setArticle] = useState<ArticleRecord | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeStyle, setActiveStyle] = useState<SummaryStyle>('concise');
  const [cacheHit, setCacheHit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('article');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [streamContent, setStreamContent] = useState('');
  const [bilingual, setBilingual] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [streamPaused, setStreamPaused] = useState(false);
  const [pausedContent, setPausedContent] = useState('');
  const [wordCount, setWordCount] = useState(200);
  const [customPrompt, setCustomPrompt] = useState('');
  const [exportContent, setExportContent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const pausedContentRef = useRef('');
  const streamPausedRef = useRef(streamPaused);
  useEffect(() => { streamPausedRef.current = streamPaused; }, [streamPaused]);

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  const [model, setModel] = useState('deepseek-reasoner');
  const [temperature, setTemperature] = useState(0.3);
  const [provider, setProvider] = useState('deepseek');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [autoTranslateTitle, setAutoTranslateTitle] = useState(true);
  const [translatedTitle, setTranslatedTitle] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const cacheKey = bilingual ? `${activeStyle}:zh` : activeStyle;
  const displayedMarkdown = pausedContent && status === 'summarizing' ? pausedContent + streamContent :
    (status === 'summarizing' && streamContent)
      ? streamContent
      : pausedContent
        ? pausedContent
        : article?.summaries?.[cacheKey] ?? article?.summaryMarkdown ?? null;
  const isStyleCached = article?.summaries?.[cacheKey] != null;

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const query = searchQuery.toLowerCase();
    return history.filter(
      (entry) =>
        entry.title.toLowerCase().includes(query) ||
        entry.url.toLowerCase().includes(query) ||
        entry.summaryMarkdown.toLowerCase().includes(query),
    );
  }, [history, searchQuery]);

  const refreshHistory = useCallback(async () => {
    const res = await chrome.runtime.sendMessage<{ type: string }, HistoryListResponse>({ type: 'GET_HISTORY' });
    if (res?.status === 'ok') setHistory(res.entries);
  }, []);

  // ── Bootstrap ──────────────────────────────────────────────────────

  useEffect(() => {
    // Connect to background for stream abort on side panel close
    const port = chrome.runtime.connect({ name: 'side-panel' });

    chrome.runtime.sendMessage<{ type: string }, ArticleRecordResponse>({ type: 'GET_LAST_ARTICLE' })
      .then((res) => {
        if (res?.status === 'ok' && res.article) {
          setArticle(res.article);
          const keys = Object.keys(res.article.summaries ?? {});
          const nonZh = keys.filter(k => !k.endsWith(':zh'));
          if (nonZh.length > 0) setActiveStyle(nonZh[0] as SummaryStyle);
          setStatus(res.article.summaryMarkdown || keys.length > 0 ? 'done' : 'article-ready');
        }
      }).catch(() => {});

    chrome.runtime.sendMessage<{ type: string }, HistoryListResponse>({ type: 'GET_HISTORY' })
      .then((res) => { if (res?.status === 'ok') setHistory(res.entries); }).catch(() => {});

    chrome.storage.local.get(STORAGE_KEYS).then((r) => {
      if (r.apiKey) setApiKey(r.apiKey as string);
      if (r.baseUrl) setBaseUrl(r.baseUrl as string);
      if (r.model) setModel(r.model as string);
      if (typeof r.temperature === 'number') setTemperature(r.temperature);
      if (typeof r.autoTranslateTitle === 'boolean') setAutoTranslateTitle(r.autoTranslateTitle);
    });

    return () => { port.disconnect(); };
  }, []);

  useEffect(() => {
    function listener(message: SidePanelMessage) {
      if (message.type === 'SUMMARY_CHUNK') {
        if (message.done) {
          // If stream finished while paused, use summaryMarkdown directly
          // (background was never aborted — it contains the complete content)
          if (streamPausedRef.current) {
            if (message.summaryMarkdown) {
              setArticle((prev) => prev ? {
                ...prev,
                summaryMarkdown: message.summaryMarkdown!,
                summaries: { ...prev.summaries, [cacheKey]: message.summaryMarkdown! },
              } : null);
              setExportContent(message.summaryMarkdown!);
            } else {
              setStatus('error'); setError(t('aiEmpty'));
            }
            return;
          }

          // Normal done handling
          if (message.summaryMarkdown) {
            // Merge with paused content if this was a continued stream
            const prefix = pausedContentRef.current;
            const fullSummary = prefix ? prefix + message.summaryMarkdown : message.summaryMarkdown!;
            setArticle((prev) => prev ? {
              ...prev,
              summaryMarkdown: fullSummary,
              summaries: { ...prev.summaries, [cacheKey]: fullSummary },
            } : null);
            setPausedContent('');
            pausedContentRef.current = '';
            setExportContent(null);
            setStatus('done'); refreshHistory();
          } else { setStatus('error'); setError(t('aiEmpty')); }
        } else { setStreamContent((prev) => prev + message.content); }
        return;
      }
      if (message.type === 'ARCHIVE_STATUS') {
        if (message.status === 'fetching') { setError(t('archiveFetching')); }
        else if (message.status === 'done' && message.article) { setArticle(message.article); setStatus('article-ready'); setError(null); }
        else if (message.status === 'error') { setError(t('archiveFail')); }
      }
      if (message.type === 'TITLE_TRANSLATED') {
        setTranslatedTitle(message.translatedTitle);
      }
    }
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [cacheKey, t, refreshHistory]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // ── Handlers ───────────────────────────────────────────────────────

  const handleExtract = useCallback(async () => {
    setStatus('extracting'); setError(null); setStreamContent(''); setShowRawText(false); setStreamPaused(false); setPausedContent(''); setExportContent(null);
    try {
      const res = await chrome.runtime.sendMessage<{ type: string }, ArticleRecordResponse>({ type: 'EXTRACT_ARTICLE' });
      if (res?.status === 'ok' && res.article) {
        setArticle(res.article);
        const keys = Object.keys(res.article.summaries ?? {});
        setStatus(keys.length > 0 || res.article.summaryMarkdown ? 'done' : 'article-ready');
      } else { setError(res?.error || t('extractFail')); setStatus('error'); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus('error'); }
  }, [t]);

  const handleSummarize = useCallback(async (force = false) => {
    setStatus('summarizing'); setError(null); setCacheHit(false); setStreamContent(''); setStreamPaused(false); setPausedContent(''); setExportContent(null);
    try {
      const res = await chrome.runtime.sendMessage<
        { type: string; style: SummaryStyle; wordCount: number; customPrompt?: string; force?: boolean; bilingual?: boolean }, SummaryResponse
      >({ type: 'GENERATE_SUMMARY', style: activeStyle, wordCount: wordCount === -1 ? 0 : wordCount, customPrompt, force, bilingual });
      if (res?.status === 'ok' && res.cached) {
        setArticle((prev) => prev ? { ...prev, summaryMarkdown: res.summaryMarkdown!, summaries: { ...prev.summaries, [cacheKey]: res.summaryMarkdown! } } : null);
        setCacheHit(true); setStatus('done');
      } else if (res?.status === 'ok' && res.streaming) {
        setStatus('summarizing');
      } else { setError(res?.error || t('summaryFail')); setStatus('error'); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus('error'); }
  }, [activeStyle, wordCount, bilingual, cacheKey, t, customPrompt]);

  const handlePauseStream = useCallback(() => {
    setPausedContent(streamContent);
    pausedContentRef.current = streamContent;
    setStreamPaused(true);
    setStatus('done');
  }, [streamContent]);

  const handleContinue = useCallback(() => {
    // If stream already finished while paused, just show the final article
    if (article?.summaries?.[cacheKey] || article?.summaryMarkdown) {
      setStatus('done');
      setStreamPaused(false);
      setPausedContent('');
      pausedContentRef.current = '';
      setExportContent(null);
      return;
    }
    // Stream is still running — resume display of accumulated content
    setStatus('summarizing');
    setStreamPaused(false);
    setPausedContent('');
    pausedContentRef.current = '';
  }, [article, cacheKey]);

  const handleStyleChange = useCallback((s: SummaryStyle) => {
    setActiveStyle(s); setCacheHit(false); setStreamContent(''); setStreamPaused(false); setWordCount(DEFAULT_WC[s]); setExportContent(null);
  }, []);

  const handleCopy = useCallback(async () => {
    const content = exportContent ?? displayedMarkdown;
    if (!content) return;
    await copyFullMarkdown(content);
    setCopied(true); setTimeout(() => setCopied(false), 2000); setMenuOpen(false);
  }, [exportContent, displayedMarkdown]);

  const handleDownload = useCallback(() => {
    const content = exportContent ?? displayedMarkdown;
    if (!content || !article?.title) return;
    downloadMarkdown(content, article.title, activeStyle); setMenuOpen(false);
  }, [exportContent, displayedMarkdown, article, activeStyle]);

  const handleSaveToHistory = useCallback(async () => {
    const content = exportContent ?? displayedMarkdown;
    if (!content || !article) return; setMenuOpen(false);
    const res = await chrome.runtime.sendMessage<{ type: string; payload: object }, HistoryListResponse>({
      type: 'SAVE_TO_HISTORY', payload: { url: article.url, title: article.title, summaryMarkdown: content, style: activeStyle, rawText: article.rawText },
    });
    if (res?.status === 'ok') setHistory(res.entries);
  }, [exportContent, displayedMarkdown, article, activeStyle]);

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm(t('confirmClearAll'))) return;
    const res = await chrome.runtime.sendMessage<{ type: string }, HistoryListResponse>({ type: 'CLEAR_HISTORY' });
    if (res?.status === 'ok') setHistory([]);
  }, [t]);

  const handleDeleteHistoryEntry = useCallback(async (id: string) => {
    const res = await chrome.runtime.sendMessage<{ type: string; id: string }, HistoryListResponse>({ type: 'DELETE_HISTORY_ENTRY', id });
    if (res?.status === 'ok') setHistory(res.entries);
  }, []);

  const handleHistoryClick = useCallback((entry: HistoryEntry) => {
    setArticle({ url: entry.url, title: entry.title, summaryMarkdown: entry.summaryMarkdown, summaries: { [entry.style]: entry.summaryMarkdown }, rawText: entry.rawText });
    setActiveStyle(entry.style); setStatus('done'); setStreamContent(''); setActiveTab('article');
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredHistory.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredHistory.map((e) => e.id)));
    }
  }, [filteredHistory, selectedIds.size]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(t('confirmDelete').replace('{count}', String(count)))) return;

    for (const id of selectedIds) {
      await chrome.runtime.sendMessage<{ type: string; id: string }, HistoryListResponse>({
        type: 'DELETE_HISTORY_ENTRY',
        id,
      });
    }
    setSelectedIds(new Set());
    refreshHistory();
  }, [selectedIds, t, refreshHistory]);

  const handleBatchExport = useCallback(async () => {
    const entriesToExport = selectedIds.size > 0
      ? history.filter((e) => selectedIds.has(e.id))
      : history;

    if (entriesToExport.length === 0) return;

    const content = entriesToExport
      .map((entry) => `# ${entry.title}\n\n**${t('exportUrl')}:** ${entry.url}\n**${t('exportStyle')}:** ${entry.style}\n**${t('exportDate')}:** ${new Date(entry.timestamp).toLocaleString()}\n\n---\n\n${entry.summaryMarkdown}`)
      .join('\n\n---\n\n');

    downloadMarkdownBatch(content, 'history-export');
    setSelectedIds(new Set());
  }, [history, selectedIds, t]);

  const handleProviderChange = useCallback((key: string) => {
    setProvider(key); setTestResult(null);
    const preset = PROVIDERS[key];
    if (preset) { setBaseUrl(preset.url); setModel(preset.model); }
  }, []);

  const handleTestConnection = useCallback(async () => {
    setTesting(true); setTestResult(null);
    await chrome.storage.local.set({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim(), temperature, autoTranslateTitle });
    const result = await testConnection(); setTestResult(result); setTesting(false);
  }, [apiKey, baseUrl, model, temperature, autoTranslateTitle]);

  const handleSaveSettings = useCallback(async () => {
    await chrome.storage.local.set({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim(), temperature, autoTranslateTitle });
    setSettingsSaved(true); setTimeout(() => setSettingsSaved(false), 2000);
  }, [apiKey, baseUrl, model, temperature, autoTranslateTitle]);

  const canExtract = status !== 'extracting' && status !== 'summarizing';
  const canSummarize = article !== null && status !== 'summarizing' && status !== 'extracting';
  const canExport = displayedMarkdown != null && status === 'done';
  const isSummarizing = status === 'summarizing';

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 transition-colors duration-200">
      <header className="shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-4 py-3 transition-colors duration-200">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-900 dark:text-white">{t('appTitle')}</h1>
      </header>

      {/* ── Article tab ─────────────────────────────────────────────── */}
      {activeTab === 'article' && (<>
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 border-b border-neutral-100 dark:border-neutral-800 space-y-2 transition-colors duration-200">
            <button onClick={handleExtract} disabled={!canExtract} className={btn} aria-label={t('extract')}>
              {status === 'extracting' ? <><Spinner />{t('extracting')}</> : t('extract')}
            </button>
            <p className="text-xs text-neutral-400 dark:text-neutral-600 text-center">{t('paywallHint')}</p>
            <ArchiveInput />
          </div>

          {article && (
            <div className="border-b border-neutral-100 dark:border-neutral-800 px-4 py-3 transition-colors duration-200">
              <p className="text-xs text-neutral-500">{t('article')}</p>
              <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-100 leading-snug line-clamp-3">{article.title}</h2>
              {translatedTitle && translatedTitle !== article.title && (
                <p className="text-xs text-neutral-500 dark:text-neutral-600 mt-1">{translatedTitle}</p>
              )}
            </div>
          )}

          {article && (
            <div className="border-b border-neutral-100 dark:border-neutral-800 px-4 py-2 transition-colors duration-200">
              <div className="flex rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5">
                {STYLES.map((s) => (
                  <button key={s} onClick={() => handleStyleChange(s)} disabled={isSummarizing}
                    className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200 ${
                      activeStyle === s ? 'bg-neutral-300 dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'
                    } disabled:opacity-40`}>
                    {styleLabel(s)}
                    {article.summaries?.[s] && !isSummarizing && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 align-middle" aria-label={t('cached')} />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <span className="text-xs text-neutral-500 mr-1">{t('wordCount_')}</span>
                {WORD_COUNTS.map((n) => (
                  <button key={n} onClick={() => setWordCount(n)} disabled={isSummarizing}
                    className={`rounded px-1.5 py-0.5 text-xs transition-colors duration-200 ${
                      wordCount === n ? 'bg-neutral-300 dark:bg-neutral-700 text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'
                    } disabled:opacity-40`}>{n === -1 ? t('unlimited') : n}</button>
                ))}
              </div>
              {activeStyle === 'custom' && (
                <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder={t('customPromptHint')} rows={3}
                  className="mt-1.5 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 transition-colors duration-200"
                />
              )}
            </div>
          )}

          <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 transition-colors duration-200">
            <button onClick={() => setShowRawText((v) => !v)} disabled={!article} className={`${btn} ${showRawText ? 'bg-neutral-300 dark:bg-neutral-700' : ''}`} aria-label={t(showRawText ? 'hideRaw' : 'showRaw')}>
              {t(showRawText ? 'hideRaw' : 'showRaw')}
            </button>
            <button onClick={() => handleSummarize(isStyleCached)} disabled={!canSummarize} className={btn} aria-label={isSummarizing ? t('summarizing') : t('summarize')}>
              {isSummarizing ? <><Spinner />{t('summarizing')}</> : isStyleCached ? t('regenerating') : t('summarize')}
            </button>
            <button onClick={() => setBilingual((v) => !v)} disabled={!canSummarize}
              className={`${btn} ${bilingual ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300' : ''}`} aria-label={t(bilingual ? 'bilingualOn' : 'bilingualOff')}>
              {t(bilingual ? 'bilingualOn' : 'bilingualOff')}
            </button>
            <div className="ml-auto relative" ref={menuRef}>
              <button onClick={() => setMenuOpen((v) => !v)} disabled={!canExport} className={btn} aria-label={t('export')} aria-haspopup="menu" aria-expanded={menuOpen}>
                {t('export')}<svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 8L2 4h8L6 8z" /></svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg z-10 py-1 transition-colors duration-200">
                  <MenuBtn onClick={handleCopy}>{t('copyMd')}</MenuBtn>
                  <MenuBtn onClick={handleDownload}>{t('downloadMd')}</MenuBtn>
                  <hr className="border-neutral-200 dark:border-neutral-700 my-1" />
                  <MenuBtn onClick={handleSaveToHistory}>{t('saveHistory')}</MenuBtn>
                  {history.length > 0 && <MenuBtn onClick={handleClearHistory} danger>{t('clearHistory')}</MenuBtn>}
                </div>
              )}
            </div>
          </div>

          {/* Pause / Continue row */}
          {(isSummarizing || streamPaused) && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100 dark:border-neutral-800 transition-colors duration-200">
              {isSummarizing && (
                <button onClick={handlePauseStream} className={btn} aria-label={t('pause')}>
                  ⏸ {t('pause')}
                </button>
              )}
              {streamPaused && (
                <button onClick={handleContinue} className={btn} aria-label={t('continue_')}>
                  ▶ {t('continue_')}
                </button>
              )}
            </div>
          )}

          {error && <Banner color="red">{error}</Banner>}
          {cacheHit && <Banner color="green">{t('cacheLoaded')}</Banner>}
          {copied && <Banner color="blue">{t('copied')}</Banner>}

          {status === 'idle' && !article && (
            <div className="px-4 py-8 text-center"><p className="text-sm text-neutral-500">{t('emptyState')}</p></div>
          )}

          {showRawText && article && (
            <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
              <pre className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">{article.rawText || t('noText')}</pre>
            </div>
          )}

          {displayedMarkdown && (<>
            <div className="flex items-center gap-2 px-4 pt-3">
              <span className="text-xs text-neutral-500 dark:text-neutral-600 uppercase tracking-wider">{styleLabel(activeStyle)} {t('summaryLabel')}{bilingual && t('bilingualIndicator')}</span>
              {isStyleCached && <span className="text-xs text-neutral-400 dark:text-neutral-700">({t('cached')})</span>}
              {isSummarizing && <span className="text-xs text-neutral-500 animate-pulse">{t('streaming')}</span>}
            </div>
            <MarkdownView content={displayedMarkdown} />
          </>)}

          {isSummarizing && !streamContent && (
            <div className="px-4 py-8 space-y-4 animate-pulse">
              <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-5/6 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800 mt-6" />
              <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
            </div>
          )}
        </div>
      </>)}

      {/* ── History tab ─────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center"><p className="text-sm text-neutral-500">{t('noHistory')}</p></div>
          ) : (<>
            {/* Search and batch controls */}
            <div className="px-4 py-2 border-b border-neutral-100 dark:border-neutral-800 space-y-2 transition-colors duration-200">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t('searchHistory')}
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-1.5 pl-8 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 transition-colors duration-200"
                />
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-neutral-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="5" cy="5" r="3.5" />
                  <path d="M8 8l3 3" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSelectAll} className={btn}>
                  {selectedIds.size === filteredHistory.length ? t('deselectAll') : t('selectAll')}
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <button onClick={handleBatchDelete} className={`${btn} border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20`}>
                      {t('batchDelete')} ({selectedIds.size})
                    </button>
                    <button onClick={handleBatchExport} className={btn}>
                      {t('batchExport')} ({selectedIds.size})
                    </button>
                  </>
                )}
                {selectedIds.size === 0 && (
                  <button onClick={handleBatchExport} className={btn}>
                    {t('exportAllHistory')}
                  </button>
                )}
              </div>
            </div>

            <p className="px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-600 uppercase tracking-wider">
              {t('history')}{lang === 'zh' ? '（' : '('}{filteredHistory.length}{searchQuery ? ` / ${history.length}` : ''}{lang === 'zh' ? '）' : ')'}
            </p>
            {filteredHistory.length === 0 ? (
              <div className="px-4 py-8 text-center"><p className="text-sm text-neutral-500">{t('noResults')}</p></div>
            ) : (
              filteredHistory.map((entry) => (
                <div key={entry.id} className="group flex items-center border-b border-neutral-200/50 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors duration-200">
                  <div className="shrink-0 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => handleToggleSelect(entry.id)}
                      className="h-3 w-3 rounded border-neutral-300 dark:border-neutral-700 text-blue-600 focus:ring-blue-500"
                      aria-label={t('delete')}
                    />
                  </div>
                  <button onClick={() => handleHistoryClick(entry)} className="flex-1 text-left px-2 py-2 min-w-0">
                    <p className="text-xs text-neutral-700 dark:text-neutral-300 truncate">{entry.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-neutral-500 dark:text-neutral-600">{styleLabel(entry.style)}</span>
                      <span className="text-xs text-neutral-400 dark:text-neutral-700">{formatTime(entry.timestamp, lang, t)}</span>
                    </div>
                  </button>
                  <button onClick={() => handleDeleteHistoryEntry(entry.id)}
                    className="shrink-0 px-2 py-2 text-neutral-400 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all" title={t('delete')} aria-label={t('delete')}>
                    <TrashIcon />
                  </button>
                </div>
              ))
            )}
            <div className="px-4 py-3">
              <button onClick={handleClearHistory} className="text-xs text-red-500 hover:text-red-400 transition-colors">{t('clearHistory')}</button>
            </div>
          </>)}
        </div>
      )}

      {/* ── Settings tab ────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <label className="block">
            <span className="text-xs text-neutral-500">{t('provider')}</span>
            <select value={provider} onChange={(e) => handleProviderChange(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none transition-colors duration-200">
              {Object.entries(PROVIDERS).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
              <option value="custom">{t('custom')}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-neutral-500">{t('apiKey')}</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
              className="mt-0.5 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 transition-colors duration-200" />
          </label>
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs text-neutral-500">{t('baseUrl')}</span>
              <input type="text" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setProvider('custom'); }}
                className="mt-0.5 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-400 transition-colors duration-200" />
            </label>
            <label className="block">
              <span className="text-xs text-neutral-500">{t('model')}</span>
              <input type="text" value={model} onChange={(e) => { setModel(e.target.value); setProvider('custom'); }}
                className="mt-0.5 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-400 transition-colors duration-200" />
            </label>
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500">{t('temperature')}</span>
                <span className="text-xs text-neutral-500 tabular-nums">{temperature}</span>
              </div>
              <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="mt-0.5 w-full h-1 accent-blue-600" />
            </label>
          </div>

          <button onClick={handleTestConnection} disabled={testing}
            className={`w-full rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
              testResult
                ? testResult.ok
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                  : 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300'
                : 'border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            } disabled:opacity-40 disabled:cursor-not-allowed`}>
            {testing ? <><Spinner />{t('testing_')}</>
              : testResult
                ? testResult.ok
                  ? t('testOk')
                  : `${t('testFail')}: ${testResult.message === 'NO_API_KEY' ? t('testNoKey') : testResult.message.slice(0, 60)}`
                : t('testApi')}
          </button>

          <label className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">{t('autoTranslate')}</span>
            <button onClick={() => setAutoTranslateTitle((v) => !v)}
              className={`rounded-full w-8 h-4 transition-colors duration-200 ${autoTranslateTitle ? 'bg-blue-600' : 'bg-neutral-400 dark:bg-neutral-600'}`}
              role="switch" aria-checked={autoTranslateTitle} aria-label={t('autoTranslate')}>
              <span className={`block w-3 h-3 rounded-full bg-white transition-transform duration-200 mx-0.5 ${autoTranslateTitle ? 'translate-x-4' : ''}`} />
            </button>
          </label>
          <button onClick={handleSaveSettings}
            className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors">
            {t('saveAll')}
          </button>
          {settingsSaved && <p className="text-xs text-green-600 dark:text-green-400">{t('saved')}</p>}

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-1.5">
              <span className="text-xs text-neutral-500 min-w-[3rem]">{t('language')}</span>
              <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors duration-200">
                {lang === 'zh' ? t('langZh') : t('langEn')}
              </button>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-xs text-neutral-500 min-w-[3rem]">{t('theme')}</span>
              <button onClick={toggleTheme}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors duration-200">
                {theme === 'dark' ? <><SunIcon />{t('light')}</> : <><MoonIcon />{t('dark')}</>}
              </button>
            </label>
          </div>
        </div>
      )}

      {/* ── Bottom nav ──────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-neutral-200 dark:border-neutral-800 flex transition-colors duration-200">
        {([
          ['article', '📄', t('tabArticle')],
          ['history', '📋', t('history')],
          ['settings', '⚙', t('tabSettings')],
        ] as const).map(([key, icon, label]) => (
          <button key={key} onClick={() => setActiveTab(key as Tab)}
            className={`flex-1 flex flex-col items-center py-1.5 text-xs transition-colors duration-200 ${
              activeTab === key ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-400'
            }`} aria-label={label} aria-selected={activeTab === key} role="tab">
            <span className="text-sm">{icon}</span><span>{label}</span>
          </button>
        ))}
      </div>

      <footer className="shrink-0 border-t border-neutral-200 dark:border-neutral-800 px-4 py-1 transition-colors duration-200">
        <p className="text-xs text-neutral-400 dark:text-neutral-600">v0.1.0</p>
      </footer>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function MenuBtn({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} className={`w-full text-left px-3 py-1.5 text-xs transition-colors duration-200 ${danger ? 'text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20' : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white'}`}>{children}</button>;
}

function Banner({ color, children }: { color: 'amber' | 'green' | 'blue' | 'red'; children: React.ReactNode }) {
  const c: Record<string, string> = {
    amber: 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    green: 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    blue: 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    red: 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300',
  };
  return <div className={`mx-4 mt-3 rounded-md border px-3 py-2 transition-colors duration-200 ${c[color]}`}><p className="text-xs">{children}</p></div>;
}

function ArchiveInput() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const openInArchive = useCallback(() => {
    const url = inputRef.current?.value?.trim();
    if (url) { chrome.runtime.sendMessage({ type: 'REDIRECT_TO_ARCHIVE', url }); if (inputRef.current) inputRef.current.value = ''; }
  }, []);
  return (
    <div className="flex items-center gap-1.5">
      <input ref={inputRef} type="text" placeholder={t('archivePlaceholder')}
        className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:border-blue-400 transition-colors duration-200"
        onKeyDown={(e) => { if (e.key === 'Enter') openInArchive(); }} />
      <button onClick={openInArchive} className="shrink-0 rounded-md border border-blue-500 bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors">{t('archiveOpen')}</button>
    </div>
  );
}

function Spinner() {
  return <svg className="h-3 w-3 animate-spin" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" className="opacity-25" /><path d="M12.5 7a5.5 5.5 0 0 0-10.13-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-75" /></svg>;
}

function SunIcon() {
  return <svg className="h-3 w-3" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="3" /><path d="M7 1v1M7 12v1M1 7h1M12 7h1M3.2 3.2l.7.7M10.1 10.1l.7.7M3.2 10.8l.7-.7M10.1 3.9l.7-.7" /></svg>;
}

function MoonIcon() {
  return <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.354 15.354A8 8 0 0 1 8.646 3.646 9 9 0 1 0 20.354 15.354z" /></svg>;
}

function TrashIcon() {
  return <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><path d="M4 1.5h4l.5.5H10v1H2V2h1.5l.5-.5zM3 4l.5 6.5h5L9 4H3z" /></svg>;
}

function formatTime(ts: number, lang: string, t: (key: string) => string): string {
  const d = new Date(ts);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return t('justNow');
  if (diffMin < 60) return t('minutesAgo').replace('{n}', String(diffMin));
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('hoursAgo').replace('{n}', String(diffHr));
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US');
}
