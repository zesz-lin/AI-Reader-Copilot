const PAYWALL_SELECTORS = [
  // Overlays & modals
  '.paywall', '.paywall-container', '.paywall-overlay', '.paywall-notice',
  '.subscribe-overlay', '.subscription-overlay', '.subscribe-modal',
  '.reg-wall', '.registration-wall', '.registration-overlay',
  '.metered-content', '.metered-paywall', '.gate-content',
  '.article-gate', '.content-gate', '.soft-paywall', '.hard-paywall',
  '.dynamic-paywall', '.fading-content', '.overlay-paywall',
  '#paywall', '#paywall-container', '#subscribe-overlay',
  '[data-paywall]', '[data-paywall-overlay]', '[data-paywall-type]',
  '[data-testid="paywall"]', '[data-component="paywall"]',
  'div[class*="paywall"]', 'div[class*="Paywall"]',
  'div[class*="subscribe-wall"]', 'div[class*="subscription"]',
  'div[class*="gate"]', 'div[id*="paywall"]', 'div[id*="subscribe"]',

  // Non-article cruft
  '.related-content', '.related-posts', '.recommended-articles',
  '.you-might-like', '.read-next', '.more-stories',
  '.sidebar', '.article-sidebar', '[class*="sidebar"]',
  '.newsletter-signup', '.newsletter-inline',
  '.ad-container', '.ad-wrapper', '[class*="advertisement"]',
  '.social-share', '.share-buttons',
  '.comments-section', '.comment-section', '#comments',
];

const MIN_CONTENT_LENGTH = 300;

export function removePaywallElements(doc: Document): number {
  let removed = 0;

  for (const selector of PAYWALL_SELECTORS) {
    try {
      const elements = doc.querySelectorAll(selector);
      for (const el of elements) {
        el.remove();
        removed++;
      }
    } catch {
      // invalid selector, skip
    }
  }

  return removed;
}

/**
 * Remove elements whose visible text is mostly paywall keywords
 * and very short (like "Subscribe to continue reading").
 */
export function removeTextPaywallBanners(doc: Document): void {
  const paywallPhrases = [
    'subscribe to continue', 'subscribe to read', 'create a free account',
    'sign in to read', 'log in to read', 'already a subscriber',
    'unlimited access', 'start your free trial', 'subscribe for',
    'paywall', 'premium content', 'subscriber-only', 'subscriber only',
    'this content is reserved', 'register to continue',
  ];

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];

  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const text = (el.textContent || '').toLowerCase().trim();

    // Only target short text nodes that look like paywall banners
    if (text.length > 10 && text.length < 200) {
      for (const phrase of paywallPhrases) {
        if (text.includes(phrase)) {
          toRemove.push(el);
          break;
        }
      }
    }
  }

  for (const el of toRemove) {
    // Remove the paywall banner but NOT its parent (which may contain article content)
    if (el.parentElement) {
      el.remove();
    }
  }
}

/**
 * Unhide article-like content hidden by paywall CSS.
 * Some sites wrap the actual article in a div with display:none or max-height + overflow:hidden.
 */
export function unhidePaywalledContent(doc: Document): void {
  const articleCandidates = doc.querySelectorAll(
    'article, [class*="article"], [class*="post"], [class*="story"], main, .content-body, .article-body, .post-body',
  );

  for (const el of articleCandidates) {
    const style = (el as HTMLElement).style;
    const computed = (el as HTMLElement).style; // inline only

    // Remove display:none from article containers
    if (computed.display === 'none' || el.getAttribute('style')?.includes('display:none') || el.getAttribute('style')?.includes('display: none')) {
      (el as HTMLElement).style.display = '';
    }

    // Remove max-height clamping
    if (computed.maxHeight && computed.maxHeight !== 'none') {
      (el as HTMLElement).style.maxHeight = 'none';
      (el as HTMLElement).style.overflow = 'visible';
    }

    // Remove overflow:hidden that hides content
    if (computed.overflow === 'hidden' && el.textContent && el.textContent.length > 500) {
      (el as HTMLElement).style.overflow = 'visible';
    }
  }
}

export function contentLength(doc: Document): number {
  return (doc.body?.textContent || '').trim().length;
}

export function isContentTooShort(doc: Document): boolean {
  return contentLength(doc) < MIN_CONTENT_LENGTH;
}
