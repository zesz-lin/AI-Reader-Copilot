import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Lang = 'zh' | 'en';

const DICT: Record<string, { zh: string; en: string }> = {
  appTitle:            { zh: 'AI 阅读助手',        en: 'AI Reader Copilot' },
  settings:            { zh: '设置',               en: 'Settings' },
  apiKey:              { zh: 'API 密钥',           en: 'API Key' },
  baseUrl:             { zh: '接口地址',           en: 'Base URL' },
  model:               { zh: '模型',               en: 'Model' },
  save:                { zh: '保存',               en: 'Save' },
  saved:               { zh: '已保存',             en: 'Saved' },
  language:            { zh: '语言',               en: 'Language' },
  theme:               { zh: '主题',               en: 'Theme' },
  light:               { zh: '浅色',               en: 'Light' },
  dark:                { zh: '深色',               en: 'Dark' },
  article:             { zh: '文章',               en: 'Article' },
  concise:             { zh: '简洁',               en: 'Concise' },
  detailed:            { zh: '详细',               en: 'Detailed' },
  academic:            { zh: '学术',               en: 'Academic' },
  extract:             { zh: '提取',               en: 'Extract' },
  extracting:          { zh: '提取中',             en: 'Extracting' },
  summarize:           { zh: '生成摘要',           en: 'Summarize' },
  regenerating:        { zh: '重新生成',           en: 'Re-generate' },
  summarizing:         { zh: '生成中',             en: 'Generating' },
  export:              { zh: '导出',               en: 'Export' },
  copyMd:              { zh: '复制 Markdown',      en: 'Copy Markdown' },
  downloadMd:          { zh: '下载 .md',           en: 'Download .md' },
  saveHistory:         { zh: '保存到历史',         en: 'Save to History' },
  clearHistory:        { zh: '清空历史',           en: 'Clear History' },
  delete:              { zh: '删除',               en: 'Delete' },
  cacheLoaded:         { zh: '已从缓存加载',       en: 'Loaded from cache' },
  copied:              { zh: '已复制到剪贴板',     en: 'Copied to clipboard' },
  cached:              { zh: '已缓存',             en: 'cached' },
  streaming:           { zh: '接收中',             en: 'streaming' },
  history:             { zh: '历史记录',           en: 'History' },
  emptyState:          { zh: '浏览到文章页面，然后点击提取。', en: 'Navigate to an article, then click Extract.' },
  readyStatus:         { zh: '就绪',               en: ' ready' },
  articleReady:        { zh: '文章就绪',           en: 'Article ready' },
  errorStatus:         { zh: '错误',               en: 'Error' },
  noApiKey:            { zh: 'API 密钥未设置，请打开设置进行配置。', en: 'API key not set. Open Settings to configure.' },
  extractFail:         { zh: '提取文章失败',       en: 'Failed to extract article' },
  summaryFail:         { zh: '摘要生成失败',       en: 'Summary generation failed' },
  aiEmpty:             { zh: 'AI 返回了空响应',    en: 'AI returned empty response' },
  temperature:         { zh: 'Temperature',        en: 'Temperature' },
  archivePlaceholder:  { zh: '输入URL…',           en: 'Enter URL…' },
  archiveOpen:         { zh: '打开网页存档',       en: 'Open in Archive' },
  wordCount_:          { zh: '字数',               en: 'Words' },
  showRaw:             { zh: '显示原文',           en: 'Show Raw' },
  hideRaw:             { zh: '隐藏原文',           en: 'Hide Raw' },
  bilingualOn:         { zh: '双语: 开',           en: 'Bilingual: ON' },
  bilingualOff:        { zh: '双语: 关',           en: 'Bilingual: OFF' },
  bilingualIndicator:  { zh: ' + 中文',            en: ' + 中文' },
  noHistory:           { zh: '暂无历史记录',       en: 'No history yet' },
  langZh:              { zh: '中',                 en: '中' },
  langEn:              { zh: 'En',                 en: 'En' },
  autoTranslate:       { zh: '自动翻译标题',       en: 'Auto-translate title' },
  pause:               { zh: '暂停',               en: 'Pause' },
  continue_:           { zh: '继续',               en: 'Continue' },
  testOk:              { zh: '✓ 连接成功',         en: '✓ Connected' },
  testFail:            { zh: '✗ 连接失败',         en: '✗ Connection failed' },
  testNoKey:           { zh: '请先填写 API 密钥',   en: 'Please enter an API key' },

  customPromptHint:    { zh: '输入自定义提示词…',   en: 'Enter custom prompt…' },
  unlimited:           { zh: '不限',               en: 'Unlimited' },
  archiveFetching:     { zh: '正在从 archive.ph 获取...', en: 'Fetching from archive.ph...' },
  archiveFail:         { zh: 'archive.ph 无法获取该页面内容', en: 'archive.ph failed to retrieve content' },
  provider:            { zh: '提供商',             en: 'Provider' },
  testApi:             { zh: '测试API连接',       en: 'Test API Connection' },
  saveAll:             { zh: '保存所有设置',       en: 'Save All Settings' },
  testing_:            { zh: '测试中…',            en: 'Testing…' },
  custom:              { zh: '自定义',             en: 'Custom' },
  paywallHint:         { zh: '遇到了讨厌的付费墙?试试离线存档!↓', en: 'Happened to a paywall? Try offline saving!↓' },
  tabArticle:          { zh: '文章',               en: 'Article' },
  tabSettings:         { zh: '设置',               en: 'Settings' },
};

export const STYLE_LABELS: Record<string, { zh: string; en: string }> = {
  concise:   { zh: '简洁', en: 'Concise' },
  detailed:  { zh: '详细', en: 'Detailed' },
  academic:  { zh: '学术', en: 'Academic' },
  custom:    { zh: '自定义', en: 'Custom' },
};

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  styleLabel: (style: string) => string;
}

const I18nContext = createContext<I18nContextValue>(null!);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem('ai-reader-lang') as Lang) || 'zh';
    } catch {
      return 'zh';
    }
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('ai-reader-lang', l); } catch { /* */ }
    chrome.storage.local.set({ language: l }).catch(() => {});
  }, []);

  const t = useCallback(
    (key: string) => DICT[key]?.[lang] ?? key,
    [lang],
  );

  const styleLabel = useCallback(
    (style: string) => STYLE_LABELS[style]?.[lang] ?? style,
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t, styleLabel }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
