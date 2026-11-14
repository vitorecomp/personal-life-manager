import React, { useId } from 'react';
import { FUI_TOKENS } from '../tokens';

export interface FuiInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  prefixSlot?: React.ReactNode;
  suffixSlot?: React.ReactNode;
  mono?: boolean;
}

export interface FuiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FuiSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options?: readonly FuiSelectOption[];
}

export function FuiInput({
  id,
  label,
  hint,
  error,
  prefixSlot,
  suffixSlot,
  mono = true,
  style,
  ...rest
}: FuiInputProps) {
  const autoId = useId();
  const inputId = id ?? `fui-input-${autoId}`;
  const descId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  const borderHex = error ? FUI_TOKENS.accentVermilion : FUI_TOKENS.borderHairline;

  return (
    <div data-fui="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: FUI_TOKENS.inkMuted,
            borderRadius: '0px',
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${borderHex}`,
          borderRadius: '0px',
          minHeight: '34px',
        }}
      >
        {prefixSlot && (
          <span
            data-fui-part="input-prefix"
            style={{
              padding: '0 8px',
              color: FUI_TOKENS.inkMuted,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            {prefixSlot}
          </span>
        )}
        <input
          {...rest}
          id={inputId}
          data-fui="input"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={descId}
          style={{
            flex: 1,
            minHeight: '32px',
            padding: '6px 10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            color: FUI_TOKENS.inkStark,
            border: 'none',
            outline: 'none',
            fontFamily: mono ? FUI_TOKENS.fontMono : FUI_TOKENS.fontSans,
            fontSize: '13px',
            ...style,
            borderRadius: '0px',
          }}
        />
        {suffixSlot && (
          <span
            data-fui-part="input-suffix"
            style={{
              padding: '0 8px',
              color: FUI_TOKENS.inkMuted,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            {suffixSlot}
          </span>
        )}
      </div>
      {error ? (
        <span
          id={descId}
          role="alert"
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentVermilion,
            borderRadius: '0px',
          }}
        >
          {error}
        </span>
      ) : hint ? (
        <span
          id={descId}
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.inkMuted,
            borderRadius: '0px',
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function FuiSelect({
  id,
  label,
  hint,
  error,
  options,
  children,
  style,
  ...rest
}: FuiSelectProps) {
  const autoId = useId();
  const selectId = id ?? `fui-select-${autoId}`;
  const descId = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;
  const borderHex = error ? FUI_TOKENS.accentVermilion : FUI_TOKENS.borderHairline;

  return (
    <div data-fui="select-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
      {label && (
        <label
          htmlFor={selectId}
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: FUI_TOKENS.inkMuted,
            borderRadius: '0px',
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${borderHex}`,
          borderRadius: '0px',
          minHeight: '34px',
        }}
      >
        <select
          {...rest}
          id={selectId}
          data-fui="select"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={descId}
          style={{
            flex: 1,
            minHeight: '32px',
            padding: '6px 32px 6px 10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            color: FUI_TOKENS.inkStark,
            border: 'none',
            outline: 'none',
            appearance: 'none',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '13px',
            ...style,
            borderRadius: '0px',
          }}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <span
          aria-hidden="true"
          data-fui-part="select-indicator"
          style={{
            position: 'absolute',
            right: '0px',
            top: '0px',
            bottom: '0px',
            width: '28px',
            borderLeft: `1px solid ${borderHex}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            borderRadius: '0px',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 7L8 3.5Z" fill={FUI_TOKENS.inkStark} />
          </svg>
        </span>
      </div>
      {error ? (
        <span
          id={descId}
          role="alert"
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentVermilion,
            borderRadius: '0px',
          }}
        >
          {error}
        </span>
      ) : hint ? (
        <span
          id={descId}
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.inkMuted,
            borderRadius: '0px',
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}
