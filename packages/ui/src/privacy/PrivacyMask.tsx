import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FuiButton, type FuiButtonProps } from '../primitives/FuiButton';

export type PrivacyValueKind = 'currency' | 'percent' | 'ratio' | 'duration' | 'count';

export interface PrivacyMaskContextValue {
  isMasked: boolean;
  toggleMask: () => void;
  setMasked: (masked: boolean) => void;
}

export interface PrivacyMaskProviderProps {
  defaultMasked?: boolean;
  /** Controlled override when synced to URL/Zustand store */
  masked?: boolean;
  onMaskedChange?: (masked: boolean) => void;
  /** LocalStorage key; pass null to disable persistence (default: 'hermes-fui-privacy-mask') */
  storageKey?: string | null;
  children: React.ReactNode;
}

export interface PrivacyValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Formatted display string or numeric value (e.g. "R$ 142.500,00", "$ 28,400.00", "34.2%", "7Y 4M") */
  value: string | number;
  /** Value semantic category — ONLY 'currency' is redacted when isMasked === true! */
  kind?: PrivacyValueKind;
  /** Explicit currency hint for numeric values or symbol prefix ("R$ ••••••" vs "$ ••••••") */
  currency?: 'BRL' | 'USD' | string;
}

export interface PrivacyMaskToggleProps extends Omit<FuiButtonProps, 'onClick' | 'children'> {
  label?: string;
}

const PrivacyMaskContext = createContext<PrivacyMaskContextValue>({
  isMasked: false,
  toggleMask: () => {},
  setMasked: () => {},
});

const PURE_PERCENT_REGEX = /^\s*[+-]?\d+(?:[.,]\d+)?\s*%\s*$/;
const PURE_DURATION_REGEX = /^\s*\d+\s*Y(?:\s+\d+\s*M)?\b/i;

export function isNonCurrencyToken(value: string | number, kind: PrivacyValueKind = 'currency', currency?: string): boolean {
  if (kind !== 'currency') return true;
  if (!currency && typeof value === 'string') {
    if (PURE_PERCENT_REGEX.test(value) || PURE_DURATION_REGEX.test(value)) {
      return true;
    }
  }
  return false;
}

/**
 * Redacts currency figures to `'R$ ••••••'` / `'$ ••••••'` / `'••••••'` with zero digit leakage.
 */
export function formatMaskedCurrency(
  value: string | number,
  currency?: 'BRL' | 'USD' | string,
): string {
  const str = String(value ?? '');
  const upperCurrency = currency?.trim().toUpperCase();

  if (upperCurrency === 'BRL' || /^[+-]?\s*R\$/i.test(str)) {
    return 'R$ ••••••';
  }
  if (upperCurrency === 'USD' || /^[+-]?\s*(?:US)?\$/i.test(str)) {
    return '$ ••••••';
  }
  if (upperCurrency && /^[A-Z]{3}$/.test(upperCurrency)) {
    return `${upperCurrency} ••••••`;
  }
  return '••••••';
}

export function PrivacyMaskProvider({
  defaultMasked = false,
  masked: controlledMasked,
  onMaskedChange,
  storageKey = 'hermes-fui-privacy-mask',
  children,
}: PrivacyMaskProviderProps) {
  const [internalMasked, setInternalMasked] = useState<boolean>(() => {
    if (controlledMasked !== undefined) return controlledMasked;
    if (storageKey && typeof window !== 'undefined' && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored === 'true') return true;
        if (stored === 'false') return false;
      } catch {
        // Ignore storage errors
      }
    }
    return defaultMasked;
  });

  const isMasked = controlledMasked !== undefined ? controlledMasked : internalMasked;

  useEffect(() => {
    if (storageKey && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(storageKey, isMasked ? 'true' : 'false');
      } catch {
        // Ignore storage errors
      }
    }
  }, [isMasked, storageKey]);

  const setMasked = useCallback(
    (next: boolean) => {
      if (controlledMasked === undefined) {
        setInternalMasked(next);
      }
      onMaskedChange?.(next);
    },
    [controlledMasked, onMaskedChange],
  );

  const toggleMask = useCallback(() => {
    setMasked(!isMasked);
  }, [isMasked, setMasked]);

  const contextValue = useMemo<PrivacyMaskContextValue>(
    () => ({ isMasked, toggleMask, setMasked }),
    [isMasked, toggleMask, setMasked],
  );

  return (
    <PrivacyMaskContext.Provider value={contextValue}>
      {children}
    </PrivacyMaskContext.Provider>
  );
}

export function usePrivacyMask(): PrivacyMaskContextValue {
  return useContext(PrivacyMaskContext);
}

export function PrivacyValue({
  value,
  kind = 'currency',
  currency,
  style,
  title: rawTitle,
  ...rest
}: PrivacyValueProps) {
  const { isMasked } = usePrivacyMask();
  const skipMask = isNonCurrencyToken(value, kind, currency);
  const shouldMask = isMasked && !skipMask;
  const displayText = shouldMask ? formatMaskedCurrency(value, currency) : String(value);

  return (
    <span
      {...rest}
      title={shouldMask ? undefined : rawTitle}
      data-fui="privacy-value"
      data-privacy-kind={kind}
      data-privacy-masked={shouldMask ? 'true' : 'false'}
      style={{
        borderRadius: '0px',
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {displayText}
    </span>
  );
}

export function PrivacyMaskToggle({
  label = 'PRIVACY',
  variant = 'secondary',
  size = 'sm',
  style,
  ...rest
}: PrivacyMaskToggleProps) {
  const { isMasked, toggleMask } = usePrivacyMask();

  return (
    <FuiButton
      {...rest}
      variant={isMasked ? 'primary' : variant}
      size={size}
      onClick={toggleMask}
      data-testid="fui-privacy-toggle"
      data-privacy-active={isMasked ? 'true' : 'false'}
      aria-pressed={isMasked}
      aria-label={isMasked ? 'Disable privacy mask' : 'Enable privacy mask'}
      style={{
        borderRadius: '0px',
        fontSize: '12px',
        ...style,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        style={{ marginRight: label ? '6px' : '0px', flexShrink: 0 }}
      >
        <path
          d="M1.5 8C3.2 4.8 5.5 3.5 8 3.5C10.5 3.5 12.8 4.8 14.5 8C12.8 11.2 10.5 12.5 8 12.5C5.5 12.5 3.2 11.2 1.5 8Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
        {isMasked && <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" />}
      </svg>
      <span>{label}</span>
    </FuiButton>
  );
}
