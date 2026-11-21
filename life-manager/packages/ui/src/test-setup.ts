import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, vi } from 'vitest';

const stylesPath = resolve(dirname(fileURLToPath(import.meta.url)), './styles.css');
const rawCss = readFileSync(stylesPath, 'utf8');
// Strip Tailwind v4 @import and @theme directives that jsdom CSSOM cannot parse natively
const jsdomSafeCss = rawCss
  .replace(/@import\s+["']tailwindcss["'];?/g, '')
  .replace(/@theme\s*\{[\s\S]*?\}/g, '');

function ensureStyleInjected() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('hermes-fui-test-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'hermes-fui-test-styles';
    styleEl.textContent = jsdomSafeCss;
    document.head.appendChild(styleEl);
  }
}

ensureStyleInjected();

if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof window.ResizeObserver !== 'function') {
    class MockResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      configurable: true,
      value: MockResizeObserver,
    });
  }
}

export interface MockCanvas2DContext {
  canvas: HTMLCanvasElement;
  imageSmoothingEnabled: boolean;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
}

const canvasContextMap = new WeakMap<HTMLCanvasElement, MockCanvas2DContext>();

function createMock2DContext(canvas: HTMLCanvasElement): MockCanvas2DContext {
  return {
    canvas,
    imageSmoothingEnabled: true,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
  };
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    writable: true,
    configurable: true,
    value: function getContext(this: HTMLCanvasElement, contextId: string) {
      if (contextId !== '2d') return null;
      let ctx = canvasContextMap.get(this);
      if (!ctx) {
        ctx = createMock2DContext(this);
        canvasContextMap.set(this, ctx);
      }
      return ctx;
    },
  });
}

beforeEach(() => {
  ensureStyleInjected();
});
