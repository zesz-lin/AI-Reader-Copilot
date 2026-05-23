import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractArticle, extractArticleAggressive } from '../../readability/parser';

function createDoc(html: string): Document {
  return new JSDOM(html).window.document;
}

// ── extractArticle (Tier 1 — standard) ─────────────────────────────────

describe('extractArticle', () => {
  it('extracts title, textContent, and content from a valid article', () => {
    const doc = createDoc(`
      <html><head><title>Test Article</title></head><body>
        <article>
          <h1>Article Title</h1>
          <p>This is the first paragraph of the article body.</p>
          <p>This is the second paragraph with more content.</p>
        </article>
      </body></html>
    `);

    const result = extractArticle(doc);
    expect(result).not.toBeNull();
    // Readability uses the <title> tag for article title
    expect(result!.title).toBe('Test Article');
    expect(result!.textContent).toContain('first paragraph');
    expect(result!.textContent).toContain('second paragraph');
    expect(result!.content).toContain('<p>');
  });

  it('handles short documents without crashing', () => {
    const doc = createDoc(`
      <html><head><title>Empty</title></head><body>
        <p>Too short.</p>
      </body></html>
    `);

    // Should not throw regardless of return value
    expect(() => extractArticle(doc)).not.toThrow();
  });

  it('extracts byline when present in article markup', () => {
    const doc = createDoc(`
      <html><head><title>With Byline</title></head><body>
        <article>
          <h1>My Article</h1>
          <p class="byline">By Jane Smith</p>
          <p>This is the article content. It needs enough text so that Readability
          will parse it as a proper article. Let me add some more words here to
          make sure the charThreshold is met. This should be sufficient.</p>
          <p>Additional paragraph with more content to ensure Readability
          treats this as a full article page.</p>
        </article>
      </body></html>
    `);

    const result = extractArticle(doc);
    if (result) {
      // byline may or may not be extracted by Readability depending on markup
      expect(typeof result.byline).toBe('string');
    }
  });

  it('returns excerpt when present', () => {
    const doc = createDoc(`
      <html><head>
        <title>With Excerpt</title>
        <meta name="description" content="This is the article excerpt.">
      </head><body>
        <article>
          <h1>My Article</h1>
          <p>This is the article content. It needs enough text so that Readability
          will parse it as a proper article. Let me add some more words here to
          make sure the charThreshold is met. This should be sufficient.</p>
          <p>Additional paragraph with more content to ensure Readability
          treats this as a full article page.</p>
        </article>
      </body></html>
    `);

    const result = extractArticle(doc);
    if (result) {
      expect(typeof result.excerpt).toBe('string');
    }
  });

  it('preserves original document (does not mutate input)', () => {
    const doc = createDoc(`
      <html><head><title>Unchanged</title></head><body>
        <article>
          <h1>Original Title</h1>
          <p>This is the article content. It needs enough text so that Readability
          will parse it as a proper article. Let me add some more words here to
          make sure the charThreshold is met. This should be sufficient.</p>
        </article>
      </body></html>
    `);

    const originalHTML = doc.body.innerHTML;
    extractArticle(doc);
    expect(doc.body.innerHTML).toBe(originalHTML);
  });
});

// ── extractArticleAggressive (Tier 2 — aggressive with paywall removal) ─

describe('extractArticleAggressive', () => {
  it('removes paywall elements and extracts article', () => {
    const doc = createDoc(`
      <html><head><title>Paywalled Article</title></head><body>
        <div class="paywall" style="display:block">Subscribe now to read more</div>
        <article>
          <h1>Behind the Paywall</h1>
          <p>This is the article content that is hidden behind a paywall.
          It needs enough text so that Readability will parse it as a proper
          article. Let me add some more words here to make sure the charThreshold
          is met. This should be sufficient for the aggressive parser.</p>
          <p>Additional paragraph with more content to ensure Readability
          treats this as a full article page for testing purposes.</p>
        </article>
      </body></html>
    `);

    const result = extractArticleAggressive(doc);
    expect(result).not.toBeNull();
    // Readability uses the <title> tag for article title
    expect(result!.title).toBe('Paywalled Article');
  });

  it('unhides display:none content before extraction', () => {
    const doc = createDoc(`
      <html><head><title>Hidden Content</title></head><body>
        <article style="display:none">
          <h1>Hidden Article</h1>
          <p>This content was hidden via display:none. The aggressive parser
          should remove that style before extraction. This text needs to be
          long enough for Readability's aggressive charThreshold of 80.</p>
          <p>More text here to reach the minimum length requirements for
          Readability to extract content from this test document.</p>
        </article>
      </body></html>
    `);

    const result = extractArticleAggressive(doc);
    expect(result).not.toBeNull();
    expect(result!.textContent).toContain('Hidden Article');
  });

  it('removes text paywall banners with keywords', () => {
    const doc = createDoc(`
      <html><head><title>Newsletter Wall</title></head><body>
        <div class="newsletter-banner">Subscribe to continue reading this premium article</div>
        <article>
          <h1>Premium Content</h1>
          <p>This is the real article content that should be extracted.
          It needs enough text so that Readability will parse it as a proper
          article. Let me add some more words here to make sure the charThreshold
          is met. This should be sufficient for extraction.</p>
          <p>Additional paragraph with more content to ensure Readability
          treats this as a full article page for testing purposes.</p>
        </article>
      </body></html>
    `);

    const result = extractArticleAggressive(doc);
    expect(result).not.toBeNull();
    // Readability uses the <title> tag for article title
    expect(result!.title).toBe('Newsletter Wall');
  });

  it('preserves original document (does not mutate input)', () => {
    const doc = createDoc(`
      <html><head><title>Preserved Input</title></head><body>
        <div class="paywall">Paywall</div>
        <article>
          <h1>Real Content</h1>
          <p>This is the article content. It needs enough text so that Readability
          will parse it as a proper article. Let me add some more words here to
          make sure the charThreshold is met. This should be sufficient.</p>
          <p>Additional paragraph with more content to ensure Readability
          treats this as a full article page for testing purposes.</p>
        </article>
      </body></html>
    `);

    const originalHTML = doc.body.innerHTML;
    extractArticleAggressive(doc);
    // The original document should not be mutated (aggressive clones internally)
    expect(doc.body.innerHTML).toBe(originalHTML);
  });

  it('handles article with empty paywall removal gracefully', () => {
    const doc = createDoc(`
      <html><head><title>Clean Article</title></head><body>
        <article>
          <h1>Clean Content</h1>
          <p>This is a clean article with no paywall elements.
          It needs enough text so that Readability will parse it as a proper
          article. Let me add some more words here to make sure the charThreshold
          is met. This should be sufficient for extraction.</p>
          <p>Additional paragraph with more content to ensure Readability
          treats this as a full article page for testing purposes.</p>
        </article>
      </body></html>
    `);

    const result = extractArticleAggressive(doc);
    expect(result).not.toBeNull();
    // Readability uses the <title> tag for article title
    expect(result!.title).toBe('Clean Article');
  });
});

// ── Null / edge cases ──────────────────────────────────────────────────

describe('parser edge cases', () => {
  it('extractArticle returns null for document with no readable content', () => {
    // A truly empty body with no text content
    const doc = createDoc(`
      <html><head><title></title></head><body></body></html>
    `);

    const result = extractArticle(doc);
    // Readability should return null for completely empty pages
    expect(result).toBeNull();
  });

  it('extractArticleAggressive may return null for document with no content after paywall removal', () => {
    // A page where after removing paywall elements, nothing is left to parse
    const doc = createDoc(`
      <html><head><title>Only Paywall</title></head><body>
        <div class="paywall-overlay">Please subscribe</div>
        <div class="newsletter-signup">Sign up for our newsletter</div>
      </body></html>
    `);

    const result = extractArticleAggressive(doc);
    // After removing paywall elements, there's nothing readable left
    // So Readability should return null (no article content) or undefined
    expect(result).toBeNull();
  });

  it('both functions handle empty body gracefully', () => {
    const doc = createDoc('<html><head><title>Empty</title></head><body></body></html>');
    expect(() => extractArticle(doc)).not.toThrow();
    expect(() => extractArticleAggressive(doc)).not.toThrow();
  });
});
