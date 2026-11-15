import katex from 'katex';

const UNTRUSTED_LATEX_RE =
  /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData|input|include|write18|def|let|futurelet|catcode|csname)\b/i;

/**
 * Checks whether a LaTeX math snippet is syntactically complete and free of untrusted
 * link/HTML/macro-expansion commands.
 */
export function isValidSafeLatex(source: string, displayMode: boolean): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  if (UNTRUSTED_LATEX_RE.test(trimmed)) return false;
  try {
    const html = katex.renderToString(trimmed, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
      errorColor: '#cc0000',
    });
    if (html.includes('katex-error') || html.includes('#cc0000')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Protects currency amounts (e.g. `$3.40 / $5.00`, `R$ 1.250,00`, `$100 to $200`) outside
 * fenced code blocks and inline code spans, and normalizes unclosed streaming `$$` or
 * ```mermaid fences so incomplete streamed output degrades cleanly to labelled source.
 */
export function prepareMarkdown(raw: string): string {
  if (!raw) return '';
  const normalized = raw.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const out: string[] = [];

  let inFence = false;
  let fenceMarker = '';
  let fenceLang = '';
  let fenceBuffer: string[] = [];

  let inDisplayMath = false;
  let mathBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (inFence) {
      const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (closeMatch && closeMatch[1]!.startsWith(fenceMarker[0]!) && closeMatch[1]!.length >= fenceMarker.length) {
        out.push(`${fenceMarker}${fenceLang}`);
        out.push(...fenceBuffer);
        out.push(line);
        inFence = false;
        fenceMarker = '';
        fenceLang = '';
        fenceBuffer = [];
      } else {
        fenceBuffer.push(line);
      }
      continue;
    }

    if (inDisplayMath) {
      const closeIdx = line.indexOf('$$');
      if (closeIdx !== -1) {
        const beforeClose = line.slice(0, closeIdx);
        const afterClose = line.slice(closeIdx + 2);
        mathBuffer.push(beforeClose);
        const fullExpr = mathBuffer.join('\n');
        if (isValidSafeLatex(fullExpr, true)) {
          out.push('$$');
          out.push(fullExpr);
          out.push('$$');
        } else {
          out.push('```math-source');
          out.push(fullExpr);
          out.push('```');
        }
        inDisplayMath = false;
        mathBuffer = [];
        if (afterClose.trim()) {
          out.push(protectInlineCurrencyAndMath(afterClose));
        }
      } else {
        mathBuffer.push(line);
      }
      continue;
    }

    const openFence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (openFence) {
      inFence = true;
      fenceMarker = openFence[1]!;
      fenceLang = (openFence[2] ?? '').trim();
      fenceBuffer = [];
      continue;
    }

    // Single-line display math: $$ ... $$
    const singleLineDisplay = line.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (singleLineDisplay) {
      const expr = singleLineDisplay[1]!;
      if (isValidSafeLatex(expr, true)) {
        out.push('$$');
        out.push(expr.trim());
        out.push('$$');
      } else {
        out.push('```math-source');
        out.push(expr.trim());
        out.push('```');
      }
      continue;
    }

    // Multi-line display math opening `$$`
    if (/^\s*\$\$\s*$/.test(line)) {
      inDisplayMath = true;
      mathBuffer = [];
      continue;
    }
    const leadingDisplay = line.match(/^\s*\$\$(.+)$/);
    if (leadingDisplay && !leadingDisplay[1]!.includes('$$')) {
      inDisplayMath = true;
      mathBuffer = [leadingDisplay[1]!];
      continue;
    }

    out.push(protectInlineCurrencyAndMath(line));
  }

  // Unclosed code fence at end of stream: close it so react-markdown renders the code/mermaid block cleanly
  if (inFence) {
    out.push(`${fenceMarker}${fenceLang}`);
    out.push(...fenceBuffer);
    out.push(fenceMarker);
  }

  // Unclosed display math `$$` at end of stream: degrade to labelled math-source fence
  if (inDisplayMath) {
    out.push('```math-source');
    out.push(mathBuffer.join('\n'));
    out.push('```');
  }

  return out.join('\n');
}

function protectInlineCurrencyAndMath(line: string): string {
  // Split by inline code spans (`...`) so code is never touched
  const parts = line.split(/(`+[^`]*`+)/g);
  return parts
    .map((segment, idx) => {
      if (idx % 2 === 1) return segment;
      return rewriteInlineSegment(segment);
    })
    .join('');
}

function rewriteInlineSegment(segment: string): string {
  // Convert \( ... \) to $ ... $
  let working = segment.replace(/\\\((.+?)\\\)/g, (_m, inner: string) => `$${inner}$`);
  // Convert \[ ... \] on a single line to $$ ... $$
  working = working.replace(/\\\[(.+?)\\\]/g, (_m, inner: string) => {
    if (isValidSafeLatex(inner, true)) return `$$${inner}$$`;
    return `\`[MATH // SOURCE] ${inner.trim()}\``;
  });

  if (!working.includes('$')) return working;

  // Escape explicit BRL currency `R$` -> `R\$`
  working = working.replace(/\bR\$/g, 'R\\$');

  // Walk `$...$` pairs on the line and validate each candidate
  let result = '';
  let i = 0;
  while (i < working.length) {
    const ch = working[i];
    if (ch === '\\' && i + 1 < working.length) {
      result += working.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '$' && working[i + 1] === '$') {
      const close = working.indexOf('$$', i + 2);
      if (close !== -1) {
        const expr = working.slice(i + 2, close);
        if (isValidSafeLatex(expr, true)) {
          result += `$$${expr}$$`;
        } else {
          result += `\`[MATH // SOURCE] ${expr.trim()}\``;
        }
        i = close + 2;
        continue;
      }
      // Unclosed inline `$$`: degrade remainder to math source
      const tail = working.slice(i + 2).trim();
      result += tail ? `\`[MATH // SOURCE] ${tail}\`` : '\\$\\$';
      break;
    }
    if (ch === '$') {
      // Find next unescaped single `$`
      let close = -1;
      for (let j = i + 1; j < working.length; j++) {
        if (working[j] === '\\') {
          j += 1;
          continue;
        }
        if (working[j] === '$') {
          close = j;
          break;
        }
      }
      if (close === -1) {
        // Unclosed single `$`
        const after = working.slice(i + 1);
        // Currency value like `$5.00` or `$120k`
        if (/^\s*\d/.test(after) || after.trim().length === 0) {
          result += '\\$';
          i += 1;
          continue;
        }
        // Unclosed inline math like `$\frac{1}{` while streaming
        if (/\\[a-zA-Z]+|[_^{}]/.test(after)) {
          result += `\`[MATH // SOURCE] ${after.trim()}\``;
          break;
        }
        result += '\\$';
        i += 1;
        continue;
      }

      const candidate = working.slice(i + 1, close);
      // Check if the opening `$` is actually a currency token like `$3.40 / ` before another `$5.00`
      const looksLikeCurrencyPair =
        /^\d[\d.,]*\s*(?:[kKmMbB]|\b)/.test(candidate) &&
        /\s/.test(candidate) &&
        !/\\[a-zA-Z]+|[_^{}=<>]/.test(candidate);
      if (looksLikeCurrencyPair) {
        result += '\\$';
        i += 1;
        continue;
      }

      // Remark-math requires no leading/trailing space inside single `$`
      if (!candidate.trim() || /^\s|\s$/.test(candidate)) {
        result += '\\$';
        i += 1;
        continue;
      }

      if (isValidSafeLatex(candidate, false)) {
        result += `$${candidate}$`;
      } else {
        result += `\`[MATH // SOURCE] ${candidate.trim()}\``;
      }
      i = close + 1;
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
}
