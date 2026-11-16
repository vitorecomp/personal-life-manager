import React, { useMemo, useRef, useState } from 'react';
import {
  applySuggestion,
  HERMES_MENTIONS,
  HERMES_SLASH_COMMANDS,
  parseComposerDraft,
  suggestForCaret,
  toggleMentionInDraft,
  toggleSlashCommandInDraft,
  type ComposerSuggestion,
} from './hermesModel';

export interface ComposerProps {
  value: string;
  onChange: (nextValue: string) => void;
  onSend: (messageText?: string) => void | Promise<void>;
  onAbort: () => void;
  streaming: boolean;
}

export function Composer({
  value,
  onChange,
  onSend,
  onAbort,
  streaming,
}: ComposerProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [caretPos, setCaretPos] = useState<number>(value.length);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);

  const parsed = useMemo(() => parseComposerDraft(value), [value]);

  const suggestions = useMemo<ComposerSuggestion[]>(
    () => suggestForCaret(value, caretPos, { includeOfflineMockOnly: true }),
    [value, caretPos],
  );

  const canSend = value.trim().length > 0 && !streaming;

  const handleToggleMention = (token: string) => {
    const next = toggleMentionInDraft(value, token);
    onChange(next);
    setCaretPos(next.length);
    textareaRef.current?.focus();
  };

  const handleToggleCommand = (command: string) => {
    const next = toggleSlashCommandInDraft(value, command);
    onChange(next);
    setCaretPos(next.length);
    textareaRef.current?.focus();
  };

  const handleSelectSuggestion = (item: ComposerSuggestion) => {
    const applied = applySuggestion(value, item);
    onChange(applied.draft);
    setCaretPos(applied.caret);
    setSelectedSuggestionIdx(0);
    window.requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(applied.caret, applied.caret);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    void onSend(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIdx((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIdx((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const chosen = suggestions[selectedSuggestionIdx] ?? suggestions[0];
        if (chosen) handleSelectSuggestion(chosen);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!canSend) return;
      void onSend(value);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="hermes-composer-form"
      className="relative border-t border-fui-border pt-2.5 space-y-2"
    >
      {/* Quick-insert @mentions & /command tactical chip bar (04:21, 04:39-57) */}
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
        <span className="text-fui-text-secondary uppercase mr-1">CONTEXT:</span>
        {HERMES_MENTIONS.map((m) => {
          const active = parsed.mentions.includes(m.token);
          return (
            <button
              key={m.token}
              type="button"
              data-testid={`hermes-chip-${m.token.slice(1)}`}
              title={m.label}
              onClick={() => handleToggleMention(m.token)}
              className={`border px-1.5 py-0.5 font-mono text-xs ${
                active
                  ? 'border-fui-cyan bg-fui-bg-elevated text-fui-cyan font-semibold'
                  : 'border-fui-border bg-fui-bg-carbon text-fui-text-secondary hover:border-fui-cyan hover:text-fui-text-primary'
              }`}
            >
              {m.token}
            </button>
          );
        })}
        <span className="text-fui-text-secondary uppercase ml-2 mr-1">DIRECTIVES:</span>
        {HERMES_SLASH_COMMANDS.map((c) => {
          const active = parsed.slashCommand === c.command;
          return (
            <button
              key={c.command}
              type="button"
              data-testid={`hermes-cmd-${c.command.slice(1)}`}
              title={c.label}
              onClick={() => handleToggleCommand(c.command)}
              className={`border px-1.5 py-0.5 font-mono text-xs ${
                active
                  ? 'border-fui-orange bg-fui-bg-elevated text-fui-orange font-semibold'
                  : 'border-fui-border bg-fui-bg-carbon text-fui-text-secondary hover:border-fui-orange hover:text-fui-text-primary'
              }`}
            >
              {c.command}
            </button>
          );
        })}
      </div>

      {/* Active parsed @mentions & /command telemetry badges */}
      {(parsed.mentions.length > 0 || parsed.slashCommand) && (
        <div
          data-testid="hermes-active-tokens"
          className="flex flex-wrap items-center gap-1.5 border border-fui-border bg-fui-bg-carbon px-2.5 py-1 font-mono text-xs"
        >
          <span className="text-fui-text-secondary">ARMED_TOKENS:</span>
          {parsed.slashCommand && (
            <span className="border border-fui-orange px-1.5 py-0.5 text-fui-orange">
              CMD {parsed.slashCommand}
            </span>
          )}
          {parsed.mentions.map((m) => (
            <span key={m} className="border border-fui-cyan px-1.5 py-0.5 text-fui-cyan">
              CTX {m}
            </span>
          ))}
        </div>
      )}

      {/* Caret Autocomplete Popup for @mentions & /commands */}
      {suggestions.length > 0 && (
        <div
          data-testid="hermes-composer-suggestions"
          role="listbox"
          aria-label="Hermes Composer Suggestions"
          className="border border-fui-cyan bg-fui-bg-carbon p-1.5 font-mono text-xs space-y-1"
        >
          <div className="flex items-center justify-between border-b border-fui-border pb-1 text-fui-text-secondary">
            <span>AUTOCOMPLETE // TAB OR CLICK TO INSERT</span>
            <span className="text-fui-cyan">[{suggestions.length}]</span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {suggestions.map((item, idx) => (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={idx === selectedSuggestionIdx}
                data-testid={`hermes-suggest-${item.value.slice(1)}`}
                onClick={() => handleSelectSuggestion(item)}
                className={`flex items-center justify-between gap-2 border px-2 py-1 text-left font-mono text-xs ${
                  idx === selectedSuggestionIdx
                    ? 'border-fui-cyan bg-fui-bg-elevated text-fui-text-primary'
                    : 'border-fui-border bg-fui-bg-panel text-fui-text-secondary hover:border-fui-cyan'
                }`}
              >
                <span className="font-semibold text-fui-cyan">{item.value}</span>
                <span className="truncate text-fui-text-secondary">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Textarea + SEND / STOP Controls */}
      <div className="flex gap-2 items-stretch">
        <textarea
          ref={textareaRef}
          data-testid="hermes-composer"
          aria-label="Hermes Chat Composer"
          rows={2}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCaretPos(e.target.selectionStart ?? e.target.value.length);
            setSelectedSuggestionIdx(0);
          }}
          onClick={(e) =>
            setCaretPos((e.target as HTMLTextAreaElement).selectionStart ?? value.length)
          }
          onKeyUp={(e) =>
            setCaretPos((e.target as HTMLTextAreaElement).selectionStart ?? value.length)
          }
          onKeyDown={handleKeyDown}
          placeholder="Ask Hermes (@vault, @youtube, @goals, @todos, @routines, @courses, @portfolio, /deep-plan, /weekly-review, /quiz-me, /rebalance, /mcp)..."
          className="flex-1 resize-none border border-fui-border bg-fui-bg-carbon px-3 py-2 font-mono text-sm text-fui-text-primary placeholder:text-fui-text-muted focus:border-fui-orange focus:outline-none"
        />

        <div className="flex flex-col gap-1.5">
          <button
            type="submit"
            data-testid="hermes-send-btn"
            disabled={!canSend}
            onClick={(e) => {
              e.preventDefault();
              if (canSend) void onSend(value);
            }}
            className="flex-1 border border-fui-orange bg-fui-orange px-4 py-2 font-mono text-xs font-bold uppercase text-fui-bg-carbon disabled:opacity-40"
          >
            {streaming ? 'STREAMING...' : 'SEND'}
          </button>
          {streaming && (
            <button
              type="button"
              data-testid="hermes-stop-btn"
              onClick={onAbort}
              className="border border-fui-red bg-fui-bg-elevated px-3 py-1 font-mono text-xs font-semibold text-fui-red hover:bg-fui-red hover:text-fui-bg-carbon"
            >
              [■ STOP]
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
