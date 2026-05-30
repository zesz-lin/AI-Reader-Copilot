import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  content: string;
}

export default function MarkdownView({ content }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(content) as string;
    return DOMPurify.sanitize(raw);
  }, [content]);

  return (
    <div
      className="markdown-body px-4 py-2"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
