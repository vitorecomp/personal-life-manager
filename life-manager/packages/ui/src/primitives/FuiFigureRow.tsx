import React from 'react';
import { FUI_TOKENS } from '../tokens';

export interface FuiFigureRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  code?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  active?: boolean;
  tabColor?: string;
  statusDotColor?: string;
  rightSlot?: React.ReactNode;
  phosphorSplitPct?: number;
  onSelect?: () => void;
}

export function FuiFigureRow({
  code,
  title,
  subtitle,
  active = false,
  tabColor = FUI_TOKENS.accentAmber,
  statusDotColor = FUI_TOKENS.accentAmber,
  rightSlot,
  phosphorSplitPct = 24,
  onSelect,
  style,
  onClick,
  onKeyDown,
  ...rest
}: FuiFigureRowProps) {
  const clampedSplit = Math.min(100, Math.max(0, Number.isFinite(phosphorSplitPct) ? phosphorSplitPct : 24));
  const isInteractive = Boolean(onSelect || onClick);

  return (
    <div
      {...rest}
      role={isInteractive ? 'button' : rest.role}
      tabIndex={isInteractive ? 0 : rest.tabIndex}
      data-fui="figure-row"
      data-active={active ? 'true' : 'false'}
      onClick={(e) => {
        onClick?.(e);
        onSelect?.();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '6px minmax(0, 1fr) 44px',
        backgroundColor: active ? '#19102B' : FUI_TOKENS.bgPlum,
        border: `1px solid ${FUI_TOKENS.borderPlum}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        cursor: isInteractive ? 'pointer' : 'default',
        ...style,
        borderRadius: '0px',
      }}
    >
      {/* Explicit notched #F59E0B left tab element (no border-left side-stripe shortcut!) */}
      <div
        aria-hidden="true"
        data-fui-part="figure-left-tab"
        style={{
          position: 'relative',
          backgroundColor: tabColor,
          clipPath: 'polygon(0 4px, 3px 4px, 3px 0, 100% 0, 100% 100%, 0 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          borderRadius: '0px',
        }}
      >
        <span style={{ width: '2px', height: '2px', backgroundColor: FUI_TOKENS.bgCarbon, borderRadius: '0px' }} />
        <span style={{ width: '2px', height: '2px', backgroundColor: FUI_TOKENS.bgCarbon, borderRadius: '0px' }} />
      </div>

      {/* Main Content Cell */}
      <div
        data-fui-part="figure-main"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '2px',
          padding: '8px 10px 10px 10px',
          minWidth: 0,
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
          {code && (
            <span
              data-fui-part="figure-code"
              style={{
                fontWeight: 700,
                color: FUI_TOKENS.accentAmber,
                letterSpacing: '0.05em',
                borderRadius: '0px',
              }}
            >
              {code}
            </span>
          )}
          <span
            data-fui-part="figure-title"
            style={{
              fontWeight: 600,
              color: FUI_TOKENS.inkStark,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderRadius: '0px',
            }}
          >
            {title}
          </span>
        </div>
        {subtitle && (
          <div
            data-fui-part="figure-subtitle"
            style={{
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderRadius: '0px',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      {/* Right 1px-Divided Status Cell */}
      <div
        data-fui-part="figure-status-cell"
        style={{
          borderLeft: `1px solid ${FUI_TOKENS.borderPlum}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          borderRadius: '0px',
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <circle cx="4" cy="4" r="2.5" fill={statusDotColor} />
        </svg>
        {rightSlot}
      </div>

      {/* 2-Segment Phosphor (#A8F040) + Vermilion (#EB4511) Bottom Underline */}
      <div
        aria-hidden="true"
        data-fui-part="figure-dual-underline"
        style={{
          gridColumn: '1 / -1',
          display: 'flex',
          height: '2px',
          width: '100%',
          borderRadius: '0px',
        }}
      >
        <span
          data-underline-left="phosphor"
          style={{
            width: `${clampedSplit}%`,
            height: '2px',
            backgroundColor: FUI_TOKENS.accentPhosphor,
            borderRadius: '0px',
          }}
        />
        <span
          data-underline-right="vermilion"
          style={{
            width: `${100 - clampedSplit}%`,
            height: '2px',
            backgroundColor: FUI_TOKENS.accentVermilion,
            borderRadius: '0px',
          }}
        />
      </div>
    </div>
  );
}
