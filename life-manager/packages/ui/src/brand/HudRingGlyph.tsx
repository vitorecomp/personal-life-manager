import React from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { FUI_TOKENS } from '../tokens';

export const HUD_RING_GLYPH_VARIANTS = [
  'radial_comb_gauge',
  'segmented_bezel',
  'cardinal_pointer_ring',
  'crosshair_reticle',
  'tick_arc_270',
  'tick_arc_90',
  'aperture_shutter_8',
  'notched_rotor',
] as const;

export type HudRingGlyphVariant = (typeof HUD_RING_GLYPH_VARIANTS)[number];

export interface HudRingGlyphProps extends React.SVGProps<SVGSVGElement> {
  variant: HudRingGlyphVariant;
  size?: number;
  color?: string;
  spinning?: boolean;
}

const CX = 50;
const CY = 50;
const DEG = Math.PI / 180;

function polar(r: number, deg: number): [number, number] {
  const rad = deg * DEG;
  return [
    Number((CX + r * Math.cos(rad)).toFixed(2)),
    Number((CY + r * Math.sin(rad)).toFixed(2)),
  ];
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(r, startDeg);
  const [x2, y2] = polar(r, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

export function HudRingGlyph({
  variant,
  size = 48,
  color = FUI_TOKENS.inkStark,
  spinning = false,
  style,
  ...rest
}: HudRingGlyphProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldSpin = spinning && !prefersReducedMotion;

  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      data-fui="hud-ring-glyph"
      data-variant={variant}
      className={shouldSpin ? 'fui-motion-spin' : undefined}
      style={{
        display: 'inline-block',
        borderRadius: '0px',
        ...(shouldSpin ? { animation: 'fui-spin-cw 10s linear infinite' } : {}),
        ...style,
      }}
    >
      {variant === 'radial_comb_gauge' && (
        <g>
          <path d={arcPath(44, -210, 30)} fill="none" stroke={color} strokeWidth="1.5" />
          {Array.from({ length: 28 }).map((_, i) => {
            const deg = -210 + i * (240 / 27);
            const [x1, y1] = polar(33, deg);
            const [x2, y2] = polar(41, deg);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.2" />;
          })}
          <circle cx={CX} cy={CY} r="22" fill="none" stroke={color} strokeWidth="1" strokeDasharray="4 3" />
        </g>
      )}

      {variant === 'segmented_bezel' && (
        <g>
          <circle cx={CX} cy={CY} r="42" fill="none" stroke={color} strokeWidth="1.2" />
          <path d={arcPath(38, -70, 50)} fill="none" stroke={color} strokeWidth="4" />
          <path d={arcPath(38, 110, 230)} fill="none" stroke={color} strokeWidth="4" />
          <circle cx={CX} cy={CY} r="26" fill="none" stroke={color} strokeWidth="1.5" />
        </g>
      )}

      {variant === 'cardinal_pointer_ring' && (
        <g>
          <circle cx={CX} cy={CY} r="36" fill="none" stroke={color} strokeWidth="1.2" />
          <polygon points="50,6 46,13 54,13" fill={color} />
          <polygon points="50,94 46,87 54,87" fill={color} />
          <path d="M 10 38 H 6 V 62 H 10 M 90 38 H 94 V 62 H 90" fill="none" stroke={color} strokeWidth="1.5" />
        </g>
      )}

      {variant === 'crosshair_reticle' && (
        <g>
          <circle cx={CX} cy={CY} r="38" fill="none" stroke={color} strokeWidth="1.2" />
          <line x1="50" y1="4" x2="50" y2="22" stroke={color} strokeWidth="1.5" />
          <line x1="50" y1="78" x2="50" y2="96" stroke={color} strokeWidth="1.5" />
          <line x1="4" y1="50" x2="22" y2="50" stroke={color} strokeWidth="1.5" />
          <line x1="78" y1="50" x2="96" y2="50" stroke={color} strokeWidth="1.5" />
          <circle cx={CX} cy={CY} r="6" fill="none" stroke={color} strokeWidth="1.2" />
        </g>
      )}

      {variant === 'tick_arc_270' && (
        <g>
          {Array.from({ length: 36 }).map((_, i) => {
            const deg = -225 + i * (270 / 35);
            const [x1, y1] = polar(34, deg);
            const [x2, y2] = polar(43, deg);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.6" />;
          })}
        </g>
      )}

      {variant === 'tick_arc_90' && (
        <g>
          {Array.from({ length: 12 }).map((_, i) => {
            const deg = -90 + i * (90 / 11);
            const [x1, y1] = polar(34, deg);
            const [x2, y2] = polar(44, deg);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2" />;
          })}
          <path d={arcPath(28, -90, 0)} fill="none" stroke={color} strokeWidth="1.2" />
        </g>
      )}

      {variant === 'aperture_shutter_8' && (
        <g>
          <circle cx={CX} cy={CY} r="42" fill="none" stroke={color} strokeWidth="1.5" />
          {Array.from({ length: 8 }).map((_, b) => {
            const a0 = b * 45;
            const [x1, y1] = polar(40, a0);
            const [x2, y2] = polar(18, a0 + 55);
            return <line key={b} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.5" />;
          })}
          <circle cx={CX} cy={CY} r="18" fill="none" stroke={color} strokeWidth="1.2" />
        </g>
      )}

      {variant === 'notched_rotor' && (
        <g>
          <path d={arcPath(38, -140, 140)} fill="none" stroke={color} strokeWidth="5" />
          <polygon points="20,25 32,21 26,33" fill={color} />
          <circle cx={CX} cy={CY} r="16" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="8 4" />
        </g>
      )}
    </svg>
  );
}
