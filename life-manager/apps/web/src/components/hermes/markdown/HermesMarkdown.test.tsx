import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HermesMarkdown } from './HermesMarkdown';

describe('HermesMarkdown — GFM, KaTeX, Mermaid, XSS & Degradation', () => {
  it('renders GFM tables, protects currency pairs ($3.40 / $5.00, R$ 1.250,00), and renders valid KaTeX math', () => {
    const content = [
      '| Asset | Price |',
      '| --- | --- |',
      '| PETR4 | $3.40 / $5.00 (R$ 1.250,00) |',
      '',
      'Inline Sharpe ratio $S = \\frac{R_p - R_f}{\\sigma_p}$ and display integral:',
      '',
      '$$',
      '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
      '$$',
    ].join('\n');

    const { container } = render(<HermesMarkdown content={content} />);

    expect(screen.getByText('PETR4')).toBeTruthy();
    expect(container.textContent).toContain('$3.40 / $5.00 (R$ 1.250,00)');
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.katex-display')).toBeTruthy();
  });

  it('degrades incomplete or untrusted LaTeX math gracefully to labelled [MATH // SOURCE] fallback without XSS', () => {
    const content = [
      'Unclosed streaming math: $\\frac{1}{2',
      '',
      'Untrusted link command: $\\href{javascript:alert(1)}{click}$',
      '',
      '$$',
      '\\sum_{k=1}^{n',
    ].join('\n');

    const { container } = render(<HermesMarkdown content={content} />);

    const fallbacks = screen.getAllByTestId('hermes-math-fallback');
    expect(fallbacks.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders valid Mermaid diagrams as sanitized SVG with 0px rect corners and degrades invalid Mermaid to source', async () => {
    const validContent = [
      '```mermaid',
      'graph TD',
      '  A[Capture Vault] --> B[Distill Insight]',
      '```',
    ].join('\n');

    const { container, rerender } = render(<HermesMarkdown content={validContent} />);

    await waitFor(
      () => {
        expect(screen.getByTestId('hermes-mermaid-diagram')).toBeTruthy();
      },
      { timeout: 5000 },
    );

    const svg = screen.getByTestId('hermes-mermaid-svg');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const rects = svg.querySelectorAll('rect');
    for (const r of rects) {
      expect(r.getAttribute('rx')).toBe('0');
      expect(r.getAttribute('ry')).toBe('0');
    }

    // Now rerender with an incomplete/invalid Mermaid fence
    rerender(<HermesMarkdown content={'```mermaid\ngraph TD\n  A -->\n```'} />);

    await waitFor(() => {
      const fb = screen.getByTestId('hermes-mermaid-fallback');
      expect(fb.getAttribute('data-mermaid-status')).toBe('fallback');
    });
    expect(container.textContent).toContain('[MERMAID // SOURCE]');
  });

  it('neutralizes XSS payloads in Markdown HTML, javascript: links, and Mermaid node labels', async () => {
    const hostile = [
      '<script>window.__pwned = true;</script>',
      '',
      '<img src="x" onerror="window.__pwned = true" />',
      '',
      '[Malicious Link](javascript:alert(1))',
      '',
      '```mermaid',
      'graph TD',
      '  X["<script>window.__pwned=1</script><img src=x onerror=alert(1)>"] --> Y[Safe]',
      '```',
    ].join('\n');

    const { container } = render(<HermesMarkdown content={hostile} />);

    await waitFor(
      () => {
        expect(screen.getByTestId('hermes-mermaid-diagram')).toBeTruthy();
      },
      { timeout: 5000 },
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByTestId('hermes-blocked-link')).toBeTruthy();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });
});
