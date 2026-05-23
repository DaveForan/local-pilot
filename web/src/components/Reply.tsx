import { useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Walk a React node tree to recover plain text — used by the Copy button. */
function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    const text = extractText(children);
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard refused */
      },
    );
  };
  return (
    <div className="code-block">
      <button type="button" className="code-copy" onClick={onCopy}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

/** Render markdown the same way everywhere — chat replies, plan cards, etc. */
export function Reply({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      }}
    >
      {children}
    </Markdown>
  );
}
