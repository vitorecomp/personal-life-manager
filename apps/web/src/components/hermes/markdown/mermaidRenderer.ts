import React from 'react';

export interface SanitizedSvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<SanitizedSvgNode | string>;
}

export type MermaidRenderResult =
  | { ok: true; root: SanitizedSvgNode; rawSvg: string }
  | { ok: false; error: string };

const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'marker',
  'clippath',
  'mask',
  'lineargradient',
  'radialgradient',
  'stop',
  'style',
  'title',
  'desc',
  'pattern',
  'symbol',
]);

const FORBIDDEN_SUBTREE_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'foreignobject',
  'image',
  'use',
  'a',
]);

const ATTR_REACT_MAP: Record<string, string> = {
  class: 'className',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity',
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'clip-path': 'clipPath',
  'clip-rule': 'clipRule',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-style': 'fontStyle',
  'font-weight': 'fontWeight',
  'text-anchor': 'textAnchor',
  'text-decoration': 'textDecoration',
  'dominant-baseline': 'dominantBaseline',
  'alignment-baseline': 'alignmentBaseline',
  'baseline-shift': 'baselineShift',
  'marker-start': 'markerStart',
  'marker-mid': 'markerMid',
  'marker-end': 'markerEnd',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'vector-effect': 'vectorEffect',
  'pointer-events': 'pointerEvents',
  'shape-rendering': 'shapeRendering',
  ' letter-spacing': 'letterSpacing',
  'letter-spacing': 'letterSpacing',
  'word-spacing': 'wordSpacing',
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
   markerunits: 'markerUnits',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  refx: 'refX',
  refy: 'refY',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits',
  patterntransform: 'patternTransform',
  clippathunits: 'clipPathUnits',
   stddeviation: 'stdDeviation',
};

let initialized = false;
let renderCounter = 0;

function ensureDomShims(): void {
  if (typeof window === 'undefined') return;
  const g = globalThis as Record<string, unknown>;
  if (!g.CSSStyleSheet && 'CSSStyleSheet' in window) {
    g.CSSStyleSheet = (window as unknown as Record<string, unknown>).CSSStyleSheet;
  }
  if (typeof SVGElement !== 'undefined') {
    const proto = SVGElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.getBBox !== 'function') {
      proto.getBBox = function getBBoxShim() {
        return { x: 0, y: 0, width: 120, height: 36 };
      };
    }
    if (typeof proto.getComputedTextLength !== 'function') {
      proto.getComputedTextLength = function getComputedTextLengthShim(this: Element) {
        return Math.max(24, (this.textContent ?? '').length * 8);
      };
    }
  }
}

function sanitizeCssText(css: string): string {
  // Strip any external url(http...) or @import rules and enforce 0px border-radius on diagram shapes
  return css
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(?!#)[^)]*\)/gi, 'none')
    .replace(/expression\s*\([^)]*\)/gi, 'none')
    .replace(/javascript\s*:/gi, '')
    .replace(/rx\s*:\s*[^;!}]+/gi, 'rx: 0px')
    .replace(/ry\s*:\s*[^;!}]+/gi, 'ry: 0px')
    .replace(/border-radius\s*:\s*[^;!}]+/gi, 'border-radius: 0px');
}

function isUnsafeAttrValue(name: string, value: string): boolean {
  const lower = value.trim().toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('vbscript:') ||
    lower.includes('data:text/html') ||
    lower.includes('expression(')
  ) {
    return true;
  }
  if (name === 'href' || name === 'xlink:href' || name === 'src') {
    // Only allow internal fragment references (#marker-id) inside SVG
    return !lower.startsWith('#');
  }
  return false;
}

function sanitizeElement(el: Element): SanitizedSvgNode | null {
  const rawTag = el.tagName;
  const lowerTag = rawTag.toLowerCase();

  if (FORBIDDEN_SUBTREE_TAGS.has(lowerTag)) {
    return null;
  }
  if (!ALLOWED_SVG_TAGS.has(lowerTag)) {
    return null;
  }

  const canonicalTag =
    lowerTag === 'clippath'
      ? 'clipPath'
      : lowerTag === 'lineargradient'
        ? 'linearGradient'
        : lowerTag === 'radialgradient'
          ? 'radialGradient'
          : lowerTag;

  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    const attrName = attr.name;
    const lowerAttr = attrName.toLowerCase();

    if (lowerAttr.startsWith('on')) continue;
    if (lowerAttr.startsWith('xmlns')) continue;
    if (isUnsafeAttrValue(lowerAttr, attr.value)) continue;

    if (lowerAttr === 'style') {
      // Keep safe inline style string cleaned of external URLs and rounded corners
      attrs['data-svg-style'] = sanitizeCssText(attr.value);
      continue;
    }

    const mapped = ATTR_REACT_MAP[lowerAttr] ?? ATTR_REACT_MAP[attrName] ?? attrName;
    attrs[mapped] = attr.value;
  }

  // Enforce REF-02 0px rectilinear invariant on all SVG <rect> nodes
  if (canonicalTag === 'rect') {
    attrs.rx = '0';
    attrs.ry = '0';
  }

  if (canonicalTag === 'style') {
    const css = sanitizeCssText(el.textContent ?? '');
    return {
      tag: 'style',
      attrs,
      children: css ? [css] : [],
    };
  }

  const children: Array<SanitizedSvgNode | string> = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]!;
    if (node.nodeType === 3) {
      // Text node
      const text = node.nodeValue ?? '';
      if (text) children.push(text);
    } else if (node.nodeType === 1) {
      const childEl = node as Element;
      // Convert <foreignObject> strictly into plain text if Mermaid ever emitted one
      if (childEl.tagName.toLowerCase() === 'foreignobject') {
        const plain = (childEl.textContent ?? '').trim();
        if (plain) {
          children.push({
            tag: 'text',
            attrs: {
              x: childEl.getAttribute('x') ?? '0',
              y: childEl.getAttribute('y') ?? '14',
              fill: '#F6F6F4',
              fontSize: '12',
            },
            children: [plain],
          });
        }
        continue;
      }
      const sanitizedChild = sanitizeElement(childEl);
      if (sanitizedChild) {
        children.push(sanitizedChild);
      }
    }
  }

  return {
    tag: canonicalTag,
    attrs,
    children,
  };
}

function parseStyleString(cssText: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const part of cssText.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const rawProp = part.slice(0, colon).trim();
    const rawVal = part.slice(colon + 1).trim();
    if (!rawProp || !rawVal) continue;
    if (rawProp.startsWith('--')) {
      style[rawProp] = rawVal;
      continue;
    }
    const camelProp = rawProp.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    style[camelProp] = rawVal;
  }
  return style as React.CSSProperties;
}

export function renderSanitizedSvgNode(
  node: SanitizedSvgNode | string,
  key: string | number,
): React.ReactNode {
  if (typeof node === 'string') {
    return node;
  }
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'data-svg-style') {
      props.style = parseStyleString(v);
    } else {
      props[k] = v;
    }
  }
  if (node.tag === 'svg') {
    props['data-testid'] = 'hermes-mermaid-svg';
    props.className = `${props.className ? `${String(props.className)} ` : ''}max-w-full h-auto`;
  }
  const renderedChildren = node.children.map((child, idx) =>
    renderSanitizedSvgNode(child, `${key}-${idx}`),
  );
  return React.createElement(node.tag, props, ...renderedChildren);
}

/**
 * Sanitizes raw SVG markup into a safe `SanitizedSvgNode` tree with zero executable scripts,
 * event attributes, or `<foreignObject>` HTML injection.
 */
export function sanitizeMermaidSvg(rawSvg: string): SanitizedSvgNode | null {
  if (typeof DOMParser === 'undefined') return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    return null;
  }
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return null;
  return sanitizeElement(svgEl);
}

export async function renderMermaidDiagram(source: string): Promise<MermaidRenderResult> {
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty Mermaid diagram source' };
  }

  ensureDomShims();

  const renderId = `hermes_mmd_${++renderCounter}_${Date.now()}`;
  try {
    const mod = await import('mermaid');
    const mermaid = mod.default;
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        sequence: { useMaxWidth: true },
        theme: 'dark',
        themeVariables: {
          background: '#08080B',
          primaryColor: '#111319',
          primaryTextColor: '#F6F6F4',
          primaryBorderColor: '#2CE5F2',
          lineColor: '#A1A6B3',
          secondaryColor: '#161922',
          tertiaryColor: '#0E1016',
          fontFamily: '"JetBrains Mono", "IBM Plex Mono", monospace',
          fontSize: '12px',
        },
      });
      initialized = true;
    }

    await mermaid.parse(trimmed, { suppressErrors: false });
    const { svg } = await mermaid.render(renderId, trimmed);
    const sanitized = sanitizeMermaidSvg(svg);
    if (!sanitized) {
      return { ok: false, error: 'Mermaid output failed SVG sanitization check' };
    }
    return { ok: true, root: sanitized, rawSvg: svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || 'Invalid or incomplete Mermaid diagram syntax' };
  } finally {
    if (typeof document !== 'undefined') {
      const stray = document.getElementById(`d${renderId}`) ?? document.getElementById(renderId);
      stray?.remove();
    }
  }
}
