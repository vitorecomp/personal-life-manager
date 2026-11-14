import React from 'react';
import { FUI_TOKENS, fuiHatchStyle, type FuiSurfaceVariant } from '../tokens';

export type FuiHeaderAccent = 'orange' | 'stark' | 'cyan' | 'vermilion' | 'amber' | 'phosphor';

export interface FuiPanelHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  /** Optional secondary slug or metric code (e.g. "80.485", "SAT.3") */
  code?: string;
  /** Accent color for the 4px stepped top bar & [+] badge; defaults to 'orange' (#F87C18) */
  accent?: FuiHeaderAccent;
  /** Placement of the 4px thick stepped segment over the 1px top rule; defaults to 'left' */
  stepAlign?: 'left' | 'right' | 'both';
  /** Renders 16x16 solid #F87C18 square prefix badge; defaults to '+' (pass false to hide) */
  prefixBadge?: '+' | '>' | '■' | string | false;
  /** Renders 6x6px 1px L-shaped corner ticks (┌ ┐); defaults to true */
  cornerTicks?: boolean;
  /** Renders the 3px #F87C18 horizontal Frieren shelf along the header ledge */
  frierenLedge?: boolean;
  /** Alias for frierenLedge */
  showFrierenLedge?: boolean;
  /** Optional perched sprite node (e.g. <CompanionStage mode="ledge" />) anchored atop the 3px ledge */
  ledgeSlot?: React.ReactNode;
  /** Alias for ledgeSlot */
  companionSlot?: React.ReactNode;
  /** Right-aligned action controls or status badges */
  actions?: React.ReactNode;
}

export interface FuiPanelProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'div' | 'aside';
  surface?: FuiSurfaceVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  cornerTicks?: boolean;
  hatchFooter?: boolean;
  header?: React.ReactNode;
  headerTitle?: React.ReactNode;
  headerProps?: FuiPanelHeaderProps;
}

const ACCENT_MAP: Record<FuiHeaderAccent, string> = {
  orange: FUI_TOKENS.accentOrange,
  stark: FUI_TOKENS.inkStark,
  cyan: FUI_TOKENS.accentCyan,
  vermilion: FUI_TOKENS.accentVermilion,
  amber: FUI_TOKENS.accentAmber,
  phosphor: FUI_TOKENS.accentPhosphor,
};

const SURFACE_MAP: Record<FuiSurfaceVariant, { bg: string; border: string }> = {
  panel: { bg: FUI_TOKENS.bgPanel, border: FUI_TOKENS.borderHairline },
  carbon: { bg: FUI_TOKENS.bgCarbon, border: FUI_TOKENS.borderHairline },
  plum: { bg: FUI_TOKENS.bgPlum, border: FUI_TOKENS.borderPlum },
  blueprint: { bg: FUI_TOKENS.bgBlueprint, border: FUI_TOKENS.borderHairline },
  arena: { bg: FUI_TOKENS.bgArena, border: FUI_TOKENS.borderHairline },
};

const PADDING_MAP: Record<NonNullable<FuiPanelProps['padding']>, string> = {
  none: '0px',
  sm: '8px',
  md: '12px',
  lg: '16px',
};

export function FuiPanelHeader({
  title,
  code,
  accent = 'orange',
  stepAlign = 'left',
  prefixBadge = '+',
  cornerTicks = true,
  frierenLedge,
  showFrierenLedge,
  ledgeSlot,
  companionSlot,
  actions,
  style,
  ...rest
}: FuiPanelHeaderProps) {
  const accentHex = ACCENT_MAP[accent] ?? FUI_TOKENS.accentOrange;
  const activeSlot = ledgeSlot ?? companionSlot;
  const hasLedge = Boolean(frierenLedge || showFrierenLedge || activeSlot);

  return (
    <header
      {...rest}
      data-fui="panel-header"
      data-fui-accent={accent}
      data-fui-frieren-ledge={hasLedge ? 'true' : 'false'}
      style={{
        position: 'relative',
        backgroundColor: FUI_TOKENS.bgCarbon,
        borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
        borderRadius: '0px',
        ...style,
      }}
    >
      {/* Stepped 1px + 4px Top Rule */}
      <div
        data-fui-part="stepped-rule"
        style={{
          position: 'relative',
          height: '4px',
          width: '100%',
          borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        {(stepAlign === 'left' || stepAlign === 'both') && (
          <span
            data-fui-part="stepped-bar-left"
            style={{
              position: 'absolute',
              top: '-1px',
              left: '0px',
              width: '64px',
              height: '4px',
              backgroundColor: accentHex,
              borderRadius: '0px',
            }}
          />
        )}
        {(stepAlign === 'right' || stepAlign === 'both') && (
          <span
            data-fui-part="stepped-bar-right"
            style={{
              position: 'absolute',
              top: '-1px',
              right: '0px',
              width: '64px',
              height: '4px',
              backgroundColor: accentHex,
              borderRadius: '0px',
            }}
          />
        )}
      </div>

      {cornerTicks && (
        <>
          <span
            aria-hidden="true"
            data-fui-part="corner-tick"
            style={{
              position: 'absolute',
              top: '0px',
              left: '0px',
              width: '6px',
              height: '6px',
              borderTop: `1px solid ${accentHex}`,
              borderLeft: `1px solid ${accentHex}`,
              borderRadius: '0px',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden="true"
            data-fui-part="corner-tick"
            style={{
              position: 'absolute',
              top: '0px',
              right: '0px',
              width: '6px',
              height: '6px',
              borderTop: `1px solid ${accentHex}`,
              borderRight: `1px solid ${accentHex}`,
              borderRadius: '0px',
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      {hasLedge && (
        <div
          data-fui-part="frieren-ledge"
          style={{
            position: 'relative',
            height: '3px',
            width: '100%',
            backgroundColor: FUI_TOKENS.accentOrange,
            borderRadius: '0px',
          }}
        >
          {activeSlot && (
            <div
              data-fui-part="frieren-ledge-anchor"
              style={{
                position: 'absolute',
                right: '16px',
                bottom: '3px',
                lineHeight: 0,
                borderRadius: '0px',
              }}
            >
              {activeSlot}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '6px 10px',
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, borderRadius: '0px' }}>
          {prefixBadge !== false && (
            <span
              data-fui-part="prefix-badge"
              style={{
                width: '16px',
                height: '16px',
                backgroundColor: accentHex,
                color: FUI_TOKENS.bgCarbon,
                borderRadius: '0px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {prefixBadge === '+' ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M5 1.5V8.5M1.5 5H8.5" stroke={FUI_TOKENS.bgCarbon} strokeWidth="1.75" />
                </svg>
              ) : prefixBadge === '>' ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M3 2L7 5L3 8" fill="none" stroke={FUI_TOKENS.bgCarbon} strokeWidth="1.75" />
                </svg>
              ) : (
                prefixBadge
              )}
            </span>
          )}
          <span
            data-fui-part="header-title"
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: FUI_TOKENS.inkStark,
              borderRadius: '0px',
            }}
          >
            {title}
          </span>
          {code && (
            <span
              data-fui-part="header-code"
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
                fontVariantNumeric: 'tabular-nums',
                borderRadius: '0px',
              }}
            >
              {code}
            </span>
          )}
        </div>
        {actions && (
          <div
            data-fui-part="header-actions"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '0px' }}
          >
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

export function FuiPanel({
  as: Component = 'section',
  surface = 'panel',
  padding = 'md',
  cornerTicks = true,
  hatchFooter = false,
  header,
  headerTitle,
  headerProps,
  children,
  style,
  ...rest
}: FuiPanelProps) {
  const { bg, border } = SURFACE_MAP[surface] ?? SURFACE_MAP.panel;
  const resolvedHeader =
    header ?? (headerProps ? <FuiPanelHeader {...headerProps} /> : headerTitle ? <FuiPanelHeader title={headerTitle} /> : null);

  return (
    <Component
      {...rest}
      data-fui="panel"
      data-surface={surface}
      style={{
        position: 'relative',
        backgroundColor: bg,
        border: `1px solid ${border}`,
        borderRadius: '0px',
        color: FUI_TOKENS.inkStark,
        ...style,
      }}
    >
      {cornerTicks && (
        <>
          <span
            aria-hidden="true"
            data-fui-part="corner-tick"
            style={{
              position: 'absolute',
              top: '-1px',
              left: '-1px',
              width: '6px',
              height: '6px',
              borderTop: `1px solid ${FUI_TOKENS.inkStark}`,
              borderLeft: `1px solid ${FUI_TOKENS.inkStark}`,
              borderRadius: '0px',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden="true"
            data-fui-part="corner-tick"
            style={{
              position: 'absolute',
              top: '-1px',
              right: '-1px',
              width: '6px',
              height: '6px',
              borderTop: `1px solid ${FUI_TOKENS.inkStark}`,
              borderRight: `1px solid ${FUI_TOKENS.inkStark}`,
              borderRadius: '0px',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden="true"
            data-fui-part="corner-tick"
            style={{
              position: 'absolute',
              bottom: '-1px',
              left: '-1px',
              width: '6px',
              height: '6px',
              borderBottom: `1px solid ${FUI_TOKENS.inkStark}`,
              borderLeft: `1px solid ${FUI_TOKENS.inkStark}`,
              borderRadius: '0px',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden="true"
            data-fui-part="corner-tick"
            style={{
              position: 'absolute',
              bottom: '-1px',
              right: '-1px',
              width: '6px',
              height: '6px',
              borderBottom: `1px solid ${FUI_TOKENS.inkStark}`,
              borderRight: `1px solid ${FUI_TOKENS.inkStark}`,
              borderRadius: '0px',
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      {resolvedHeader}

      <div
        data-fui-part="panel-body"
        style={{
          padding: PADDING_MAP[padding],
          borderRadius: '0px',
        }}
      >
        {children}
      </div>

      {hatchFooter && (
        <div
          data-fui-part="hatch-footer"
          className="fui-hatch-45"
          style={{
            height: '6px',
            width: '100%',
            borderTop: `1px solid ${border}`,
            ...fuiHatchStyle(FUI_TOKENS.accentOrange, 2, 6, FUI_TOKENS.bgCarbon),
          }}
        />
      )}
    </Component>
  );
}
