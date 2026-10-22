import { Children, isValidElement } from 'react';
import { DiffView } from './DiffView';
import { suppliedChanges } from '../../shared/diff';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MessageBody({ text }: { text: string }): React.JSX.Element {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: ({ children }) => {
      const code = Children.toArray(children)[0];
      if (isValidElement<{ className?: string; children?: React.ReactNode }>(code) && /language-(diff|patch)/.test(code.props.className ?? '')) {
        const patch = String(code.props.children ?? '');
        if (suppliedChanges(patch).length) return <DiffView value={patch} />;
      }
      return <pre>{children}</pre>;
    },
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : '[图片]'}</span>,
  }}>{text}</ReactMarkdown></div>;
}
