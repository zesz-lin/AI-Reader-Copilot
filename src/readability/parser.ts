import { Readability } from '@mozilla/readability';
import type { ArticleData } from '../shared';
import { removePaywallElements, removeTextPaywallBanners, unhidePaywalledContent } from './paywall';

export type { ArticleData };

interface ExtractOptions {
  aggressive?: boolean;
}

function parseArticle(doc: Document, opts: ExtractOptions = {}): ArticleData | null {
  const reader = new Readability(doc, {
    charThreshold: opts.aggressive ? 80 : 500,
    keepClasses: opts.aggressive,
  });
  const article = reader.parse();

  if (!article) return null;

  return {
    title: article.title,
    textContent: article.textContent,
    content: article.content,
    excerpt: article.excerpt ?? undefined,
    byline: article.byline ?? undefined,
  };
}

/** Tier 1: standard extraction on a clean clone */
export function extractArticle(doc: Document): ArticleData | null {
  const clone = doc.cloneNode(true) as Document;
  return parseArticle(clone);
}

/** Tier 2: aggressive — remove paywall cruft, unhide content, then run Readability with lowered thresholds */
export function extractArticleAggressive(doc: Document): ArticleData | null {
  const clone = doc.cloneNode(true) as Document;

  removePaywallElements(clone);
  removeTextPaywallBanners(clone);
  unhidePaywalledContent(clone);

  return parseArticle(clone, { aggressive: true });
}
