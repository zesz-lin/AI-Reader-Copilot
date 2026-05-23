import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  removePaywallElements,
  removeTextPaywallBanners,
  unhidePaywalledContent,
} from '../../readability/paywall';

function createDoc(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('removePaywallElements', () => {
  it('removes elements with common paywall class names', () => {
    const doc = createDoc(`
      <html><body>
        <article>
          <p>Article content here.</p>
        </article>
        <div class="paywall">Subscribe now</div>
      </body></html>
    `);

    removePaywallElements(doc);
    expect(doc.querySelector('.paywall')).toBeNull();
    expect(doc.querySelector('article')).not.toBeNull();
  });

  it('removes multiple paywall elements', () => {
    const doc = createDoc(`
      <html><body>
        <div class="paywall-overlay">Pay</div>
        <div class="subscription-overlay">Sub</div>
        <div class="newsletter-signup">Newsletter</div>
        <main><p>Real content</p></main>
      </body></html>
    `);

    removePaywallElements(doc);
    expect(doc.querySelector('.paywall-overlay')).toBeNull();
    expect(doc.querySelector('.subscription-overlay')).toBeNull();
    expect(doc.querySelector('.newsletter-signup')).toBeNull();
    expect(doc.querySelector('main')).not.toBeNull();
  });

  it('removes paywall elements with data attributes', () => {
    const doc = createDoc(`
      <html><body>
        <div data-paywall="true">Pay</div>
        <div data-testid="paywall">Pay2</div>
        <p>Content</p>
      </body></html>
    `);

    removePaywallElements(doc);
    expect(doc.querySelector('[data-paywall]')).toBeNull();
    expect(doc.querySelector('[data-testid="paywall"]')).toBeNull();
  });

  it('removes comment sections', () => {
    const doc = createDoc(`
      <html><body>
        <div id="comments">Comments here</div>
        <div class="comments-section">More comments</div>
        <p>Article</p>
      </body></html>
    `);

    removePaywallElements(doc);
    expect(doc.querySelector('#comments')).toBeNull();
    expect(doc.querySelector('.comments-section')).toBeNull();
  });

  it('handles empty document without error', () => {
    const doc = createDoc('<html><body></body></html>');
    expect(() => removePaywallElements(doc)).not.toThrow();
  });

  it('does not remove article content', () => {
    const doc = createDoc(`
      <html><body>
        <article>
          <h1>Title</h1>
          <p>This is real article content that should be preserved.</p>
        </article>
      </body></html>
    `);

    removePaywallElements(doc);
    expect(doc.querySelector('article')).not.toBeNull();
    expect(doc.querySelector('h1')?.textContent).toBe('Title');
  });
});

describe('removeTextPaywallBanners', () => {
  it('removes short elements containing paywall keywords', () => {
    const doc = createDoc(`
      <html><body>
        <div class="some-banner">Subscribe to continue reading this article</div>
        <article><p>Real article content that is long enough to stay.</p></article>
      </body></html>
    `);

    removeTextPaywallBanners(doc);
    expect(doc.querySelector('.some-banner')).toBeNull();
    expect(doc.querySelector('article')).not.toBeNull();
  });

  it('does not remove long elements (real article content)', () => {
    const doc = createDoc(`
      <html><body>
        <article>
          <p>${'A very long article paragraph that goes on and on. '.repeat(20)}</p>
        </article>
      </body></html>
    `);

    removeTextPaywallBanners(doc);
    expect(doc.querySelector('article')).not.toBeNull();
  });

  it('does not remove very short elements (under 10 chars)', () => {
    const doc = createDoc(`
      <html><body>
        <span>Paywall</span>
        <p>Content</p>
      </body></html>
    `);

    removeTextPaywallBanners(doc);
    // "Paywall" is only 7 chars, so it won't be removed
    expect(doc.querySelector('span')?.textContent).toBe('Paywall');
  });

  it('handles multiple paywall phrase variations', () => {
    const doc = createDoc(`
      <html><body>
        <div id="a">Create a free account to continue reading</div>
        <div id="b">Start your free trial today</div>
        <div id="c">This content is reserved for subscribers</div>
        <main><p>Real content</p></main>
      </body></html>
    `);

    removeTextPaywallBanners(doc);
    expect(doc.querySelector('#a')).toBeNull();
    expect(doc.querySelector('#b')).toBeNull();
    expect(doc.querySelector('#c')).toBeNull();
    expect(doc.querySelector('main')).not.toBeNull();
  });

  it('is case-insensitive when matching phrases', () => {
    const doc = createDoc(`
      <html><body>
        <div class="banner">Subscribe To Continue Reading Premium</div>
        <p>Content</p>
      </body></html>
    `);

    removeTextPaywallBanners(doc);
    expect(doc.querySelector('.banner')).toBeNull();
  });
});

describe('unhidePaywalledContent', () => {
  it('removes display:none from article-like elements', () => {
    const doc = createDoc(`
      <html><body>
        <article style="display:none">
          <p>Hidden content</p>
        </article>
      </body></html>
    `);

    unhidePaywalledContent(doc);
    const article = doc.querySelector('article') as HTMLElement;
    expect(article.style.display).toBe('');
  });

  it('removes max-height clamping from article containers', () => {
    const doc = createDoc(`
      <html><body>
        <div class="article-body" style="max-height:200px;overflow:hidden">
          <p>Clamped content here</p>
        </div>
      </body></html>
    `);

    unhidePaywalledContent(doc);
    const el = doc.querySelector('.article-body') as HTMLElement;
    expect(el.style.maxHeight).toBe('none');
    expect(el.style.overflow).toBe('visible');
  });

  it('sets overflow to visible when overflow hidden and content > 500 chars', () => {
    const doc = createDoc(`
      <html><body>
        <article style="overflow:hidden">
          <p>${'A'.repeat(600)}</p>
        </article>
      </body></html>
    `);

    unhidePaywalledContent(doc);
    const el = doc.querySelector('article') as HTMLElement;
    expect(el.style.overflow).toBe('visible');
  });

  it('does not modify elements without paywall-style CSS', () => {
    const doc = createDoc(`
      <html><body>
        <article style="color:blue">
          <p>Normal content</p>
        </article>
      </body></html>
    `);

    unhidePaywalledContent(doc);
    const el = doc.querySelector('article') as HTMLElement;
    expect(el.style.display).toBe('');
    expect(el.style.maxHeight).toBe('');
  });
});
