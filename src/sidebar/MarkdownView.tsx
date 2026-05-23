import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  content: string;
}

export default function MarkdownView({ content }: Props) {
  const html = useMemo(() => marked.parse(content) as string, [content]);

  return (
    <div
      className="markdown-body px-4 py-2"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
