import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FuiBadge, FuiButton, FuiPanelHeader, FUI_TOKENS } from '@hermes/ui';
import {
  apiPost,
  isValidIsoCalendarDate,
  normalizeTaskEnergyLevel,
  parseQuickCaptureFallback,
  toRfc3339DueDate,
  type QuickCaptureParsed,
} from '../../api/client';
import { useAppStore } from '../../store/appStore';

export function QuickCaptureModal() {
  const open = useAppStore((s) => s.quickCaptureOpen);
  const setOpen = useAppStore((s) => s.setQuickCaptureOpen);
  const queryClient = useQueryClient();

  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<QuickCaptureParsed | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global Cmd+K / Ctrl+K & Escape listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
        setErrorMessage(null);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
        setErrorMessage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Live NLP preview
  useEffect(() => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setParsed(null);
      return undefined;
    }
    const localPreview = parseQuickCaptureFallback(trimmed);
    setParsed(localPreview);

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiPost<any>('/api/tasks/parse', {
          raw_input: trimmed,
        });
        if (!cancelled && res) {
          const data = res.data ?? res;
          const rawTags = Array.isArray(data.tags) ? data.tags : localPreview.tags;
          const dedupedTags = Array.from(
            new Set(rawTags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean)),
          );
          setParsed({
            ...localPreview,
            ...data,
            clean_title: String(data.clean_title ?? data.title ?? localPreview.clean_title),
            tags: dedupedTags,
            energy_level:
              normalizeTaskEnergyLevel(data.energy_level) ?? localPreview.energy_level,
          });
        }
      } catch {
        // Keep deterministic local preview
      }
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rawText]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rawText.trim();
    if (!trimmed) {
      setErrorMessage('[VALIDATION // TASK TITLE REQUIRED — CANNOT SUBMIT BLANK INPUT]');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      let resolved = parseQuickCaptureFallback(trimmed);
      try {
        const parseRes = await apiPost<any>('/api/tasks/parse', {
          raw_input: trimmed,
        });
        const data = parseRes?.data ?? parseRes;
        if (data && typeof data === 'object') {
          resolved = {
            ...resolved,
            ...data,
            clean_title: String(data.clean_title ?? data.title ?? resolved.clean_title),
            tags: Array.isArray(data.tags) ? data.tags : resolved.tags,
          };
        }
      } catch {
        // Fallback to local NLP
      }

      const finalTitle = (resolved.clean_title || resolved.title || trimmed).trim();
      if (!finalTitle) {
        setErrorMessage('[VALIDATION // TASK TITLE REQUIRED]');
        setIsSubmitting(false);
        return;
      }

      const uniqueTags = Array.from(
        new Set(
          (Array.isArray(resolved.tags) ? resolved.tags : [])
            .map((t) => String(t).trim().toLowerCase())
            .filter(Boolean),
        ),
      );
      const validEnergy = normalizeTaskEnergyLevel(resolved.energy_level);
      const validScheduledDate =
        resolved.scheduled_date && isValidIsoCalendarDate(String(resolved.scheduled_date).trim())
          ? String(resolved.scheduled_date).trim()
          : undefined;
      const rfcDue = toRfc3339DueDate(resolved.due_at ?? validScheduledDate);
      const rawEst = resolved.estimated_minutes ?? resolved.estimate_minutes;
      const validEstimatedMinutes =
        typeof rawEst === 'number' &&
        Number.isSafeInteger(rawEst) &&
        rawEst >= 1 &&
        rawEst <= 1440
          ? rawEst
          : undefined;

      await apiPost('/api/tasks', {
        title: finalTitle,
        quick_capture: trimmed,
        tags: uniqueTags,
        priority: resolved.priority ?? 'medium',
        energy_level: validEnergy,
        scheduled_date: validScheduledDate,
        due_date: rfcDue,
        due_at: rfcDue,
        estimated_minutes: validEstimatedMinutes,
        status: resolved.status ?? 'todo',
      });

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      setRawText('');
      setParsed(null);
      setOpen(false);
    } catch (err: any) {
      setErrorMessage(String(err?.message || 'Failed to capture task'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="quick-capture-backdrop"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 950,
        backgroundColor: 'rgba(8, 8, 11, 0.82)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        borderRadius: '0px',
      }}
    >
      <div
        data-testid="quick-capture-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Capture Task (Cmd+K)"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '640px',
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.accentOrange}`,
          color: FUI_TOKENS.inkStark,
          fontFamily: FUI_TOKENS.fontMono,
          borderRadius: '0px',
        }}
      >
        <FuiPanelHeader
          title="QUICK CAPTURE // NLP TASK INGESTION"
          code="CMD+K"
          accent="orange"
          actions={
            <FuiButton
              variant="secondary"
              size="sm"
              aria-label="Close Quick Capture"
              onClick={() => setOpen(false)}
            >
              [ESC]
            </FuiButton>
          }
        />

        <form onSubmit={handleSubmit} style={{ padding: '16px', borderRadius: '0px' }}>
          <input
            ref={inputRef}
            type="text"
            data-testid="quick-capture-input"
            placeholder="Quick Capture task... (#tag @deep_work !high tomorrow 30m)"
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              color: FUI_TOKENS.inkStark,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '14px',
              borderRadius: '0px',
            }}
          />

          <div
            data-testid="quick-capture-tokens"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              marginTop: '10px',
              minHeight: '26px',
              alignItems: 'center',
              borderRadius: '0px',
            }}
          >
            {parsed ? (
              <>
                <FuiBadge tone="stark">TITLE: {parsed.clean_title || parsed.title}</FuiBadge>
                {Array.from(new Set(parsed.tags)).map((tag) => (
                  <FuiBadge key={tag} tone="orange">
                    #{tag}
                  </FuiBadge>
                ))}
                {parsed.energy_level && (
                  <FuiBadge tone="cyan">@{parsed.energy_level}</FuiBadge>
                )}
                {parsed.priority && (
                  <FuiBadge tone="vermilion">!{parsed.priority}</FuiBadge>
                )}
                {parsed.scheduled_date && (
                  <FuiBadge tone="phosphor">DUE:{parsed.scheduled_date}</FuiBadge>
                )}
                {(parsed.estimated_minutes ?? parsed.estimate_minutes) && (
                  <FuiBadge tone="amber">
                    ~{parsed.estimated_minutes ?? parsed.estimate_minutes}m
                  </FuiBadge>
                )}
              </>
            ) : (
              <span style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted }}>
                SYNTAX // #tag +project @deep_work !high tomorrow 90m
              </span>
            )}
          </div>

          {errorMessage && (
            <div
              data-testid="quick-capture-error"
              style={{
                marginTop: '10px',
                padding: '8px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.accentVermilion,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              {errorMessage}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '14px',
              borderRadius: '0px',
            }}
          >
            <FuiButton type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </FuiButton>
            <FuiButton
              type="submit"
              data-testid="quick-capture-submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting}
            >
              Capture Task
            </FuiButton>
          </div>
        </form>
      </div>
    </div>
  );
}
