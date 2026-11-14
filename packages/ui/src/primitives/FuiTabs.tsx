import React, { useId, useRef } from 'react';
import { FUI_TOKENS } from '../tokens';

export interface FuiTabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  code?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
  panel?: React.ReactNode;
}

export interface FuiTabsProps<T extends string = string> {
  tabs: readonly FuiTabItem<T>[];
  activeTab: T;
  onTabChange: (tabId: T) => void;
  ariaLabel?: string;
  variant?: 'underline' | 'solid';
  className?: string;
  style?: React.CSSProperties;
}

export function FuiTabs<T extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel = 'Tactical View Tabs',
  variant = 'underline',
  className,
  style,
}: FuiTabsProps<T>) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledIndices = tabs
    .map((t, i) => (t.disabled ? -1 : i))
    .filter((i) => i >= 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
    if (enabledIndices.length === 0) return;
    const pos = enabledIndices.indexOf(currentIdx);
    let nextIdx: number | undefined;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextIdx = enabledIndices[(pos + 1) % enabledIndices.length];
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIdx = enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length];
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = enabledIndices[0];
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = enabledIndices[enabledIndices.length - 1];
    }

    if (nextIdx !== undefined) {
      const targetTab = tabs[nextIdx];
      if (targetTab) {
        onTabChange(targetTab.id);
        tabRefs.current[nextIdx]?.focus();
      }
    }
  };

  const activeItem = tabs.find((t) => t.id === activeTab);

  return (
    <div data-fui="tabs" className={className} style={{ borderRadius: '0px', ...style }}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
          backgroundColor: FUI_TOKENS.bgCarbon,
          borderRadius: '0px',
        }}
      >
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTab;
          const isSolid = variant === 'solid' && isActive;
          const tabId = `${baseId}-tab-${tab.id}`;
          const panelId = `${baseId}-panel-${tab.id}`;

          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={tab.panel !== undefined ? panelId : undefined}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              data-fui="tab"
              data-active={isActive ? 'true' : 'false'}
              onClick={() => {
                if (!tab.disabled) onTabChange(tab.id);
              }}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                minHeight: '32px',
                padding: '6px 12px',
                backgroundColor: isSolid
                  ? FUI_TOKENS.accentOrange
                  : isActive
                    ? FUI_TOKENS.bgPanel
                    : FUI_TOKENS.bgCarbon,
                color: isSolid
                  ? FUI_TOKENS.bgCarbon
                  : isActive
                    ? FUI_TOKENS.inkStark
                    : FUI_TOKENS.inkMuted,
                border: 'none',
                borderRight: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderTop:
                  variant === 'underline' && isActive
                    ? `2px solid ${FUI_TOKENS.accentOrange}`
                    : '2px solid transparent',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                cursor: tab.disabled ? 'not-allowed' : 'pointer',
                opacity: tab.disabled ? 0.45 : 1,
                borderRadius: '0px',
              }}
            >
              {tab.code && (
                <span
                  data-fui-part="tab-code"
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    opacity: 0.85,
                    borderRadius: '0px',
                  }}
                >
                  [{tab.code}]
                </span>
              )}
              <span>{tab.label}</span>
              {tab.badge && (
                <span data-fui-part="tab-badge" style={{ borderRadius: '0px' }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeItem?.panel !== undefined && (
        <div
          id={`${baseId}-panel-${activeItem.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          data-fui-part="tab-panel"
          style={{ borderRadius: '0px' }}
        >
          {activeItem.panel}
        </div>
      )}
    </div>
  );
}
