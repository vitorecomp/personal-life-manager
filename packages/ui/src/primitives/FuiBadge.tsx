import React from 'react';
import { FUI_TOKENS, fuiHatchStyle, type FuiAccentTone } from '../tokens';

export interface FuiBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: FuiAccentTone | 'hatch';
  /** Optional split-plate prefix (e.g. code="500" + children="25 FRAME THROWER" from REF-02) */
  code?: string;
  solid?: boolean;
}

export interface FuiCalloutTagProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Upper cream banner text (e.g. "SECTION XR-0429B" on #F4F6C2 with #08080B ink) */
  banner: React.ReactNode;
  /** Optional lower dark coordinate readout (e.g. "X 35_AL" from REF-01) */
  coordinate?: React.ReactNode;
}

const TONE_HEX: Record<FuiAccentTone, string> = {
  orange: FUI_TOKENS.accentOrange,
  stark: FUI_TOKENS.inkStark,
  vermilion: FUI_TOKENS.accentVermilion,
  amber: FUI_TOKENS.accentAmber,
  cyan: FUI_TOKENS.accentCyan,
  phosphor: FUI_TOKENS.accentPhosphor,
  cream: FUI_TOKENS.accentCream,
  muted: FUI_TOKENS.inkMuted,
};

export function FuiBadge({
  tone = 'orange',
  code,
  solid = false,
  children,
  style,
  ...rest
}: FuiBadgeProps) {
  if (tone === 'hatch') {
    return (
      <span
        {...rest}
        data-fui="badge"
        data-tone="hatch"
        className="fui-hatch-45"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '2px 8px',
          fontFamily: FUI_TOKENS.fontMono,
          fontSize: '12px',
          fontWeight: 600,
          color: FUI_TOKENS.inkStark,
          border: `1px solid ${FUI_TOKENS.accentOrange}`,
          ...fuiHatchStyle(FUI_TOKENS.accentOrange, 2, 6, FUI_TOKENS.bgCarbon),
          ...style,
          borderRadius: '0px',
        }}
      >
        {children}
      </span>
    );
  }

  const hex = TONE_HEX[tone] ?? FUI_TOKENS.accentOrange;
  const bg = solid ? hex : FUI_TOKENS.bgCarbon;
  // WCAG AA dark ink on bright solid plates
  const fg = solid ? FUI_TOKENS.bgCarbon : hex;

  return (
    <span
      {...rest}
      data-fui="badge"
      data-tone={tone}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${hex}`,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        ...style,
        borderRadius: '0px',
      }}
    >
      {code && (
        <span
          data-fui-part="badge-code"
          style={{
            padding: '2px 6px',
            backgroundColor: hex,
            color: FUI_TOKENS.bgCarbon,
            fontWeight: 700,
            borderRadius: '0px',
          }}
        >
          {code}
        </span>
      )}
      <span style={{ padding: '2px 7px', borderRadius: '0px' }}>{children}</span>
    </span>
  );
}

export function FuiCalloutTag({
  banner,
  coordinate,
  style,
  ...rest
}: FuiCalloutTagProps) {
  return (
    <div
      {...rest}
      data-fui="callout-tag"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        borderRadius: '0px',
        ...style,
      }}
    >
      <div
        data-fui-part="callout-banner"
        style={{
          padding: '2px 8px',
          backgroundColor: FUI_TOKENS.accentCream,
          color: FUI_TOKENS.bgCarbon,
          fontFamily: FUI_TOKENS.fontMono,
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderRadius: '0px',
        }}
      >
        {banner}
      </div>
      {coordinate && (
        <div
          data-fui-part="callout-coordinate"
          style={{
            padding: '2px 8px',
            backgroundColor: FUI_TOKENS.bgPlum,
            color: FUI_TOKENS.inkStark,
            border: `1px solid ${FUI_TOKENS.borderPlum}`,
            borderTop: 'none',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            fontVariantNumeric: 'tabular-nums',
            borderRadius: '0px',
          }}
        >
          {coordinate}
        </div>
      )}
    </div>
  );
}
