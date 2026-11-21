import React from 'react';
import { FUI_TOKENS } from '../tokens';

export interface FuiBatteryCapsuleProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Progress percentage 0..100 (clamped safely; NaN/negative -> 0, >100 -> 100) */
  progressPct: number;
  /** Number of discrete internal cells (default 4); pass 0/1 for continuous bar */
  segments?: number;
  fillColor?: string;
  /** Optional REF-05 inline ▷ Focus Timer Play trigger callback */
  onTriggerPlay?: () => void;
  isPlaying?: boolean;
  playAriaLabel?: string;
}

export function FuiBatteryCapsule({
  progressPct,
  segments = 4,
  fillColor = FUI_TOKENS.inkStark,
  onTriggerPlay,
  isPlaying = false,
  playAriaLabel = 'Start focus timer',
  style,
  ...rest
}: FuiBatteryCapsuleProps) {
  const clampedPct = Number.isFinite(progressPct) ? Math.min(100, Math.max(0, Math.round(progressPct))) : 0;
  const cellCount = segments && segments > 1 ? Math.round(segments) : 1;
  const activeCells = Math.round((clampedPct / 100) * cellCount);

  return (
    <div
      {...rest}
      data-fui="battery-capsule"
      data-progress={clampedPct}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        ...style,
        borderRadius: '0px',
      }}
    >
      <svg
        width="36"
        height="14"
        viewBox="0 0 36 14"
        role="img"
        aria-label={`Progress ${clampedPct}%`}
        style={{ display: 'block', borderRadius: '0px' }}
      >
        {/* Outer 0px battery body */}
        <rect
          x="1"
          y="2"
          width="28"
          height="10"
          fill={FUI_TOKENS.bgCarbon}
          stroke={FUI_TOKENS.inkStark}
          strokeWidth="1.2"
        />
        {/* Right positive terminal nub */}
        <rect x="29" y="4.5" width="3" height="5" fill={FUI_TOKENS.inkStark} />

        {/* Internal charge segments */}
        {cellCount === 1 ? (
          <rect
            data-battery-cell="0"
            x="3"
            y="4"
            width={Number(((24 * clampedPct) / 100).toFixed(2))}
            height="6"
            fill={fillColor}
          />
        ) : (
          Array.from({ length: cellCount }).map((_, idx) => {
            const totalW = 24;
            const gap = 1.5;
            const cellW = (totalW - gap * (cellCount - 1)) / cellCount;
            const cellX = 3 + idx * (cellW + gap);
            const filled = idx < activeCells;
            return (
              <rect
                key={idx}
                data-battery-cell={idx}
                data-filled={filled ? 'true' : 'false'}
                x={Number(cellX.toFixed(2))}
                y="4"
                width={Number(cellW.toFixed(2))}
                height="6"
                fill={filled ? fillColor : FUI_TOKENS.borderHairline}
              />
            );
          })
        )}
      </svg>

      {onTriggerPlay && (
        <>
          <span
            aria-hidden="true"
            style={{
              width: '10px',
              height: '1px',
              backgroundColor: FUI_TOKENS.inkStark,
              borderRadius: '0px',
            }}
          />
          <button
            type="button"
            aria-label={playAriaLabel}
            aria-pressed={isPlaying}
            data-fui-part="battery-play-trigger"
            onClick={(e) => {
              e.stopPropagation();
              onTriggerPlay();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '28px',
              minHeight: '28px',
              padding: '2px 6px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              color: FUI_TOKENS.inkStark,
              border: `1px solid ${isPlaying ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              cursor: 'pointer',
              borderRadius: '0px',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
              <path
                d="M 4 2.5 L 12.5 7.5 L 4 12.5 Z"
                fill={isPlaying ? FUI_TOKENS.accentOrange : 'none'}
                stroke={isPlaying ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkStark}
                strokeWidth="1.5"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
