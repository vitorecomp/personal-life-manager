import React, { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { prepareMarkdown } from './prepareMarkdown';
import { MermaidDiagram } from './MermaidDiagram';

export interface HermesMarkdownProps {
  content: string;
  className?: string;
  onSelectCitation?: (notePath: string) => void;
}

function isSafeLinkHref(href: string | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  try {
    const parsed = new URL(trimmed, 'https://hermes.local');
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:'
    );
  } catch {
    return false;
  }
}

export function HermesMarkdown({
  content,
  className = '',
  onSelectCitation,
}: HermesMarkdownProps): React.ReactElement {
  const prepared = useMemo(() => prepareMarkdown(content), [content]);

  const components = useMemo<Components>(
    () => ({
      p({ children }) {
        return <p className="mb-2 last:mb-0 leading-relaxed text-sm">{children}</p>;
      },
      h1({ children }) {
        return (
          <h1 className="mt-3 mb-2 border-b border-fui-border pb-1 font-mono text-base font-bold uppercase tracking-wider text-fui-text-primary">
            {children}
          </h1>
        );
      },
      h2({ children }) {
        return (
          <h2 className="mt-3 mb-1.5 font-mono text-sm font-bold uppercase tracking-wider text-fui-cyan">
            {children}
          </h2>
        );
      },
      h3({ children }) {
        return (
          <h3 className="mt-2 mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-fui-text-primary">
            {children}
          </h3>
        );
      },
      ul({ children }) {
        return <ul className="mb-2 list-disc pl-5 space-y-1 text-sm">{children}</ul>;
      },
      ol({ children }) {
        return <ol className="mb-2 list-decimal pl-5 space-y-1 text-sm">{children}</ol>;
      },
      li({ children }) {
        return <li className="leading-relaxed text-sm">{children}</li>;
      },
      blockquote({ children }) {
        return (
          <blockquote className="my-2 border border-fui-border bg-fui-bg-carbon px-3 py-2 font-mono text-xs text-fui-text-secondary">
            {children}
          </blockquote>
        );
      },
      table({ children }) {
        return (
          <div className="my-2 overflow-x-auto border border-fui-border">
            <table className="w-full border-collapse font-mono text-xs">{children}</table>
          </div>
        );
      },
      thead({ children }) {
        return <thead className="border-b border-fui-border bg-fui-bg-elevated">{children}</thead>;
      },
      th({ children }) {
        return (
          <th className="border-r border-fui-border px-2.5 py-1.5 text-left font-mono text-xs font-semibold uppercase tracking-wider text-fui-cyan last:border-r-0">
            {children}
          </th>
        );
      },
      td({ children }) {
        return (
          <td className="border-t border-r border-fui-border px-2.5 py-1.5 font-mono text-xs text-fui-text-primary last:border-r-0">
            {children}
          </td>
        );
      },
      a({ href, children }) {
        if (!isSafeLinkHref(href)) {
          return (
            <span
              data-testid="hermes-blocked-link"
              className="border border-fui-border bg-fui-bg-carbon px-1.5 py-0.5 font-mono text-xs text-fui-text-muted"
            >
              {children}
            </span>
          );
        }
        const cleanHref = href!.trim();
        const isVaultMd =
          cleanHref.endsWith('.md') &&
          !cleanHref.startsWith('http://') &&
          !cleanHref.startsWith('https://');
        if (isVaultMd && onSelectCitation) {
          return (
            <button
              type="button"
              onClick={() => onSelectCitation(cleanHref.replace(/^\//, ''))}
              className="inline-flex items-center gap-1 border border-fui-cyan bg-fui-bg-carbon px-1.5 py-0.5 font-mono text-xs text-fui-cyan hover:bg-fui-bg-hover"
            >
              <span>[VAULT]</span>
              <span>{children}</span>
            </button>
          );
        }
        return (
          <a
            href={cleanHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-fui-cyan underline hover:text-fui-orange"
          >
            {children}
          </a>
        );
      },
      pre({ children }) {
        return <>{children}</>;
      },
      code({ className: codeClass, children, ...rest }) {
        const rawText = String(children ?? '').replace(/\n$/, '');
        const langMatch = /language-([\w-]+)/.exec(codeClass ?? '');
        const lang = langMatch?.[1]?.toLowerCase() ?? '';
        const isBlock = Boolean(langMatch) || rawText.includes('\n');

        if (lang === 'mermaid') {
          return <MermaidDiagram code={rawText} />;
        }

        if (lang === 'math-source') {
          return (
            <div
              data-testid="hermes-math-fallback"
              className="my-2 border border-fui-border bg-fui-bg-carbon p-2.5"
            >
              <div className="mb-1 flex items-center justify-between border-b border-fui-border pb-1 font-mono text-xs text-fui-text-secondary">
                <span>[MATH // SOURCE]</span>
                <span className="text-fui-orange">RAW_EXPRESSION</span>
              </div>
              <pre className="overflow-x-auto font-mono text-xs text-fui-text-primary whitespace-pre-wrap">
                <code>{rawText}</code>
              </pre>
            </div>
          );
        }

        if (!isBlock) {
          if (rawText.startsWith('[MATH // SOURCE]')) {
            return (
              <code
                data-testid="hermes-math-fallback"
                className="border border-fui-orange bg-fui-bg-carbon px-1.5 py-0.5 font-mono text-xs text-fui-orange"
                {...rest}
              >
                {rawText}
              </code>
            );
          }
          return (
            <code
              className="border border-fui-border bg-fui-bg-carbon px-1.5 py-0.5 font-mono text-xs text-fui-cyan"
              {...rest}
            >
              {children}
            </code>
          );
        }

        return (
          <div className="my-2 border border-fui-border bg-fui-bg-carbon">
            <div className="flex items-center justify-between border-b border-fui-border bg-fui-bg-elevated px-2.5 py-1 font-mono text-xs text-fui-text-secondary">
              <span>[CODE // {(lang || 'TEXT').toUpperCase()}]</span>
              <span>UTF-8</span>
            </div>
            <pre className="overflow-x-auto p-2.5 font-mono text-xs text-fui-text-primary">
              <code className={codeClass} {...rest}>
                {rawText}
              </code>
            </pre>
          </div>
        );
      },
    }),
    [onSelectCitation],
  );

  return (
    <div
      data-testid="hermes-markdown"
      className={`hermes-markdown space-y-1 text-sm leading-relaxed ${className}`.trim()}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false, strict: 'ignore' }]]}
        components={components}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
