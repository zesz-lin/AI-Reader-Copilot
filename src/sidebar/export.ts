import type { SummaryStyle } from '../shared';

function safeFilename(title: string, style: SummaryStyle): string {
  const slug = title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .toLowerCase();
  return `${slug}-${style}.md`;
}

export function downloadMarkdown(
  content: string,
  title: string,
  style: SummaryStyle,
): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename(title, style);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function copyFullMarkdown(content: string): Promise<void> {
  await navigator.clipboard.writeText(content);
}
