import React, { useEffect, useState } from 'react';
import {
  renderMermaidDiagram,
  renderSanitizedSvgNode,
  type SanitizedSvgNode,
} from './mermaidRenderer';

export interface MermaidDiagramProps {
  code: string;
}

export function MermaidDiagram({ code }: MermaidDiagramProps): React.ReactElement {
  const [state, setState] = useState<{
    status: 'loading' | 'rendered' | 'fallback';
    node: SanitizedSvgNode | null;
    reason?: string;
    forCode: string;
  }>({
    status: 'loading',
    node: null,
    forCode: code,
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) =>
      prev.forCode === code && prev.status !== 'loading'
        ? prev
        : { status: 'loading', node: null, forCode: code },
    );

    renderMermaidDiagram(code).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setState({ status: 'rendered', node: res.root, forCode: code });
      } else {
        setState({ status: 'fallback', node: null, reason: res.error, forCode: code });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.status === 'rendered' && state.node) {
    return (
      <figure
        data-testid="hermes-mermaid-diagram"
        className="my-2 border border-fui-border bg-fui-bg-carbon p-3 overflow-x-auto"
      >
        <div className="mb-2 flex items-center justify-between border-b border-fui-border pb-1 font-mono text-xs text-fui-text-secondary">
          <span>[MERMAID // DIAGRAM]</span>
          <span className="text-fui-cyan">SVG_STRICT</span>
        </div>
        <div className="flex justify-center overflow-x-auto">
          {renderSanitizedSvgNode(state.node, 'mmd-root')}
        </div>
      </figure>
    );
  }

  return (
    <div
      data-testid="hermes-mermaid-fallback"
      data-mermaid-status={state.status}
      className="my-2 border border-fui-border bg-fui-bg-carbon p-3"
    >
      <div className="mb-1.5 flex items-center justify-between border-b border-fui-border pb-1 font-mono text-xs text-fui-text-secondary">
        <span>[MERMAID // SOURCE]</span>
        <span className="text-fui-orange">
          {state.status === 'loading' ? 'PARSING_DIAGRAM' : 'SOURCE_FALLBACK'}
        </span>
      </div>
      <pre className="overflow-x-auto font-mono text-xs text-fui-text-primary whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
    </div>
  );
}
