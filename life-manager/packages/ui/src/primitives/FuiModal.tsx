import React, { useEffect, useId, useRef } from 'react';
import { FUI_TOKENS } from '../tokens';
import { FuiButton } from './FuiButton';
import { FuiPanelHeader, type FuiHeaderAccent } from './FuiPanel';

export interface FuiModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  code?: string;
  accent?: FuiHeaderAccent;
  maxWidthPx?: number;
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function FuiModal({
  open,
  onClose,
  title,
  code,
  accent = 'orange',
  maxWidthPx = 560,
  closeOnBackdrop = true,
  footer,
  children,
}: FuiModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    const focusTimer = setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable) {
        focusable.focus();
      } else {
        dialog.focus();
      }
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-fui="modal-backdrop"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(8, 8, 11, 0.82)',
        borderRadius: '0px',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-fui="modal"
        style={{
          width: '100%',
          maxWidth: `${maxWidthPx}px`,
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          color: FUI_TOKENS.inkStark,
          borderRadius: '0px',
        }}
      >
        <FuiPanelHeader
          title={<span id={titleId}>{title}</span>}
          code={code}
          accent={accent}
          actions={
            <FuiButton
              variant="secondary"
              size="sm"
              aria-label="Close modal"
              onClick={onClose}
              style={{ borderRadius: '0px', fontSize: '12px', padding: '2px 8px' }}
            >
              ✕
            </FuiButton>
          }
        />

        <div
          data-fui-part="modal-body"
          style={{
            padding: '16px',
            borderRadius: '0px',
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            data-fui-part="modal-footer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '8px',
              padding: '10px 16px',
              borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
              backgroundColor: FUI_TOKENS.bgCarbon,
              borderRadius: '0px',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
