import { memo, Children, isValidElement } from 'react';
import { DiffView } from './DiffView';
import { suppliedChanges } from '../../shared/diff';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProjectFileLink } from './ProjectFileLink';
import { safeExternalUrl } from '../../shared/markdown';
import { MessageImage } from './MessageImage';

export default memo(function MessageBody({ text }: { text: string }): React.JSX.Element {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: ({ children }) => {
      const code = Children.toArray(children)[0];
      if (isValidElement<{ className?: string; children?: React.ReactNode }>(code) && /language-(diff|patch)/.test(code.props.className ?? '')) {
        const patch = String(code.props.children ?? '');
        if (suppliedChanges(patch).length) return <DiffView value={patch} />;
      }
      return <pre>{children}</pre>;
    },
    a: ({ children, href }) => safeExternalUrl(href ?? '') ? <a href={safeExternalUrl(href!)} target="_blank" rel="noopener noreferrer">{children}</a> : <ProjectFileLink url={href ?? ''}>{children}</ProjectFileLink>,
    p: ({ children }) => <div className="markdown-paragraph">{children}</div>,
    img: ({ alt, src }) => <MessageImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
  }}>{text}</ReactMarkdown></div>;
});
