import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import {
  clampSpriteScale,
  FRIEREN_MINI_SHEET_URL,
  FRIEREN_MINI_SPRITE,
  normalizeSpriteDescriptor,
} from './registry';
import type { PixelSpriteProps } from './types';

export function PixelSprite({
  descriptor,
  sheetUrl,
  fallback,
  animation,
  scale,
  paused = false,
  flipX = false,
  alt = 'Pixel Sprite',
  className,
  style,
  onAnimationComplete,
  onFallback,
  onClick,
  'data-testid': dataTestId,
}: PixelSpriteProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [usingFallbackSheet, setUsingFallbackSheet] = useState<boolean>(false);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;

  const fallbackDescriptor = fallback?.descriptor ?? FRIEREN_MINI_SPRITE;
  const fallbackUrl = fallback?.sheetUrl ?? FRIEREN_MINI_SHEET_URL;

  const normalized = useMemo(() => {
    let invalidReason: string | null = null;
    const activeDesc = usingFallbackSheet ? fallbackDescriptor : descriptor;
    const sheet = normalizeSpriteDescriptor(activeDesc, fallbackDescriptor, (reason) => {
      invalidReason = reason;
    });
    return { sheet, invalidReason };
  }, [descriptor, fallbackDescriptor, usingFallbackSheet]);

  useEffect(() => {
    if (normalized.invalidReason && !usingFallbackSheet) {
      setUsingFallbackSheet(true);
      onFallbackRef.current?.(normalized.invalidReason);
    }
  }, [normalized.invalidReason, usingFallbackSheet]);

  useEffect(() => {
    setUsingFallbackSheet(false);
    setFrameIndex(0);
  }, [descriptor, sheetUrl]);

  const { sheet } = normalized;
  const activeUrl = usingFallbackSheet || normalized.invalidReason ? fallbackUrl : sheetUrl;
  const intScale = clampSpriteScale(scale ?? sheet.scale);

  const activeAnim =
    sheet.animations[animation] ??
    sheet.animations[sheet.defaultAnimation] ??
    Object.values(sheet.animations)[0]!;

  const safeFrameIndex = activeAnim.frames.length > 0 ? frameIndex % activeAnim.frames.length : 0;
  const currentFrame = activeAnim.frames[safeFrameIndex] ?? {
    x: 0,
    y: 0,
    w: sheet.frameSize.w,
    h: sheet.frameSize.h,
    durationMs: 125,
  };

  // Reset frame index when animation changes
  useEffect(() => {
    setFrameIndex(0);
  }, [activeAnim.name]);

  // Frame advancement timer
  useEffect(() => {
    if (paused || prefersReducedMotion || activeAnim.frames.length <= 1) {
      return undefined;
    }
    const duration = Math.max(16, currentFrame.durationMs || Math.round(1000 / activeAnim.fps));
    const timer = setTimeout(() => {
      setFrameIndex((prev) => {
        const next = prev + 1;
        if (next >= activeAnim.frames.length) {
          if (activeAnim.loop) {
            return 0;
          }
          onAnimationComplete?.(activeAnim.name);
          return activeAnim.frames.length - 1;
        }
        return next;
      });
    }, duration);
    return () => clearTimeout(timer);
  }, [
    paused,
    prefersReducedMotion,
    activeAnim.name,
    activeAnim.loop,
    activeAnim.fps,
    activeAnim.frames.length,
    currentFrame.durationMs,
    safeFrameIndex,
    onAnimationComplete,
  ]);

  const drawWidth = currentFrame.w * intScale;
  const drawHeight = currentFrame.h * intScale;

  // Draw current frame onto Canvas2D with strict nearest-neighbor (imageSmoothingEnabled = false)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    // Crucial: setting canvas width/height resets imageSmoothingEnabled in browsers, so always set false right after!
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect?.(0, 0, drawWidth, drawHeight);

    const source = imgRef.current ?? canvas;
    try {
      ctx.drawImage(
        source,
        currentFrame.x,
        currentFrame.y,
        currentFrame.w,
        currentFrame.h,
        0,
        0,
        drawWidth,
        drawHeight,
      );
    } catch {
      // Safe fallback when image is still decoding in browser
    }
  }, [activeUrl, currentFrame.x, currentFrame.y, currentFrame.w, currentFrame.h, drawWidth, drawHeight]);

  return (
    <span
      role="img"
      aria-label={alt}
      data-testid={dataTestId}
      data-fui="pixel-sprite"
      data-animation={activeAnim.name}
      data-frame-index={safeFrameIndex}
      data-scale={intScale}
      data-sheet-url={activeUrl}
      data-using-fallback={usingFallbackSheet || Boolean(normalized.invalidReason) ? 'true' : 'false'}
      onClick={onClick}
      className={`fui-pixelated ${className ?? ''}`.trim()}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: `${drawWidth}px`,
        height: `${drawHeight}px`,
        lineHeight: 0,
        imageRendering: 'pixelated',
        transform: flipX ? 'scaleX(-1)' : undefined,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
        borderRadius: '0px',
      }}
    >
      {/* Crisp CSS pixelated sprite-strip backdrop for instant 0ms & jsdom rendering */}
      <span
        aria-hidden="true"
        data-sprite-fallback="css-strip"
        className="fui-pixelated"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          width: `${drawWidth}px`,
          height: `${drawHeight}px`,
          backgroundImage: `url("${activeUrl}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${sheet.size.w * intScale}px ${sheet.size.h * intScale}px`,
          backgroundPosition: `-${currentFrame.x * intScale}px -${currentFrame.y * intScale}px`,
          imageRendering: 'pixelated',
          borderRadius: '0px',
          pointerEvents: 'none',
        }}
      />

      {/* Hidden loader image to detect custom sheet load errors & feed Canvas2D */}
      <img
        ref={imgRef}
        src={activeUrl}
        alt=""
        aria-hidden="true"
        onLoad={() => {
          const canvas = canvasRef.current;
          if (!canvas || !imgRef.current) return;
          try {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = false;
              ctx.clearRect?.(0, 0, drawWidth, drawHeight);
              ctx.drawImage(
                imgRef.current,
                currentFrame.x,
                currentFrame.y,
                currentFrame.w,
                currentFrame.h,
                0,
                0,
                drawWidth,
                drawHeight,
              );
            }
          } catch {
            // Ignore canvas draw errors
          }
        }}
        onError={() => {
          if (!usingFallbackSheet && activeUrl !== fallbackUrl) {
            setUsingFallbackSheet(true);
            onFallbackRef.current?.(`Failed to load custom sprite sheet: ${sheetUrl}`);
          }
        }}
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
          imageRendering: 'pixelated',
          borderRadius: '0px',
        }}
      />

      {/* Hardware-accelerated nearest-neighbor Canvas2D surface */}
      <canvas
        ref={canvasRef}
        width={drawWidth}
        height={drawHeight}
        aria-hidden="true"
        className="fui-pixelated"
        style={{
          position: 'relative',
          display: 'block',
          width: `${drawWidth}px`,
          height: `${drawHeight}px`,
          imageRendering: 'pixelated',
          borderRadius: '0px',
          pointerEvents: 'none',
        }}
      />
    </span>
  );
}
