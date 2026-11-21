import React from 'react';
import { FUI_TOKENS } from '../tokens';

export type FuiButtonVariant = 'primary' | 'stark' | 'secondary' | 'ghost' | 'danger' | 'cyan';
export type FuiButtonSize = 'sm' | 'md' | 'lg';

export interface FuiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: FuiButtonVariant;
  size?: FuiButtonSize;
  prefixBadge?: '+' | '>' | React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<FuiButtonVariant, { bg: string; color: string; border: string }> = {
  primary: {
    bg: FUI_TOKENS.accentOrange,
    color: FUI_TOKENS.bgCarbon,
    border: `1px solid ${FUI_TOKENS.accentOrange}`,
  },
  stark: {
    bg: FUI_TOKENS.inkStark,
    color: FUI_TOKENS.bgCarbon,
    border: `1px solid ${FUI_TOKENS.inkStark}`,
  },
  secondary: {
    bg: FUI_TOKENS.bgPanel,
    color: FUI_TOKENS.inkStark,
    border: `1px solid ${FUI_TOKENS.borderHairline}`,
  },
  ghost: {
    bg: 'transparent',
    color: FUI_TOKENS.inkProse,
    border: '1px solid transparent',
  },
  danger: {
    bg: '#2A0D08',
    color: FUI_TOKENS.inkStark,
    border: `1px solid ${FUI_TOKENS.accentVermilion}`,
  },
  cyan: {
    bg: '#092229',
    color: FUI_TOKENS.accentCyan,
    border: `1px solid ${FUI_TOKENS.accentCyan}`,
  },
};

export function FuiButton({
  variant = 'secondary',
  size = 'md',
  prefixBadge,
  loading = false,
  fullWidth = false,
  disabled,
  type = 'button',
  children,
  style,
  ...rest
}: FuiButtonProps) {
  const palette = VARIANT_STYLES[variant] ?? VARIANT_STYLES.secondary;
  const fontSize = size === 'lg' ? '14px' : '12px';
  const minHeight = size === 'sm' ? '28px' : size === 'lg' ? '42px' : '34px';
  const padding = size === 'sm' ? '4px 10px' : size === 'lg' ? '8px 16px' : '6px 12px';
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      {...rest}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-fui="button"
      data-variant={variant}
      data-size={size}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        width: fullWidth ? '100%' : undefined,
        minHeight,
        padding,
        backgroundColor: palette.bg,
        color: palette.color,
        border: palette.border,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.55 : 1,
        ...style,
        borderRadius: '0px',
      }}
    >
      {prefixBadge && (
        <span
          data-fui-part="button-prefix"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '14px',
            height: '14px',
            backgroundColor: variant === 'primary' || variant === 'stark' ? FUI_TOKENS.bgCarbon : FUI_TOKENS.accentOrange,
            color: variant === 'primary' || variant === 'stark' ? FUI_TOKENS.inkStark : FUI_TOKENS.bgCarbon,
            borderRadius: '0px',
            fontSize: '12px',
            fontWeight: 700,
          }}
        >
          {prefixBadge}
        </span>
      )}
      {loading && (
        <span
          data-fui-part="button-spinner"
          aria-hidden="true"
          style={{
            width: '10px',
            height: '10px',
            border: `1.5px solid ${palette.color}`,
            borderTopColor: 'transparent',
            borderRadius: '0px',
            display: 'inline-block',
          }}
        />
      )}
      {children}
    </button>
  );
}
