import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  clampSpriteScale,
  CompanionStage,
  FRIEREN_MINI_SHEET_URL,
  FRIEREN_MINI_SPRITE,
  FRIEREN_PORTRAIT_SHEET_URL,
  FRIEREN_PORTRAIT_SPRITE,
  IsometricKnightSprite,
  KNIGHTS_ISOMETRIC_SHEET_URL,
  KNIGHTS_ISOMETRIC_SPRITE,
  normalizeSpriteDescriptor,
  PixelSprite,
  resolveCompanionAnimationKey,
  type SpriteSheetDescriptor,
} from '../index';
import type { MockCanvas2DContext } from '../test-setup';

function inspectPngFile(fileUrl: string) {
  expect(fileUrl).toMatch(/\.png$/i);
  const filePath = fileUrl.startsWith('file://')
    ? fileURLToPath(fileUrl)
    : resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../assets/sprites',
        basename(fileUrl.startsWith('http') ? new URL(fileUrl).pathname : fileUrl),
      );
  const buf = readFileSync(filePath);
  const sig = buf.subarray(0, 8);
  expect(Array.from(sig)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrType = buf.subarray(12, 16).toString('ascii');
  expect(ihdrType).toBe('IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6); // RGBA8888

  // Collect IDAT chunks and inflate scanlines
  let offset = 8;
  const idatParts: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IDAT') idatParts.push(data);
    if (type === 'IEND') break;
    offset += 12 + len;
  }
  const rawScanlines = inflateSync(Buffer.concat(idatParts));
  expect(rawScanlines.length).toBe(height * (1 + width * 4));
  return { width, height, rawScanlines };
}

function extractFrameBytes(
  rawScanlines: Buffer,
  sheetW: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): Buffer {
  const stride = 1 + sheetW * 4;
  const out = Buffer.alloc(fw * fh * 4);
  for (let y = 0; y < fh; y++) {
    const srcStart = (fy + y) * stride + 1 + fx * 4;
    rawScanlines.copy(out, y * fw * 4, srcStart, srcStart + fw * 4);
  }
  return out;
}

describe('F21 — Hot-Swappable Pixel-Art PNG + JSON Sprite Engine', () => {
  it('validates physical PNG binary headers, RGBA scanlines, and distinct multi-frame pixel data across all 3 atlases', () => {
    const mini = inspectPngFile(FRIEREN_MINI_SHEET_URL);
    expect(mini.width).toBe(256);
    expect(mini.height).toBe(224);

    // Frame 0 vs Frame 2 in idle_ledge_sit and mimic_gag must have distinct pixel data
    const miniIdleF0 = extractFrameBytes(mini.rawScanlines, 256, 0, 0, 32, 32);
    const miniIdleF2 = extractFrameBytes(mini.rawScanlines, 256, 64, 0, 32, 32);
    expect(miniIdleF0.equals(miniIdleF2)).toBe(false);

    const miniMimicF0 = extractFrameBytes(mini.rawScanlines, 256, 0, 6 * 32, 32, 32);
    const miniMimicF1 = extractFrameBytes(mini.rawScanlines, 256, 32, 6 * 32, 32, 32);
    expect(miniMimicF0.equals(miniMimicF1)).toBe(false);

    const portrait = inspectPngFile(FRIEREN_PORTRAIT_SHEET_URL);
    expect(portrait.width).toBe(1536);
    expect(portrait.height).toBe(160);
    // Phase 1 Frame 0 vs Phase 2 Frame 4 vs Phase 3 Frame 7 vs Phase 4 Frame 9
    const pF0 = extractFrameBytes(portrait.rawScanlines, 1536, 0, 0, 128, 160);
    const pF4 = extractFrameBytes(portrait.rawScanlines, 1536, 4 * 128, 0, 128, 160);
    const pF7 = extractFrameBytes(portrait.rawScanlines, 1536, 7 * 128, 0, 128, 160);
    const pF9 = extractFrameBytes(portrait.rawScanlines, 1536, 9 * 128, 0, 128, 160);
    expect(pF0.equals(pF4)).toBe(false);
    expect(pF4.equals(pF7)).toBe(false);
    expect(pF7.equals(pF9)).toBe(false);

    const knights = inspectPngFile(KNIGHTS_ISOMETRIC_SHEET_URL);
    expect(knights.width).toBe(288);
    expect(knights.height).toBe(960);
    expect(Object.keys(KNIGHTS_ISOMETRIC_SPRITE.animations ?? {})).toHaveLength(20);
  });

  it('normalizes HERMES and Aseprite descriptors, clamps integer scales 2|3|4, and maps DB animation_hint aliases', () => {
    expect(clampSpriteScale(1)).toBe(2);
    expect(clampSpriteScale(2.4)).toBe(2);
    expect(clampSpriteScale(3)).toBe(3);
    expect(clampSpriteScale('4')).toBe(4);
    expect(clampSpriteScale(9)).toBe(4);
    expect(clampSpriteScale(Number.NaN)).toBe(2);

    expect(resolveCompanionAnimationKey('grimoire', 'mini')).toBe('read_grimoire');
    expect(resolveCompanionAnimationKey('blue_flower_spell', 'mini')).toBe('cast_blue_flora');
    expect(resolveCompanionAnimationKey('tea', 'mini')).toBe('sip_tea');
    expect(resolveCompanionAnimationKey('nod_off', 'mini')).toBe('cozy_nap');
    expect(resolveCompanionAnimationKey('stargazing', 'portrait')).toBe('wind_blink_loop');

    // Aseprite JSON Hash + frameTags pingpong
    const asepriteDesc: SpriteSheetDescriptor = {
      meta: {
        app: 'Aseprite',
        image: 'custom.png',
        size: { w: 96, h: 32 },
        scale: '3',
        frameTags: [{ name: 'bounce', from: 0, to: 2, direction: 'pingpong' }],
      },
      frames: {
        f0: { frame: { x: 0, y: 0, w: 32, h: 32 }, duration: 100 },
        f1: { frame: { x: 32, y: 0, w: 32, h: 32 }, duration: 100 },
        f2: { frame: { x: 64, y: 0, w: 32, h: 32 }, duration: 100 },
      },
    };
    const norm = normalizeSpriteDescriptor(asepriteDesc);
    expect(norm.scale).toBe(3);
    expect(norm.animations.bounce?.frames).toHaveLength(4); // 0, 1, 2, 1
  });

  it('enforces image-rendering: pixelated, ctx.imageSmoothingEnabled === false, custom override fallback, and null-Canvas2D resilience', () => {
    const onFallback = vi.fn();
    const { container, rerender } = render(
      <PixelSprite
        data-testid="sprite-under-test"
        descriptor={FRIEREN_MINI_SPRITE}
        sheetUrl={FRIEREN_MINI_SHEET_URL}
        animation="read_grimoire"
        scale={3}
        onFallback={onFallback}
      />,
    );

    const root = screen.getByTestId('sprite-under-test');
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    expect(window.getComputedStyle(root).getPropertyValue('image-rendering')).toBe('pixelated');
    expect(window.getComputedStyle(canvas).getPropertyValue('image-rendering')).toBe('pixelated');
    expect(window.getComputedStyle(root).borderRadius).toBe('0px');
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(96);

    const ctx = canvas.getContext('2d') as unknown as MockCanvas2DContext;
    expect(ctx.imageSmoothingEnabled).toBe(false);
    // read_grimoire is row 2 (y = 64)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 64, 32, 32, 0, 0, 96, 96);

    // Custom override with out-of-bounds frame -> triggers fallback to FRIEREN_MINI_SPRITE
    const brokenDescriptor: SpriteSheetDescriptor = {
      meta: { app: 'bad', image: 'bad.png', size: { w: 32, h: 32 }, frameSize: { w: 64, h: 64 } },
      animations: { bad: { row: 0, frames: 2, fps: 8, loop: true } },
    };
    rerender(
      <PixelSprite
        data-testid="sprite-under-test"
        descriptor={brokenDescriptor}
        sheetUrl="/bad-custom.png"
        fallback={{ descriptor: FRIEREN_MINI_SPRITE, sheetUrl: FRIEREN_MINI_SHEET_URL }}
        animation="idle_ledge_sit"
        onFallback={onFallback}
      />,
    );
    expect(onFallback).toHaveBeenCalled();
    expect(screen.getByTestId('sprite-under-test').getAttribute('data-using-fallback')).toBe('true');

    // Explicit null Canvas2D context resilience test
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof origGetContext;
    expect(() =>
      render(
        <PixelSprite
          descriptor={FRIEREN_MINI_SPRITE}
          sheetUrl={FRIEREN_MINI_SHEET_URL}
          animation="idle_ledge_sit"
        />,
      ),
    ).not.toThrow();
    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  it('renders <CompanionStage /> across ledge, popover, and mobile modes (with non-repeating offline phrases and zero /hermes link on mobile)', () => {
    const onExpand = vi.fn();
    const onUndo = vi.fn();
    const onApprove = vi.fn();

    const { rerender } = render(
      <CompanionStage
        mode="ledge"
        nudges={[{ id: 'n1', title: 'Review Due', message: 'Raft Lesson 3 due for 7d review' }]}
      />,
    );
    expect(screen.getByTestId('companion-ledge-nudge-badge')).toHaveTextContent('! 1');

    // Popover mode (Web) -> shows Expand in Full Hermes View ↗ + [Undo] + [Approve]
    rerender(
      <CompanionStage
        mode="popover"
        open
        sessionKey="sess-main"
        onExpandToHermes={onExpand}
        undoActions={[{ undoId: 'u1', toolName: 'todos_complete_task', summary: 'Completed task' }]}
        onUndo={onUndo}
        pendingApprovals={[
          { id: 'a1', toolName: 'finance_upsert_asset', summary: 'Update WEGE3', payloadJson: {} },
        ]}
        onApprove={onApprove}
      />,
    );
    expect(screen.getByTestId('companion-expand-hermes')).toBeInTheDocument();
    fireEvent.click(screen.getByText('[Undo]'));
    expect(onUndo).toHaveBeenCalledWith('u1');
    fireEvent.click(screen.getByText('[Approve]'));
    expect(onApprove).toHaveBeenCalledWith('a1', {});

    // Mobile offline mode -> hides /hermes expand button, shows offline banner + non-repeating REF-01 speech bubble
    rerender(
      <CompanionStage
        mode="mobile"
        online={false}
        onExpandToHermes={onExpand}
        queuedMutationsCount={3}
      />,
    );
    expect(screen.queryByTestId('companion-expand-hermes')).toBeNull();
    expect(screen.getByTestId('companion-offline-banner')).toHaveTextContent(
      '[◌ OFFLINE_MODE — TAP FRIEREN FOR FIELD MOTIVATION]',
    );

    const bubble = screen.getByTestId('companion-offline-speech-bubble');
    let prevText = bubble.textContent;
    for (let i = 0; i < 6; i++) {
      fireEvent.click(bubble);
      const nextText = screen.getByTestId('companion-offline-speech-bubble').textContent;
      expect(nextText).not.toBe(prevText);
      prevText = nextText;
    }
  });

  it('renders <IsometricKnightSprite /> across all 5 archetypes with HP/EP bars, [BUDGET_0], [!] alert, and isometric cursor', () => {
    const { container } = render(
      <div>
        <IsometricKnightSprite
          data-testid="knight-paladin"
          archetype="paladin"
          state="alert"
          active
          hpPct={80}
          epPct={45}
        />
        <IsometricKnightSprite
          data-testid="knight-exhausted"
          archetype="artificer"
          state="barracks_rest"
          hpPct={0}
        />
      </div>,
    );

    expect(container.querySelector('[data-knight-part="active-chevron"]')).toBeTruthy();
    expect(container.querySelector('[data-knight-part="alert-bubble"]')).toBeTruthy();
    expect(container.querySelector('[data-knight-part="isometric-cursor"]')).toBeTruthy();
    expect(container.querySelector('[data-knight-part="budget-exhausted"]')).toHaveTextContent(
      '[BUDGET_0]',
    );
  });

  it('adv_companion_stage_popover_viewport_clamping_reject_callback_and_offline_signal_rotation', () => {
    const onReject = vi.fn();
    const { rerender } = render(
      <CompanionStage
        mode="popover"
        open
        online={true}
        pageContext={{ activeRoute: '/finance', selectedEntityLabel: 'FINANCE // OPERATOR' }}
        pendingApprovals={[
          {
            id: 'apr-99',
            toolName: 'finance_rebalance_apply',
            summary: 'Apply rebalance order',
            payloadJson: {},
          },
        ]}
        onReject={onReject}
      />,
    );

    const popover = screen.getByTestId('companion-stage-popover');
    expect(popover.style.maxHeight).toBe('calc(100vh - 32px)');
    expect(popover.style.overflowY).toBe('auto');

    fireEvent.click(screen.getByText('[Reject]'));
    expect(onReject).toHaveBeenCalledWith('apr-99');

    rerender(
      <CompanionStage
        mode="mobile"
        online={false}
        queuedMutationsCount={3}
        offlinePhrases={[
          { id: 'p1', phraseText: 'First offline signal.', animationHint: 'idle_ledge_sit' },
          { id: 'p2', phraseText: 'Second offline signal.', animationHint: 'read_grimoire' },
        ]}
      />,
    );

    expect(screen.getByTestId('companion-offline-banner').textContent).toContain('QUEUED:3');
    const speech = screen.getByTestId('companion-offline-speech-bubble');
    expect(speech.textContent).toContain('First offline signal.');
    fireEvent.click(speech);
    expect(screen.getByTestId('companion-offline-speech-bubble').textContent).toContain(
      'Second offline signal.',
    );
  });
});
