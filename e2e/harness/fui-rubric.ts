import type { Page } from '@playwright/test';

export interface BorderRadiusViolation {
  tag: string;
  text: string;
  borderRadius: string;
}

export interface FontFloorViolation {
  tag: string;
  text: string;
  fontSize: string;
}

export interface SpriteViolation {
  tag: string;
  imageRendering: string;
}

export interface ColorTokensAuditResult {
  bgRgb: string;
  customProps: Record<string, string>;
  hasCarbonBg: boolean;
  hasBlazeOrangeAccent: boolean;
  hasStarkWhiteInk: boolean;
}

export interface ApertureLogoAuditResult {
  found: boolean;
  svgLayerCount: number;
  hasOrangeGear: boolean;
  hasShutterBlades: boolean;
  hasStatusIris: boolean;
}

export interface BlueprintCorridorsAuditResult {
  segmentCount: number;
  diagonalOrCurvedViolations: string[];
}

export async function waitForAppReady(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

  const checkDomReady = (allowStage3WithMain: boolean): boolean => {
    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;

    const isVisible = (el: Element): { visible: boolean; rect: DOMRect } => {
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number.parseFloat(cs.opacity || '1') <= 0.05 ||
        cs.pointerEvents === 'none' ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        return { visible: false, rect };
      }
      return { visible: true, rect };
    };

    const normalizeHint = (raw: string): string =>
      raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[_./\\:-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const BOOT_HINT_RE = /\b(orbital boot|boot screen|boot gate|boot astrolabe|splash screen)\b/;

    const allElements = Array.from(document.body ? document.body.querySelectorAll('*') : []);
    for (const el of allElements) {
      const { visible, rect } = isVisible(el);
      if (!visible) continue;

      const idAndClass = normalizeHint(
        `${el.id || ''} ${typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''} ${el.getAttribute('data-testid') || ''}`,
      );
      if (
        el.hasAttribute('data-fui-boot') ||
        (BOOT_HINT_RE.test(idAndClass) &&
          rect.width >= vw * 0.3 &&
          rect.height >= vh * 0.3)
      ) {
        if (!allowStage3WithMain) return false;
      }

      if (el.children.length <= 4) {
        const txt = (el.textContent || '').trim();
        if (txt.length > 0 && txt.length <= 120) {
          const stageMatch = txt.match(/\[\s*([123])\s*\/\/\s*(DB_ONLINE|HERMES_GATEWAY|READY)\s*\]/i);
          if (stageMatch) {
            const stageNum = stageMatch[1];
            if (stageNum === '1' || stageNum === '2') {
              return false;
            }
            if (stageNum === '3' && !allowStage3WithMain) {
              return false;
            }
          }
        }
      }
    }

    const shellLandmarks = document.querySelectorAll(
      'main, [role="main"], nav, [role="navigation"], [role="tablist"], header, [data-fui-ready], button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]',
    );
    for (const node of Array.from(shellLandmarks)) {
      if (isVisible(node).visible) {
        return true;
      }
    }
    return false;
  };

  try {
    await page.waitForFunction(checkDomReady, false, { timeout: 6_000, polling: 80 });
  } catch {
    await page
      .evaluate(() => {
        const normalizeHint = (raw: string): string =>
          raw
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
            .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
            .toLowerCase()
            .replace(/[_./\\:-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const bootEl =
          document.querySelector('[data-fui-boot]') ||
          Array.from(document.querySelectorAll('*')).find((el) =>
            /\b(orbital boot|boot screen|boot gate|boot astrolabe|splash screen)\b/.test(
              normalizeHint(
                `${el.id || ''} ${typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''} ${el.getAttribute('data-testid') || ''}`,
              ),
            ),
          );
        if (bootEl) {
          const btn = bootEl.querySelector('button, [role="button"]') as HTMLElement | null;
          if (btn) btn.click();
        }
      })
      .catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForFunction(checkDomReady, true, { timeout: 9_000, polling: 100 });
  }

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}

export async function auditZeroBorderRadius(
  page: Page,
  selector?: string,
): Promise<{ checkedCount: number; violations: Array<{ tag: string; text: string; borderRadius: string }> }> {
  return page.evaluate((sel) => {
    const NON_BOX_TAGS = new Set([
      'script',
      'style',
      'noscript',
      'template',
      'circle',
      'ellipse',
      'path',
      'line',
      'polyline',
      'polygon',
      'g',
      'text',
      'tspan',
      'use',
      'stop',
      'lineargradient',
      'radialgradient',
      'pattern',
      'defs',
      'clippath',
      'mask',
      'symbol',
      'title',
      'desc',
      'metadata',
    ]);

    const INTERACTIVE_ROLES = new Set([
      'button',
      'tab',
      'menuitem',
      'link',
      'checkbox',
      'radio',
      'switch',
      'slider',
      'textbox',
      'combobox',
      'listbox',
      'option',
      'dialog',
      'alertdialog',
    ]);

    const normalizeHint = (raw: string): string =>
      raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[_./\\:-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const HUD_RING_HINT_RE =
      /\b(fui rings?|orbital rings?|orbit rings?|hud rings?|radar reticles?|reticles?|thinking orbs?|geodesic orbs?|geodesic thinking orbs?|astrolabes?|orbital boot|aperture logo|system aperture|donut gauges?|hatched donuts?|hud loaders?|modular hud|sonar arrays?|vector arrays?|proximity scan|beacons?|north star)\b/;

    const isCornerFullCircle = (cornerVal: string, baseW: number): boolean => {
      const parts = cornerVal.trim().split(/[\s/]+/).filter(Boolean);
      if (parts.length === 0) return false;
      return parts.every((tok) => {
        const n = Number.parseFloat(tok);
        if (Number.isNaN(n)) return false;
        if (tok.endsWith('%')) return n >= 49.5;
        return n >= 999 || (baseW > 0 && n >= baseW * 0.48);
      });
    };

    const hasNonZeroToken = (val: string): boolean => {
      if (!val) return false;
      const parts = val.trim().split(/[\s/]+/).filter(Boolean);
      return parts.some((tok) => {
        const n = Number.parseFloat(tok);
        return !Number.isNaN(n) && Math.abs(n) > 0.01;
      });
    };

    const candidates = sel
      ? Array.from(document.querySelectorAll(sel))
      : Array.from(document.body ? document.body.querySelectorAll('*') : []);

    let checkedCount = 0;
    const violations: Array<{ tag: string; text: string; borderRadius: string }> = [];

    for (const el of candidates) {
      const tag = el.tagName.toLowerCase();
      if (NON_BOX_TAGS.has(tag)) continue;
      if (el.closest('[hidden], template, defs, clipPath, mask, symbol, dialog:not([open])')) {
        continue;
      }

      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number.parseFloat(cs.opacity || '1') <= 0.01 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      const role = (el.getAttribute('role') || '').toLowerCase().trim();
      const isInteractive =
        tag === 'button' ||
        tag === 'input' ||
        tag === 'select' ||
        tag === 'textarea' ||
        tag === 'dialog' ||
        tag === 'summary' ||
        (tag === 'a' && el.hasAttribute('href')) ||
        INTERACTIVE_ROLES.has(role);

      if (!isInteractive) {
        if (
          el.hasAttribute('data-fui-ring') ||
          el.hasAttribute('data-fui-orb') ||
          el.hasAttribute('data-fui-reticle') ||
          el.hasAttribute('data-fui-beacon') ||
          el.hasAttribute('data-fui-donut') ||
          el.hasAttribute('data-fui-aperture') ||
          el.hasAttribute('data-hud-ring')
        ) {
          continue;
        }

        const baseW = el instanceof HTMLElement ? el.offsetWidth || rect.width : rect.width;
        const baseH = el instanceof HTMLElement ? el.offsetHeight || rect.height : rect.height;
        const isSquare = Math.abs(baseW - baseH) <= 2;

        const corners = [
          cs.borderTopLeftRadius,
          cs.borderTopRightRadius,
          cs.borderBottomRightRadius,
          cs.borderBottomLeftRadius,
        ];
        const allFullCircle =
          isSquare && corners.every((c) => isCornerFullCircle(c, baseW));

        if (
          allFullCircle &&
          !el.querySelector('button, input, select, textarea, a[href], [role="button"]') &&
          !el.closest('button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="menuitem"]')
        ) {
          if (
            el.closest(
              '[data-fui-ring], [data-fui-orb], [data-fui-reticle], [data-fui-beacon], [data-fui-donut], [data-fui-aperture], [data-hud-ring]',
            )
          ) {
            continue;
          }

          const hintParts: string[] = [
            el.id || '',
            typeof el.className === 'string' ? el.className : el.getAttribute('class') || '',
            el.getAttribute('data-testid') || '',
            el.getAttribute('aria-label') || '',
          ];
          let currParent = el.parentElement;
          let depth = 0;
          while (currParent && depth < 4) {
            const pTag = currParent.tagName.toLowerCase();
            const pRole = (currParent.getAttribute('role') || '').toLowerCase().trim();
            const parentInteractive =
              pTag === 'button' ||
              pTag === 'input' ||
              pTag === 'select' ||
              pTag === 'textarea' ||
              pTag === 'dialog' ||
              pTag === 'summary' ||
              (pTag === 'a' && currParent.hasAttribute('href')) ||
              INTERACTIVE_ROLES.has(pRole);
            if (parentInteractive) break;
            hintParts.push(
              currParent.id || '',
              typeof currParent.className === 'string'
                ? currParent.className
                : currParent.getAttribute('class') || '',
              currParent.getAttribute('data-testid') || '',
              currParent.getAttribute('aria-label') || '',
            );
            currParent = currParent.parentElement;
            depth += 1;
          }

          if (HUD_RING_HINT_RE.test(normalizeHint(hintParts.join(' ')))) {
            continue;
          }

          const wordCount = (el.textContent || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean).length;

          if (
            baseW > 20 &&
            wordCount <= 2 &&
            (Number.parseFloat(cs.borderTopWidth) > 0 ||
              Number.parseFloat(cs.outlineWidth) > 0 ||
              cs.boxShadow !== 'none' ||
              /conic-gradient|radial-gradient/i.test(cs.backgroundImage))
          ) {
            continue;
          }

          const trimmedText = (el.textContent || '').trim();
          if (
            baseW <= 28 &&
            (trimmedText === '' || trimmedText === '●') &&
            !el.closest('[data-testid*="waffle" i], [class*="waffle" i]')
          ) {
            continue;
          }
        }
      }

      checkedCount += 1;

      if (tag === 'rect') {
        const rx = Number.parseFloat((cs as any).rx || el.getAttribute('rx') || '0') || 0;
        const ry = Number.parseFloat((cs as any).ry || el.getAttribute('ry') || '0') || 0;
        if (rx > 0.01 || ry > 0.01) {
          violations.push({
            tag: 'rect',
            text: '',
            borderRadius: `rx=${rx} ry=${ry}`,
          });
        }
        continue;
      }

      const corners = [
        cs.borderTopLeftRadius,
        cs.borderTopRightRadius,
        cs.borderBottomRightRadius,
        cs.borderBottomLeftRadius,
      ];
      if (corners.some(hasNonZeroToken) || hasNonZeroToken(cs.borderRadius)) {
        const label = (
          (el as HTMLElement).innerText ||
          el.textContent ||
          el.getAttribute('aria-label') ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
        violations.push({
          tag,
          text: label,
          borderRadius: hasNonZeroToken(cs.borderRadius) ? cs.borderRadius : corners.join(' '),
        });
      }
    }

    return { checkedCount, violations };
  }, selector);
}

export async function auditInteractiveFontFloor(
  page: Page,
  minPx = 12,
): Promise<{ checkedCount: number; violations: Array<{ tag: string; text: string; fontSize: string }> }> {
  return page.evaluate((threshold) => {
    const query =
      'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="tab"], [role="menuitem"], nav a';
    const uniqueControls = Array.from(new Set(Array.from(document.querySelectorAll(query))));
    const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'color', 'hidden']);

    let checkedCount = 0;
    const violations: Array<{ tag: string; text: string; fontSize: string }> = [];

    for (const el of uniqueControls) {
      if (el.closest('[hidden], [aria-hidden="true"], dialog:not([open])')) continue;
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        Number.parseFloat(cs.opacity || '1') <= 0.01 ||
        rect.width <= 1 ||
        rect.height <= 1
      ) {
        continue;
      }
      if (
        cs.position === 'absolute' &&
        rect.width <= 2 &&
        rect.height <= 2 &&
        cs.overflow === 'hidden'
      ) {
        continue;
      }

      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (tag === 'input') {
          const inputType = ((el as HTMLInputElement).type || 'text').toLowerCase();
          if (NON_TEXT_INPUT_TYPES.has(inputType)) continue;
        }
        checkedCount += 1;
        const px = Number.parseFloat(cs.fontSize);
        if (!Number.isNaN(px) && px < threshold - 0.01) {
          const txt = (
            (el as HTMLInputElement).value ||
            el.getAttribute('placeholder') ||
            el.getAttribute('aria-label') ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
          violations.push({ tag, text: txt, fontSize: cs.fontSize });
        }
        continue;
      }

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const renderedFonts: Array<{ px: number; raw: string; text: string }> = [];
      let currentNode = walker.nextNode();

      while (currentNode) {
        const rawText = (currentNode.nodeValue || '').replace(/\s+/g, ' ').trim();
        const parent = currentNode.parentElement;
        if (
          rawText.length > 0 &&
          parent &&
          !parent.closest('svg, script, style, [aria-hidden="true"], [data-fui-reticle]')
        ) {
          const pcs = window.getComputedStyle(parent);
          const prect = parent.getBoundingClientRect();
          if (
            pcs.display !== 'none' &&
            pcs.visibility !== 'hidden' &&
            prect.width > 1 &&
            prect.height > 1
          ) {
            const px = Number.parseFloat(pcs.fontSize);
            if (!Number.isNaN(px)) {
              renderedFonts.push({ px, raw: pcs.fontSize, text: rawText });
            }
          }
        }
        currentNode = walker.nextNode();
      }

      if (renderedFonts.length === 0) {
        // Pure SVG / icon-only button without text
        continue;
      }

      checkedCount += 1;
      renderedFonts.sort((a, b) => a.px - b.px);
      const minEntry = renderedFonts[0];
      if (minEntry.px < threshold - 0.01) {
        const combinedText = renderedFonts
          .map((e) => e.text)
          .join(' ')
          .slice(0, 80);
        violations.push({
          tag,
          text: combinedText,
          fontSize: minEntry.raw,
        });
      }
    }

    return { checkedCount, violations };
  }, minPx ?? 12);
}

export async function auditColorTokens(page: Page): Promise<ColorTokensAuditResult> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const parseColor = (
      val: string | null | undefined,
    ): { r: number; g: number; b: number; a: number; rgbStr: string } | null => {
      if (!ctx || !val) return null;
      const trimmed = val.trim();
      if (!trimmed) return null;
      const lower = trimmed.toLowerCase();
      if (
        lower === 'none' ||
        lower === 'transparent' ||
        lower === 'inherit' ||
        lower === 'initial' ||
        lower === 'unset' ||
        lower === 'currentcolor'
      ) {
        return null;
      }
      if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
        if (!CSS.supports('color', trimmed)) return null;
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = trimmed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a === 0) return null;
      return { r, g, b, a, rgbStr: `rgb(${r}, ${g}, ${b})` };
    };

    const rgbNear = (
      c: { r: number; g: number; b: number } | null,
      target: [number, number, number],
      tol = 2,
    ): boolean => {
      if (!c) return false;
      return (
        Math.abs(c.r - target[0]) <= tol &&
        Math.abs(c.g - target[1]) <= tol &&
        Math.abs(c.b - target[2]) <= tol
      );
    };

    const customProps: Record<string, string> = {};

    const collectRules = (rules: CSSRuleList | undefined) => {
      if (!rules) return;
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if ('style' in rule && 'selectorText' in rule) {
          const sel = String((rule as CSSStyleRule).selectorText || '');
          if (/(:root|\bhtml\b|\bbody\b|\*)/.test(sel)) {
            const style = (rule as CSSStyleRule).style;
            for (let j = 0; j < style.length; j++) {
              const prop = style[j];
              if (prop.startsWith('--')) {
                const v = style.getPropertyValue(prop).trim();
                if (v) customProps[prop] = v;
              }
            }
          }
        } else if ('cssRules' in rule) {
          try {
            collectRules((rule as CSSGroupingRule).cssRules);
          } catch {
            // Cross-origin or inaccessible nested rule
          }
        }
      }
    };

    for (let i = 0; i < document.styleSheets.length; i++) {
      try {
        collectRules(document.styleSheets[i].cssRules);
      } catch {
        // Ignore cross-origin stylesheets
      }
    }

    for (const rootEl of [document.documentElement, document.body].filter(
      (x): x is HTMLElement => Boolean(x),
    )) {
      const cs = window.getComputedStyle(rootEl);
      for (let i = 0; i < cs.length; i++) {
        const prop = cs[i];
        if (prop.startsWith('--')) {
          const val = cs.getPropertyValue(prop).trim();
          if (val) customProps[prop] = val;
        }
      }
    }

    const bgCandidates = [
      document.body,
      document.documentElement,
      document.querySelector('#root'),
      document.querySelector('#app'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('[data-fui-canvas]'),
      document.body?.firstElementChild ?? null,
    ].filter((el): el is Element => Boolean(el));

    let resolvedBg: { r: number; g: number; b: number; a: number; rgbStr: string } | null = null;
    for (const el of bgCandidates) {
      const parsed = parseColor(window.getComputedStyle(el).backgroundColor);
      if (parsed && parsed.a > 0) {
        resolvedBg = parsed;
        break;
      }
    }

    const bgRgb = resolvedBg
      ? resolvedBg.rgbStr
      : document.body
        ? window.getComputedStyle(document.body).backgroundColor
        : 'rgb(0, 0, 0)';

    const DARK_ROUTE_CANVASES: Array<[number, number, number]> = [
      [8, 8, 11], // #08080B Pitch Carbon
      [16, 23, 29], // #10171D Blueprint Slate
      [20, 21, 38], // #141526 Isometric Arena
      [13, 7, 22], // #0D0716 Tactical Plum
    ];

    let hasCarbonBg = DARK_ROUTE_CANVASES.some((t) => rgbNear(resolvedBg, t, 2));
    if (!hasCarbonBg) {
      for (const el of bgCandidates) {
        const parsed = parseColor(window.getComputedStyle(el).backgroundColor);
        if (DARK_ROUTE_CANVASES.some((t) => rgbNear(parsed, t, 2))) {
          hasCarbonBg = true;
          break;
        }
      }
    }

    const BLAZE_ORANGE: [number, number, number] = [248, 124, 24]; // #F87C18
    const STARK_WHITE: [number, number, number] = [246, 246, 244]; // #F6F6F4

    let hasBlazeOrangeAccent = false;
    let hasStarkWhiteInk = false;

    for (const val of Object.values(customProps)) {
      const c = parseColor(val);
      if (!c) continue;
      if (rgbNear(c, BLAZE_ORANGE, 2)) hasBlazeOrangeAccent = true;
      if (rgbNear(c, STARK_WHITE, 2)) hasStarkWhiteInk = true;
    }

    if (!hasBlazeOrangeAccent || !hasStarkWhiteInk) {
      const allEls = Array.from(document.querySelectorAll('*'));
      for (const el of allEls) {
        const cs = window.getComputedStyle(el);
        const samples = [
          cs.color,
          cs.backgroundColor,
          cs.borderTopColor,
          cs.borderBottomColor,
          cs.borderLeftColor,
          cs.borderRightColor,
          cs.outlineColor,
          (cs as any).fill,
          (cs as any).stroke,
          el.getAttribute('fill'),
          el.getAttribute('stroke'),
        ];
        for (const s of samples) {
          const c = parseColor(s);
          if (!c) continue;
          if (rgbNear(c, BLAZE_ORANGE, 2)) hasBlazeOrangeAccent = true;
          if (rgbNear(c, STARK_WHITE, 2)) hasStarkWhiteInk = true;
        }
        if (hasBlazeOrangeAccent && hasStarkWhiteInk) break;
      }
    }

    return {
      bgRgb,
      customProps,
      hasCarbonBg,
      hasBlazeOrangeAccent,
      hasStarkWhiteInk,
    };
  });
}

export async function auditPixelatedSprites(
  page: Page,
): Promise<{ spriteCount: number; violations: Array<{ tag: string; imageRendering: string }> }> {
  return page.evaluate(() => {
    const normalizeHint = (raw: string): string =>
      raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[_./\\:()"'[\]{},;=?&#-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const SPRITE_ATTRS = [
      'data-sprite',
      'data-sprite-name',
      'data-sprite-scale',
      'data-scale',
      'data-frame-width',
      'data-frame-w',
      'data-frame-height',
      'data-frame-h',
      'data-frame-size',
      'data-fui-sprite',
      'data-companion-stage',
      'data-pixel-art',
      'data-knight-sprite',
      'data-animation',
      'data-archetype',
    ];

    const SPRITE_HINT_RE =
      /\b(sprites?|pixel art|frieren|companion stage|companion sprites?|mini sprites?|portrait stage|knight sprites?|isometric knights?|knight units?|knight avatars?|knights?|paladins?|vanguards?|lore wardens?|inquisitors?|artificers?)\b/;

    const TIGHT_SPRITE_STAGE_RE =
      /\b(sprites?|pixel art|companion stage|companion sprites?|mini sprites?|portrait stage|knight sprites?|isometric knight sprites?|knight units?|knight avatars?)\b/;

    const NON_SPRITE_CHART_RE =
      /\b(orbs?|geodesic|astrolabes?|sparklines?|waveforms?|candlesticks?|constellations?|radars?|reticles?|barcodes?|donuts?|waffles?|dot matrix|blueprint|charts?|bars?|gauges?|heatmaps?|qr|pairing|arenas?|boards?|grids?|logos?|icons?)\b/;

    const VALID_IR = new Set(['pixelated', 'crisp-edges', '-webkit-optimize-contrast']);

    const isVectorSvgImg = (el: Element): boolean => {
      if (el.tagName.toLowerCase() !== 'img') return false;
      const srcAttr = (el.getAttribute('src') || '').trim();
      if (/^data:image\/svg\+xml/i.test(srcAttr) || /\.svg(?:[?#]|$)/i.test(srcAttr)) {
        return true;
      }
      const currentSrc = ((el as HTMLImageElement).currentSrc || '').trim();
      return /^data:image\/svg\+xml/i.test(currentSrc) || /\.svg(?:[?#]|$)/i.test(currentSrc);
    };

    const stripDataUris = (val: string): string => {
      if (!val) return '';
      if (/^\s*data:/i.test(val)) return '';
      return val.replace(/url\(\s*["']?data:[^)"']+["']?\s*\)/gi, '');
    };

    const getNormalizedIdentity = (el: Element): string => {
      const cs = window.getComputedStyle(el);
      const rawSrc = stripDataUris(el.getAttribute('src') || '');
      const rawBg = cs.backgroundImage !== 'none' ? stripDataUris(cs.backgroundImage) : '';
      return normalizeHint(
        [
          el.id || '',
          typeof el.className === 'string' ? el.className : el.getAttribute('class') || '',
          el.getAttribute('data-testid') || '',
          el.getAttribute('aria-label') || '',
          el.getAttribute('alt') || '',
          rawSrc,
          rawBg,
        ].join(' '),
      );
    };

    const isInsideNonSpriteChart = (el: Element): boolean => {
      if (
        el.closest(
          '[data-fui-orb], [data-fui-ring], [data-fui-donut], [data-fui-chart], [data-fui-blueprint], [data-fui-aperture]',
        )
      ) {
        return true;
      }
      let curr: Element | null = el;
      let depth = 0;
      while (curr && depth < 4) {
        if (SPRITE_ATTRS.some((a) => curr!.hasAttribute(a))) {
          return false;
        }
        const norm = getNormalizedIdentity(curr);
        if (TIGHT_SPRITE_STAGE_RE.test(norm)) {
          return false;
        }
        if (NON_SPRITE_CHART_RE.test(norm)) {
          return true;
        }
        if (
          curr === el &&
          (el.tagName.toLowerCase() === 'canvas' || el.tagName.toLowerCase() === 'img') &&
          SPRITE_HINT_RE.test(norm)
        ) {
          return false;
        }
        curr = curr.parentElement;
        depth += 1;
      }
      return false;
    };

    const isVisible = (el: Element): { ok: boolean; rect: DOMRect } => {
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        ok:
          cs.display !== 'none' &&
          cs.visibility !== 'hidden' &&
          Number.parseFloat(cs.opacity || '1') > 0.01 &&
          rect.width > 0 &&
          rect.height > 0,
        rect,
      };
    };

    const spriteSet = new Set<Element>();
    const allElements = Array.from(document.body ? document.body.querySelectorAll('*') : []);

    for (const el of allElements) {
      const tag = el.tagName.toLowerCase();
      if (isVectorSvgImg(el)) continue;

      const hasAttr = SPRITE_ATTRS.some((a) => el.hasAttribute(a));
      const normId = getNormalizedIdentity(el);

      if ((tag === 'canvas' || tag === 'img') && !hasAttr && isVisible(el).ok) {
        const ir = window.getComputedStyle(el).imageRendering.toLowerCase().trim();
        if (
          VALID_IR.has(ir) &&
          (TIGHT_SPRITE_STAGE_RE.test(normId) ||
            (!NON_SPRITE_CHART_RE.test(normId) && !isInsideNonSpriteChart(el)))
        ) {
          spriteSet.add(el);
          continue;
        }
      }

      if (!hasAttr && !SPRITE_HINT_RE.test(normId)) continue;
      if (
        !hasAttr &&
        !TIGHT_SPRITE_STAGE_RE.test(normId) &&
        (NON_SPRITE_CHART_RE.test(normId) || isInsideNonSpriteChart(el))
      ) {
        continue;
      }

      if (tag === 'canvas' || tag === 'img') {
        spriteSet.add(el);
        continue;
      }

      if (!hasAttr && !TIGHT_SPRITE_STAGE_RE.test(normId)) {
        continue;
      }

      const descendants = Array.from(el.querySelectorAll('canvas, img')).filter((d) => {
        if (isVectorSvgImg(d)) return false;
        const dNorm = getNormalizedIdentity(d);
        return (
          !NON_SPRITE_CHART_RE.test(dNorm) &&
          !isInsideNonSpriteChart(d) &&
          isVisible(d).ok
        );
      });

      if (descendants.length > 0) {
        for (const d of descendants) spriteSet.add(d);
        continue;
      }

      const bgDescendants = Array.from(el.querySelectorAll('*')).filter(
        (d) =>
          window.getComputedStyle(d).backgroundImage.includes('url(') &&
          !isInsideNonSpriteChart(d) &&
          isVisible(d).ok,
      );
      if (bgDescendants.length > 0) {
        for (const d of bgDescendants) spriteSet.add(d);
        continue;
      }

      if (window.getComputedStyle(el).backgroundImage.includes('url(')) {
        spriteSet.add(el);
      }
    }

    let spriteCount = 0;
    const violations: Array<{ tag: string; imageRendering: string }> = [];
    const isIntZoom = (s: number): boolean => s >= 0.98 && Math.abs(s - Math.round(s)) <= 0.05;

    for (const el of Array.from(spriteSet)) {
      const { ok, rect } = isVisible(el);
      if (!ok) continue;

      spriteCount += 1;
      const tag = el.tagName.toLowerCase();
      const ir = window.getComputedStyle(el).imageRendering.toLowerCase().trim();
      const irOk = VALID_IR.has(ir);

      let scaleErr: string | null = null;
      const explicitScale =
        el.getAttribute('data-sprite-scale') ||
        el.getAttribute('data-scale') ||
        el.parentElement?.getAttribute('data-sprite-scale') ||
        el.parentElement?.getAttribute('data-scale');

      const explicitFrameW =
        el.getAttribute('data-frame-width') ||
        el.getAttribute('data-frame-w') ||
        el.getAttribute('data-frame-size') ||
        el.parentElement?.getAttribute('data-frame-width') ||
        el.parentElement?.getAttribute('data-frame-w') ||
        el.parentElement?.getAttribute('data-frame-size');

      const explicitFrameH =
        el.getAttribute('data-frame-height') ||
        el.getAttribute('data-frame-h') ||
        el.getAttribute('data-frame-size') ||
        el.parentElement?.getAttribute('data-frame-height') ||
        el.parentElement?.getAttribute('data-frame-h') ||
        el.parentElement?.getAttribute('data-frame-size');

      if (explicitScale) {
        const s = Number.parseFloat(explicitScale);
        if (Number.isNaN(s) || s < 1 || Math.abs(s - Math.round(s)) > 0.05) {
          scaleErr = `non-integer scale=${explicitScale}`;
        }
      } else if (tag === 'canvas') {
        const cw = (el as HTMLCanvasElement).width;
        const ch = (el as HTMLCanvasElement).height;
        const fw = explicitFrameW ? Number.parseFloat(explicitFrameW) : 0;
        const fh = explicitFrameH ? Number.parseFloat(explicitFrameH) : 0;
        const baseW = fw > 0 ? fw : cw;
        const baseH = fh > 0 ? fh : ch;
        if (baseW > 0 && baseH > 0) {
          const sx = rect.width / baseW;
          const sy = rect.height / baseH;
          if (!isIntZoom(sx) || !isIntZoom(sy)) {
            scaleErr =
              Math.abs(sx - sy) <= 0.02
                ? `non-integer canvas zoom=${sx.toFixed(2)}x`
                : `non-integer canvas zoom=${sx.toFixed(2)}x/${sy.toFixed(2)}x`;
          }
        } else if (baseW > 0) {
          const sx = rect.width / baseW;
          if (!isIntZoom(sx)) {
            scaleErr = `non-integer canvas zoom=${sx.toFixed(2)}x`;
          }
        }
      } else if (tag === 'img') {
        const img = el as HTMLImageElement;
        const fw = explicitFrameW ? Number.parseFloat(explicitFrameW) : 0;
        const fh = explicitFrameH ? Number.parseFloat(explicitFrameH) : 0;
        if (fw > 0 || fh > 0) {
          const sx = fw > 0 ? rect.width / fw : null;
          const sy =
            fh > 0
              ? rect.height / fh
              : img.complete && img.naturalHeight > 0 && rect.height >= img.naturalHeight * 0.98
                ? rect.height / img.naturalHeight
                : null;
          const badX = sx !== null && !isIntZoom(sx);
          const badY = sy !== null && !isIntZoom(sy);
          if (badX || badY) {
            if (sx !== null && sy !== null && Math.abs(sx - sy) > 0.02) {
              scaleErr = `non-integer img zoom=${sx.toFixed(2)}x/${sy.toFixed(2)}x`;
            } else {
              const badVal = badX && sx !== null ? sx : (sy as number);
              scaleErr = `non-integer img zoom=${badVal.toFixed(2)}x`;
            }
          }
        } else if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const nw = img.naturalWidth;
          const nh = img.naturalHeight;
          const sx = rect.width / nw;
          const sy = rect.height / nh;
          const checkY = rect.height >= nh * 0.98;
          const aspectMatches = Math.abs(rect.width / rect.height - nw / nh) <= 0.08;
          const checkX = aspectMatches || rect.width >= nw * 0.98;
          const badX = checkX && !isIntZoom(sx);
          const badY = checkY && !isIntZoom(sy);
          if (badX || badY) {
            scaleErr =
              checkX && checkY && Math.abs(sx - sy) > 0.02
                ? `non-integer img zoom=${sx.toFixed(2)}x/${sy.toFixed(2)}x`
                : `non-integer img zoom=${(badX ? sx : sy).toFixed(2)}x`;
          }
        }
      } else if (explicitFrameW || explicitFrameH) {
        const fw = explicitFrameW ? Number.parseFloat(explicitFrameW) : 0;
        const fh = explicitFrameH ? Number.parseFloat(explicitFrameH) : 0;
        const sx = fw > 0 ? rect.width / fw : null;
        const sy = fh > 0 ? rect.height / fh : null;
        if ((sx !== null && !isIntZoom(sx)) || (sy !== null && !isIntZoom(sy))) {
          const badVal = sx !== null && !isIntZoom(sx) ? sx : (sy as number);
          scaleErr = `non-integer zoom=${badVal.toFixed(2)}x`;
        }
      }

      if (!irOk) {
        violations.push({ tag, imageRendering: ir });
      } else if (scaleErr) {
        violations.push({ tag, imageRendering: `${ir} (${scaleErr})` });
      }
    }

    return { spriteCount, violations };
  });
}

export async function auditApertureLogo(page: Page): Promise<ApertureLogoAuditResult> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const parseColor = (
      val: string | null | undefined,
    ): { r: number; g: number; b: number; a: number } | null => {
      if (!ctx || !val) return null;
      const trimmed = val.trim();
      if (!trimmed) return null;
      const lower = trimmed.toLowerCase();
      if (
        lower === 'none' ||
        lower === 'transparent' ||
        lower === 'inherit' ||
        lower === 'initial' ||
        lower === 'unset' ||
        lower === 'currentcolor'
      ) {
        return null;
      }
      if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
        if (!CSS.supports('color', trimmed)) return null;
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = trimmed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a === 0) return null;
      return { r, g, b, a };
    };

    const rgbNear = (
      c: { r: number; g: number; b: number },
      target: [number, number, number],
      tol: number,
    ): boolean =>
      Math.abs(c.r - target[0]) <= tol &&
      Math.abs(c.g - target[1]) <= tol &&
      Math.abs(c.b - target[2]) <= tol;

    const svgs = Array.from(document.querySelectorAll('svg')).filter((svg) => {
      const cs = window.getComputedStyle(svg);
      const rect = svg.getBoundingClientRect();
      return (
        cs.display !== 'none' &&
        cs.visibility !== 'hidden' &&
        rect.width >= 14 &&
        rect.height >= 14
      );
    });

    interface CandidateResult {
      score: number;
      explicitHint: boolean;
      roleLayerCount: number;
      hasOrangeGear: boolean;
      hasShutterBlades: boolean;
      hasStatusIris: boolean;
    }

    let best: CandidateResult | null = null;

    for (const svg of svgs) {
      let hasGunmetal = false;
      let hasTurbineGrey = false;
      let hasOrangeGear = false;
      let hasStatusIris = false;
      let starkBladeElementCount = 0;
      let compoundStarkBlade = false;

      const nodes = Array.from(
        svg.querySelectorAll('g, path, circle, ellipse, rect, polygon, polyline, line, use'),
      );

      for (const node of nodes) {
        const cs = window.getComputedStyle(node);
        const colors = [
          parseColor((cs as any).fill),
          parseColor((cs as any).stroke),
          parseColor(node.getAttribute('fill')),
          parseColor(node.getAttribute('stroke')),
        ].filter((x): x is { r: number; g: number; b: number; a: number } => Boolean(x));

        let nodeHasStarkWhite = false;
        for (const c of colors) {
          const maxCh = Math.max(c.r, c.g, c.b);
          const minCh = Math.min(c.r, c.g, c.b);
          const spread = maxCh - minCh;

          if (maxCh >= 28 && maxCh <= 82 && spread <= 28) {
            hasGunmetal = true;
          }
          if (maxCh >= 95 && maxCh <= 185 && spread <= 30) {
            hasTurbineGrey = true;
          }
          if (rgbNear(c, [248, 124, 24], 12) || rgbNear(c, [235, 69, 17], 10)) {
            hasOrangeGear = true;
          }
          if (
            rgbNear(c, [168, 240, 64], 15) ||
            rgbNear(c, [244, 246, 194], 12) ||
            rgbNear(c, [245, 158, 11], 15)
          ) {
            hasStatusIris = true;
          }
          if (c.r >= 225 && c.g >= 225 && c.b >= 220) {
            nodeHasStarkWhite = true;
          }
        }

        const nTag = node.tagName.toLowerCase();
        if (
          nodeHasStarkWhite &&
          (nTag === 'polygon' ||
            nTag === 'path' ||
            nTag === 'rect' ||
            nTag === 'line' ||
            nTag === 'polyline' ||
            nTag === 'use')
        ) {
          starkBladeElementCount += 1;
          if (nTag === 'path') {
            const d = node.getAttribute('d') || '';
            const moveCount = (d.match(/[Mm]/g) || []).length;
            const segCount = (d.match(/[LlCcAa]/g) || []).length;
            if (moveCount >= 6 || segCount >= 16) {
              compoundStarkBlade = true;
            }
          }
        }
      }

      const hasShutterBlades = starkBladeElementCount >= 6 || compoundStarkBlade;
      const roleLayerCount = [
        hasGunmetal,
        hasTurbineGrey,
        hasOrangeGear,
        hasShutterBlades,
        hasStatusIris,
      ].filter(Boolean).length;

      const hintStr = [
        svg.id || '',
        svg.getAttribute('class') || '',
        svg.getAttribute('data-testid') || '',
        svg.getAttribute('aria-label') || '',
        svg.parentElement?.id || '',
        svg.parentElement?.getAttribute('class') || '',
        svg.parentElement?.getAttribute('data-testid') || '',
        svg.parentElement?.getAttribute('aria-label') || '',
      ].join(' ');

      const normHintStr = hintStr
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[_./\\:-]+/g, ' ');

      const explicitHint =
        svg.hasAttribute('data-fui-aperture') ||
        Boolean(svg.closest('[data-fui-aperture]')) ||
        /\b(aperture|system logo|brand logo|hermes logo)\b/.test(normHintStr);

      const inHeaderOrNav = Boolean(svg.closest('header, nav, [role="banner"], [role="navigation"]'));

      if (!explicitHint && roleLayerCount < 2) {
        continue;
      }

      const score = roleLayerCount + (explicitHint ? 10 : 0) + (inHeaderOrNav ? 2 : 0);
      if (!best || score > best.score) {
        best = {
          score,
          explicitHint,
          roleLayerCount,
          hasOrangeGear,
          hasShutterBlades,
          hasStatusIris,
        };
      }
    }

    if (!best) {
      return {
        found: false,
        svgLayerCount: 0,
        hasOrangeGear: false,
        hasShutterBlades: false,
        hasStatusIris: false,
      };
    }

    return {
      found: true,
      svgLayerCount: best.roleLayerCount,
      hasOrangeGear: best.hasOrangeGear,
      hasShutterBlades: best.hasShutterBlades,
      hasStatusIris: best.hasStatusIris,
    };
  });
}

export async function auditOrthogonalBlueprintCorridors(
  page: Page,
): Promise<BlueprintCorridorsAuditResult> {
  return page.evaluate(() => {
    const normalizeHint = (raw: string): string =>
      raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[_./\\:-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const HUD_RING_RE =
      /\b(aperture|system logo|orbital boot|astrolabes?|thinking orbs?|geodesic|radar reticles?|reticles?|hud loaders?|modular hud|donut gauges?|hatched donuts?|fui rings?|hud rings?|orbital rings?)\b/;

    const matchesHudRingHint = (svg: SVGSVGElement): boolean => {
      const hint = normalizeHint(
        [
          svg.id || '',
          svg.getAttribute('class') || '',
          svg.getAttribute('data-testid') || '',
          svg.getAttribute('aria-label') || '',
          svg.parentElement?.id || '',
          svg.parentElement?.getAttribute('class') || '',
          svg.parentElement?.getAttribute('data-testid') || '',
        ].join(' '),
      );
      return HUD_RING_RE.test(hint);
    };

    const isBlueprintCanvasSvg = (svg: SVGSVGElement): boolean => {
      if (
        svg.closest(
          'header, nav, footer, button, a[href], [data-fui-aperture], [data-fui-ring], [data-fui-orb], [data-fui-icon], [data-fui-beacon]',
        )
      ) {
        return false;
      }
      if (matchesHudRingHint(svg)) return false;
      const cs = window.getComputedStyle(svg);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        cs.visibility === 'collapse' ||
        Number.parseFloat(cs.opacity || '1') <= 0.01
      ) {
        return false;
      }
      const rect = svg.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 80;
    };

    const explicitSvgs = Array.from(
      document.querySelectorAll(
        'svg[data-fui-blueprint], [data-fui-blueprint] svg, svg[data-testid*="blueprint" i], [data-testid*="blueprint" i] svg, svg[class*="blueprint" i], [class*="blueprint" i] svg, svg[id*="blueprint" i], [id*="blueprint" i] svg',
      ),
    );

    let blueprintSvgs: SVGSVGElement[] = explicitSvgs
      .filter((el): el is SVGSVGElement => el.tagName.toLowerCase() === 'svg')
      .filter(isBlueprintCanvasSvg);

    if (blueprintSvgs.length === 0) {
      blueprintSvgs = Array.from(document.querySelectorAll('svg')).filter(isBlueprintCanvasSvg);
    }

    const uniqueSvgs = Array.from(new Set(blueprintSvgs));
    let segmentCount = 0;
    const diagonalOrCurvedViolations: string[] = [];
    const EPS = 0.5;

    const isNonNonePaint = (val: string | null | undefined): boolean => {
      if (!val) return false;
      const lower = val.trim().toLowerCase();
      return lower !== '' && lower !== 'none' && lower !== 'transparent' && lower !== 'rgba(0, 0, 0, 0)';
    };

    const checkSegment = (
      kind: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ): void => {
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      if (dx <= 0.01 && dy <= 0.01) return;
      segmentCount += 1;
      if (dx > EPS && dy > EPS) {
        diagonalOrCurvedViolations.push(
          `<${kind}> diagonal (${x1.toFixed(1)},${y1.toFixed(1)})->(${x2.toFixed(1)},${y2.toFixed(1)})`,
        );
      }
    };

    const CURVE_ARITIES: Record<string, number> = {
      C: 6,
      c: 6,
      S: 4,
      s: 4,
      Q: 4,
      q: 4,
      T: 2,
      t: 2,
      A: 7,
      a: 7,
    };

    for (const svg of uniqueSvgs) {
      const shapes = Array.from(svg.querySelectorAll('path, polyline, line'));
      for (const el of shapes) {
        if (el.closest('svg') !== svg) continue;
        if (
          el.closest(
            'defs, pattern, marker, clipPath, mask, symbol, button, a[href], foreignObject, [data-fui-beacon], [data-fui-icon], [data-fui-ring]',
          )
        ) {
          continue;
        }

        const cs = window.getComputedStyle(el);
        if (
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          Number.parseFloat(cs.opacity || '1') <= 0.01
        ) {
          continue;
        }

        const elRect = el.getBoundingClientRect();
        if (elRect.width <= 0 && elRect.height <= 0) {
          continue;
        }

        const tag = el.tagName.toLowerCase();
        try {
          const bbox = (el as SVGGraphicsElement).getBBox();
          const hasStroke = isNonNonePaint((cs as any).stroke) || isNonNonePaint(el.getAttribute('stroke'));
          const hasFill = isNonNonePaint((cs as any).fill) || isNonNonePaint(el.getAttribute('fill'));
          const dAttr = el.getAttribute('d') || '';
          const isCurveFreeShape =
            tag === 'polyline' || tag === 'line' || (tag === 'path' && !/[CcSsQqTtAa]/.test(dAttr));
          if (bbox.width <= 16 && bbox.height <= 16 && (!hasStroke || isCurveFreeShape)) {
            continue;
          }
          if (
            Math.max(bbox.width, bbox.height) <= 24 &&
            el.closest(
              '[class*="icon" i], [class*="beacon" i], [data-testid*="icon" i], [data-testid*="beacon" i]',
            )
          ) {
            continue;
          }
          if (
            tag === 'path' &&
            /[Zz]\s*$/.test(dAttr) &&
            hasFill &&
            Math.max(bbox.width, bbox.height) <= 28 &&
            Math.abs(bbox.width - bbox.height) <= 3
          ) {
            continue;
          }
        } catch {
          // Ignore getBBox errors on detached/zero elements
        }
        if (tag === 'line') {
          const x1 = Number.parseFloat(el.getAttribute('x1') || '0') || 0;
          const y1 = Number.parseFloat(el.getAttribute('y1') || '0') || 0;
          const x2 = Number.parseFloat(el.getAttribute('x2') || '0') || 0;
          const y2 = Number.parseFloat(el.getAttribute('y2') || '0') || 0;
          checkSegment('line', x1, y1, x2, y2);
          continue;
        }

        if (tag === 'polyline') {
          const ptsRaw = el.getAttribute('points') || '';
          const nums = (
            ptsRaw.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []
          ).map(Number);
          for (let i = 2; i + 1 < nums.length; i += 2) {
            checkSegment('polyline', nums[i - 2], nums[i - 1], nums[i], nums[i + 1]);
          }
          continue;
        }

        if (tag === 'path') {
          const d = el.getAttribute('d') || '';
          const tokens =
            d.match(/[MmLlHhVvZzCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
          let cx = 0;
          let cy = 0;
          let sx = 0;
          let sy = 0;
          let cmd = '';
          let i = 0;

          const isCommand = (t: string): boolean => /^[A-Za-z]$/.test(t);

          while (i < tokens.length) {
            if (isCommand(tokens[i])) {
              cmd = tokens[i];
              i += 1;
              if (cmd === 'Z' || cmd === 'z') {
                checkSegment('path', cx, cy, sx, sy);
                cx = sx;
                cy = sy;
                cmd = '';
                continue;
              }
            }

            if (!cmd) {
              i += 1;
              continue;
            }

            if (cmd === 'M' || cmd === 'm') {
              if (i + 2 > tokens.length || isCommand(tokens[i]) || isCommand(tokens[i + 1])) {
                break;
              }
              const x = Number(tokens[i]);
              const y = Number(tokens[i + 1]);
              cx = cmd === 'm' ? cx + x : x;
              cy = cmd === 'm' ? cy + y : y;
              sx = cx;
              sy = cy;
              i += 2;
              cmd = cmd === 'm' ? 'l' : 'L';
            } else if (cmd === 'L' || cmd === 'l') {
              if (i + 2 > tokens.length || isCommand(tokens[i]) || isCommand(tokens[i + 1])) {
                break;
              }
              const x = Number(tokens[i]);
              const y = Number(tokens[i + 1]);
              const nx = cmd === 'l' ? cx + x : x;
              const ny = cmd === 'l' ? cy + y : y;
              checkSegment('path', cx, cy, nx, ny);
              cx = nx;
              cy = ny;
              i += 2;
            } else if (cmd === 'H' || cmd === 'h') {
              if (i + 1 > tokens.length || isCommand(tokens[i])) {
                break;
              }
              const x = Number(tokens[i]);
              const nx = cmd === 'h' ? cx + x : x;
              if (Math.abs(nx - cx) > 0.01) {
                segmentCount += 1;
              }
              cx = nx;
              i += 1;
            } else if (cmd === 'V' || cmd === 'v') {
              if (i + 1 > tokens.length || isCommand(tokens[i])) {
                break;
              }
              const y = Number(tokens[i]);
              const ny = cmd === 'v' ? cy + y : y;
              if (Math.abs(ny - cy) > 0.01) {
                segmentCount += 1;
              }
              cy = ny;
              i += 1;
            } else if (cmd in CURVE_ARITIES) {
              const arity = CURVE_ARITIES[cmd];
              if (i + arity > tokens.length) {
                segmentCount += 1;
                diagonalOrCurvedViolations.push(
                  `<path> forbidden curve '${cmd}' in d="${d.slice(0, 80)}"`,
                );
                break;
              }
              const args = tokens.slice(i, i + arity).map(Number);
              segmentCount += 1;
              diagonalOrCurvedViolations.push(
                `<path> forbidden curve '${cmd}' in d="${d.slice(0, 80)}"`,
              );
              const endX = args[arity - 2];
              const endY = args[arity - 1];
              const isRel = cmd === cmd.toLowerCase();
              cx = isRel ? cx + endX : endX;
              cy = isRel ? cy + endY : endY;
              i += arity;
            } else {
              i += 1;
            }
          }
        }
      }
    }

    return { segmentCount, diagonalOrCurvedViolations };
  });
}

const SHUTTER_8_BLADES_SVG = Array.from({ length: 8 }, (_, k) => {
  const a = (k * 45 * Math.PI) / 180;
  const x1 = (50 + 14 * Math.cos(a)).toFixed(1);
  const y1 = (50 + 14 * Math.sin(a)).toFixed(1);
  const x2 = (50 + 24 * Math.cos(a + 0.35)).toFixed(1);
  const y2 = (50 + 24 * Math.sin(a + 0.35)).toFixed(1);
  const x3 = (50 + 24 * Math.cos(a + 0.72)).toFixed(1);
  const y3 = (50 + 24 * Math.sin(a + 0.72)).toFixed(1);
  return `<polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" fill="#F6F6F4" stroke="#08080B" stroke-width="0.6" />`;
}).join('');

export const FUI_COMPLIANT_SELF_TEST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>HERMES // OS — FUI Compliant Self-Test</title>
<style>
  :root {
    --fui-bg-carbon: #08080B;
    --fui-bg-panel: #13151A;
    --fui-border-hairline: #262830;
    --fui-accent-orange: #F87C18;
    --fui-accent-vermilion: #EB4511;
    --fui-accent-amber: #F59E0B;
    --fui-accent-cyan: #2CE5F2;
    --fui-accent-phosphor: #A8F040;
    --fui-ink-stark: #F6F6F4;
  }
  *, *::before, *::after { box-sizing: border-box; border-radius: 0px; }
  body {
    margin: 0;
    background: var(--fui-bg-carbon);
    color: var(--fui-ink-stark);
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
  }
  #boot-gate {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #060709;
    color: #F87C18;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--fui-bg-panel);
    border-bottom: 3px solid var(--fui-accent-orange);
  }
  nav { display: flex; gap: 8px; }
  nav a, button, input, select, textarea {
    font-family: inherit;
    font-size: 12px;
    color: var(--fui-ink-stark);
    background: var(--fui-bg-panel);
    border: 1px solid var(--fui-border-hairline);
    padding: 4px 10px;
    text-decoration: none;
  }
  .fui-card {
    background: var(--fui-bg-panel);
    border: 1px solid var(--fui-border-hairline);
    border-top: 4px solid var(--fui-accent-orange);
    padding: 12px;
    margin-bottom: 12px;
  }
  .hud-ring {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    border: 1px dashed var(--fui-accent-cyan);
    background: transparent;
    transform: rotateX(60deg);
  }
  .donut-gauge {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: conic-gradient(#F6F6F4 0deg 122deg, #262830 122deg 360deg);
  }
  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fui-accent-phosphor);
  }
  .companion-sprite {
    width: 64px;
    height: 64px;
    image-rendering: pixelated;
  }
</style>
</head>
<body>
  <div id="boot-gate" data-fui-boot>[1 // DB_ONLINE]</div>
  <header>
    <svg data-testid="system-aperture-logo" width="40" height="40" viewBox="0 0 100 100" aria-label="HERMES // OS Aperture Logo">
      <g data-layer="reticle"><circle cx="50" cy="50" r="46" fill="none" stroke="#2A323B" stroke-width="3" stroke-dasharray="18 6" /></g>
      <g data-layer="turbine"><circle cx="50" cy="50" r="39" fill="none" stroke="#8A96A3" stroke-width="4" stroke-dasharray="3 4" /></g>
      <g data-layer="gear"><circle cx="50" cy="50" r="31" fill="none" stroke="#F87C18" stroke-width="5" stroke-dasharray="3 2.4" /></g>
      <g data-layer="shutter">${SHUTTER_8_BLADES_SVG}</g>
      <g data-layer="iris">
        <circle cx="50" cy="50" r="10" fill="#A8F040" />
        <circle cx="50" cy="50" r="5" fill="#08080B" />
      </g>
    </svg>
    <strong>HERMES // OS</strong>
    <span class="status-dot"></span>
    <nav>
      <a href="#dashboard">DASHBOARD</a>
      <a href="#goals">GOALS</a>
    </nav>
    <button type="button">[+] DEPLOY_KNIGHT</button>
    <button type="button" role="tab">Q1_OKR</button>
    <button type="button" aria-label="Privacy Mask" style="font-size: 0px; padding: 4px;">
      <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="none" stroke="#F6F6F4" /></svg>
    </button>
  </header>
  <main style="padding: 16px;">
    <section class="fui-card">
      <input type="text" value="Finish Raft lab #courses @deep_work !high tomorrow 90m" aria-label="Quick Capture" />
      <div style="display: flex; gap: 16px; align-items: center; margin-top: 12px;">
        <div data-fui-ring class="hud-ring"></div>
        <div class="donut-gauge"></div>
        <div class="companion-stage" data-companion-stage="frieren">
          <canvas class="companion-sprite" data-sprite="frieren-mini" data-frame-width="32" width="32" height="32"></canvas>
        </div>
        <canvas class="waveform-sparkline" width="180" height="40" style="image-rendering: auto;"></canvas>
      </div>
    </section>
    <svg data-fui-blueprint width="380" height="200" viewBox="0 0 380 200" style="background: #10171D; border: 1px solid #262830;">
      <defs>
        <pattern id="fui-hatch" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M 0 8 L 8 0" stroke="#262830" stroke-width="1" />
        </pattern>
      </defs>
      <rect x="20" y="30" width="80" height="36" fill="#10171D" stroke="#DCE8EE" />
      <circle cx="20" cy="30" r="6" fill="#EB4511" stroke="#F6F6F4" stroke-width="1" />
      <rect x="240" y="120" width="90" height="36" fill="#10171D" stroke="#DCE8EE" />
      <path d="M 100 48 H 170 V 138 H 240" fill="none" stroke="#DCE8EE" stroke-width="1.5" />
      <polyline points="100,60 145,60 145,172 240,172" fill="none" stroke="#DCE8EE" stroke-dasharray="3 3" />
      <line x1="285" y1="156" x2="285" y2="190" stroke="#DCE8EE" stroke-width="1" />
    </svg>
  </main>
  <script>
    const boot = document.getElementById('boot-gate');
    setTimeout(() => { boot.textContent = '[2 // HERMES_GATEWAY]'; }, 35);
    setTimeout(() => { boot.textContent = '[3 // READY]'; }, 70);
    setTimeout(() => { boot.remove(); }, 110);
  </script>
</body>
</html>`;

export const FUI_VIOLATING_SELF_TEST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>FUI Violating Self-Test</title>
<style>
  body { margin: 0; background: #FFFFFF; color: #111827; font-family: sans-serif; }
  .bad-btn { border-radius: 8px; font-size: 10px; padding: 6px 12px; background: #3B82F6; color: #FFFFFF; border: 1px solid #2563EB; }
  .bad-card { border-radius: 12px; padding: 12px; border: 1px solid #CBD5E1; margin: 12px; }
</style>
</head>
<body>
  <header style="padding: 8px 16px; display: flex; gap: 12px; align-items: center;">
    <svg data-testid="system-aperture-logo" width="40" height="40" viewBox="0 0 100 100">
      <g><circle cx="50" cy="50" r="45" fill="none" stroke="#2A323B" stroke-width="3" /></g>
      <g><circle cx="50" cy="50" r="30" fill="none" stroke="#3B82F6" stroke-width="4" /></g>
    </svg>
    <button type="button" class="bad-btn">Rounded 10px Action</button>
  </header>
  <main>
    <div class="bad-card">Rounded non-FUI panel</div>
    <canvas data-sprite="frieren" width="32" height="32" style="width: 64px; height: 64px; image-rendering: auto;"></canvas>
    <svg data-fui-blueprint width="320" height="200" viewBox="0 0 320 200">
      <path d="M 0 0 C 10 20 30 40 50 50" fill="none" stroke="#111827" stroke-width="2" />
      <line x1="60" y1="60" x2="140" y2="110" stroke="#111827" stroke-width="2" />
    </svg>
  </main>
</body>
</html>`;
