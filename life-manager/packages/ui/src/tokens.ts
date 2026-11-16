import type { CSSProperties } from 'react';

export const FUI_TOKENS = {
  // M1 Locked Keys (100% backward-compatible with apps/web & apps/mobile)
  bgCarbon: '#08080B',
  bgPlum: '#0D0716',
  bgBlueprint: '#10171D',
  bgPanel: '#13151A',
  bgArena: '#141526',
  accentOrange: '#F87C18',
  accentVermilion: '#EB4511',
  accentAmber: '#F59E0B',
  accentCyan: '#2CE5F2',
  accentPhosphor: '#A8F040',
  inkStark: '#F6F6F4',
  borderRadius: '0px',

  // Full REF-01..REF-12 Extended Tokens
  borderHairline: '#262830',
  borderPlum: '#2A1A3A',
  accentCream: '#F4F6C2',
  inkProse: '#E4E6EB',
  inkMuted: '#8A909E',

  // Specialized SVG / HUD Tokens (REF-08, REF-09, REF-10)
  apertureOuterGunmetal: '#2A323B',
  apertureTurbineSilver: '#8A96A3',
  apertureGearTrack: '#5C2606',
  orbCoreWhite: '#E8FBFF',
  astrolabeGold: '#FFB020',

  // 3-Tier Typography Stacks & Floor
  fontDisplay: "'Barlow Condensed', 'DIN Condensed', 'Arial Narrow', sans-serif",
  fontMono: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
  fontSans: "'IBM Plex Sans', 'Inter', system-ui, -apple-system, sans-serif",
  interactiveFontFloor: '12px',
  interactiveFontFloorPx: 12,
} as const;

export type FuiTokenKey = keyof typeof FUI_TOKENS;

export const FUI_CSS_VARS = {
  '--fui-bg-carbon': FUI_TOKENS.bgCarbon,
  '--fui-bg-plum': FUI_TOKENS.bgPlum,
  '--fui-bg-blueprint': FUI_TOKENS.bgBlueprint,
  '--fui-bg-panel': FUI_TOKENS.bgPanel,
  '--fui-bg-arena': FUI_TOKENS.bgArena,
  '--fui-border-hairline': FUI_TOKENS.borderHairline,
  '--fui-border-plum': FUI_TOKENS.borderPlum,
  '--fui-accent-orange': FUI_TOKENS.accentOrange,
  '--fui-accent-vermilion': FUI_TOKENS.accentVermilion,
  '--fui-accent-amber': FUI_TOKENS.accentAmber,
  '--fui-accent-cyan': FUI_TOKENS.accentCyan,
  '--fui-accent-phosphor': FUI_TOKENS.accentPhosphor,
  '--fui-accent-cream': FUI_TOKENS.accentCream,
  '--fui-ink-stark': FUI_TOKENS.inkStark,
  '--fui-ink-prose': FUI_TOKENS.inkProse,
  '--fui-ink-muted': FUI_TOKENS.inkMuted,
} as const;

export type FuiSurfaceVariant = 'panel' | 'carbon' | 'plum' | 'blueprint' | 'arena';
export type FuiAccentTone =
  | 'orange'
  | 'stark'
  | 'vermilion'
  | 'amber'
  | 'cyan'
  | 'phosphor'
  | 'cream'
  | 'muted';

/**
 * Generates inline 45-degree diagonal hazard hatch CSS (`/////` from REF-02 & REF-07).
 */
export function fuiHatchStyle(
  stripeColor: string = FUI_TOKENS.accentOrange,
  stripeWidthPx: number = 2,
  pitchPx: number = 6,
  baseBg: string = 'transparent',
): CSSProperties {
  return {
    backgroundColor: baseBg,
    backgroundImage: `repeating-linear-gradient(-45deg, ${stripeColor} 0px, ${stripeColor} ${stripeWidthPx}px, transparent ${stripeWidthPx}px, transparent ${pitchPx}px)`,
    borderRadius: '0px',
  };
}
