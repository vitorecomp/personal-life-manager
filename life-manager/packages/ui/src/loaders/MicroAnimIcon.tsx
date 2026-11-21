import React from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { FUI_TOKENS } from '../tokens';

export const MICRO_ANIM_ICON_VARIANTS = [
  'TIME',
  'WIFI',
  'DOTS',
  'ICONS',
  'CIRCLE',
  'FADE_CIRCLES',
  'BALL',
] as const;

export type MicroAnimIconVariant = (typeof MICRO_ANIM_ICON_VARIANTS)[number];

export interface MicroAnimIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: MicroAnimIconVariant;
  /** Square badge size in px (strictly 0px border-radius per REF-02 Law 1); default 20 (supports 16 or 20) */
  size?: 16 | 20 | number;
  /** Sub-style for TIME ('hourglass' | 'clock'); default 'hourglass' */
  timeStyle?: 'hourglass' | 'clock';
  /** Stroke hex override; default '#F6F6F4' */
  strokeColor?: string;
  /** Pause animation cleanly; default true (auto-pauses on prefers-reduced-motion) */
  active?: boolean;
  ariaLabel?: string;
}

export function MicroAnimIcon({
  variant,
  size = 20,
  timeStyle = 'hourglass',
  strokeColor = FUI_TOKENS.inkStark,
  active = true,
  ariaLabel,
  style,
  ...rest
}: MicroAnimIconProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const isAnimating = active && !prefersReducedMotion;

  return (
    <span
      {...rest}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : 'true'}
      data-fui="micro-anim-icon"
      data-variant={variant}
      data-time-style={variant === 'TIME' ? timeStyle : undefined}
      data-active={isAnimating ? 'true' : 'false'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: FUI_TOKENS.bgCarbon,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        flexShrink: 0,
        ...style,
        borderRadius: '0px',
      }}
    >
      <svg
        width={size - 2}
        height={size - 2}
        viewBox="0 0 20 20"
        fill="none"
        style={{ display: 'block', borderRadius: '0px' }}
      >
        {variant === 'TIME' &&
          (timeStyle === 'clock' ? (
            <g data-micro-icon="time-clock">
              <circle cx="10" cy="10" r="6" stroke={strokeColor} strokeWidth="1.5" />
              <line x1="10" y1="10" x2="10" y2="6" stroke={strokeColor} strokeWidth="1.5" />
              <line x1="10" y1="10" x2="13.5" y2="10" stroke={strokeColor} strokeWidth="1.5" />
            </g>
          ) : (
            <g data-micro-icon="time-hourglass">
              <path
                d="M5.5 4H14.5L10 10L14.5 16H5.5L10 10Z"
                stroke={strokeColor}
                strokeWidth="1.5"
                strokeLinejoin="miter"
              />
              <polygon points="7.5,14.5 12.5,14.5 10,11.5" fill={strokeColor} />
            </g>
          ))}

        {variant === 'WIFI' && (
          <g data-micro-icon="wifi-mast">
            <line x1="10" y1="16.5" x2="10" y2="9" stroke={strokeColor} strokeWidth="1.5" />
            <circle cx="10" cy="7.8" r="1.2" fill={strokeColor} />
            <path d="M 7.5 5.6 A 3.4 3.4 0 0 0 7.5 10.0" stroke={strokeColor} strokeWidth="1.5" />
            <path d="M 12.5 5.6 A 3.4 3.4 0 0 1 12.5 10.0" stroke={strokeColor} strokeWidth="1.5" />
            <path d="M 5.3 3.8 A 6.2 6.2 0 0 0 5.3 11.8" stroke={strokeColor} strokeWidth="1.5" opacity="0.75" />
            <path d="M 14.7 3.8 A 6.2 6.2 0 0 1 14.7 11.8" stroke={strokeColor} strokeWidth="1.5" opacity="0.75" />
          </g>
        )}

        {variant === 'DOTS' && (
          <g data-micro-icon="dots-orbit">
            <circle cx="10" cy="5.8" r="1.6" fill={strokeColor} />
            <circle cx="6.4" cy="12.1" r="1.6" fill={strokeColor} />
            <circle cx="13.6" cy="12.1" r="1.6" fill={strokeColor} opacity="0.7" />
          </g>
        )}

        {variant === 'ICONS' && (
          <g data-micro-icon="grimoire-book">
            <rect x="3.5" y="5" width="6.5" height="10" stroke={strokeColor} strokeWidth="1.5" />
            <rect x="10" y="5" width="6.5" height="10" stroke={strokeColor} strokeWidth="1.5" />
            <path
              data-grimoire-leaf="true"
              d="M10 5.5 L15 4.5 V14.5 L10 15 Z"
              stroke={strokeColor}
              strokeWidth="1.2"
            />
          </g>
        )}

        {variant === 'CIRCLE' && (
          <g data-micro-icon="circle-sweep">
            <circle
              cx="10"
              cy="10"
              r="6"
              stroke={strokeColor}
              strokeWidth="1.5"
              strokeDasharray="27 11"
            />
          </g>
        )}

        {variant === 'FADE_CIRCLES' && (
          <g data-micro-icon="fade-circles">
            <circle cx="10" cy="10" r="2.5" stroke={strokeColor} strokeWidth="1.5" />
            <circle cx="10" cy="10" r="6" stroke={strokeColor} strokeWidth="1.5" opacity="0.55" />
          </g>
        )}

        {variant === 'BALL' && (
          <g data-micro-icon="ball-bounce">
            <circle cx="10" cy="8" r="2.5" fill={strokeColor} />
            <line x1="6" y1="15.5" x2="14" y2="15.5" stroke={strokeColor} strokeWidth="1.5" />
          </g>
        )}
      </svg>
    </span>
  );
}
