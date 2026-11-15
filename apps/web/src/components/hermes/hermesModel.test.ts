import { describe, expect, it } from 'vitest';
import {
  applySuggestion,
  describeUndoTarget,
  extractCitedNotePaths,
  formatCountdown,
  groupSessionsForRail,
  humanizeToolName,
  mentionSource,
  newHermesSessionKey,
  originLabel,
  parseComposerDraft,
  parseEditedPayload,
  readSessionMessages,
  suggestForCaret,
  summarizePayload,
  toggleMentionInDraft,
  toggleSlashCommandInDraft,
  transcriptToMarkdown,
} from './hermesModel';
import type { HermesSessionDto } from '../../api/hermes';

function makeSession(overrides: Partial<HermesSessionDto> & { session_key: string }): HermesSessionDto {
  return {
    archived: false,
    created_at: '2026-11-15T06:00:00Z',
    high_level_mode: true,
    messages_json: [],
    origin: 'hermes_view',
    pinned: false,
    title: overrides.session_key,
    updated_at: '2026-11-15T06:00:00Z',
    ...overrides,
  };
}

describe('hermesModel — pure workspace logic', () => {
  it('parses leading slash commands, @mentions, and @vault:<path> citations', () => {
    const parsed = parseComposerDraft(
      '/deep-plan Cross-check @vault:01-inbox/weekly-note.md with @todos and @finance!',
    );
    expect(parsed.slashCommand).toBe('/deep-plan');
    expect(parsed.commandActivatesOrb).toBe(true);
    expect(parsed.mentions).toEqual(['@vault:01-inbox/weekly-note.md', '@todos', '@finance']);
    expect(mentionSource('@vault:01-inbox/weekly-note.md')).toBe('vault');
    expect(mentionSource('@todos')).toBe('mcp');
    expect(mentionSource('@finance')).toBe('mcp');
  });

  it('suggests and applies @mentions and /commands at the caret position', () => {
    const cmdSuggestions = suggestForCaret('/dee', 4);
    expect(cmdSuggestions.map((s) => s.value)).toEqual(['/deep-plan']);
    const appliedCmd = applySuggestion('/dee', cmdSuggestions[0]!);
    expect(appliedCmd.draft).toBe('/deep-plan ');

    const mentionSuggestions = suggestForCaret('Check @va now', 9);
    expect(mentionSuggestions.map((s) => s.value)).toEqual(['@vault']);
    const appliedMention = applySuggestion('Check @va now', mentionSuggestions[0]!);
    expect(appliedMention.draft).toBe('Check @vault now');
  });

  it('toggles @mentions and leading /commands cleanly in the composer draft', () => {
    const withVault = toggleMentionInDraft('Review tasks', '@vault');
    expect(withVault).toBe('Review tasks @vault ');
    const removedVault = toggleMentionInDraft(withVault, '@vault');
    expect(removedVault.trim()).toBe('Review tasks');

    const withCmd = toggleSlashCommandInDraft('Audit Q4 OKRs', '/weekly-review');
    expect(withCmd).toBe('/weekly-review Audit Q4 OKRs');
    const swappedCmd = toggleSlashCommandInDraft(withCmd, '/deep-plan');
    expect(swappedCmd).toBe('/deep-plan Audit Q4 OKRs');
    const clearedCmd = toggleSlashCommandInDraft(swappedCmd, '/deep-plan');
    expect(clearedCmd).toBe('Audit Q4 OKRs');
  });

  it('buckets sessions into Pinned, Today, Previous 7 Days, Older, and Archived / Folders', () => {
    const now = new Date('2026-11-15T14:00:00');
    const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30).toISOString();
    const prev7Iso = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const olderIso = new Date(now.getTime() - 14 * 86_400_000).toISOString();

    const groups = groupSessionsForRail(
      [
        makeSession({ session_key: 'sess_pinned', pinned: true, updated_at: prev7Iso }),
        makeSession({ session_key: 'sess_today', updated_at: todayIso }),
        makeSession({ session_key: 'sess_prev7', updated_at: prev7Iso }),
        makeSession({ session_key: 'sess_older', updated_at: olderIso }),
        makeSession({ session_key: 'sess_archived', archived: true, updated_at: todayIso }),
        makeSession({ session_key: 'sess_knight', folder_name: 'Knight Runs', updated_at: todayIso }),
      ],
      now,
    );

    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
    expect(byId.pinned?.sessions.map((s) => s.session_key)).toEqual(['sess_pinned']);
    expect(byId.today?.sessions.map((s) => s.session_key)).toEqual(['sess_today']);
    expect(byId.previous7?.sessions.map((s) => s.session_key)).toEqual(['sess_prev7']);
    expect(byId.older?.sessions.map((s) => s.session_key)).toEqual(['sess_older']);
    expect(byId.archive?.count).toBe(2);
    expect(byId.archive?.folders.map((f) => f.name)).toEqual(['Knight Runs', 'Archived']);
  });

  it('normalizes persisted session messages and tool calls', () => {
    const messages = readSessionMessages({
      messages_json: [
        { role: 'user', content: 'Create a focus task' },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Created the focus task.',
          thinking: 'Routing to /mcp todo_create',
          tool_calls: [
            {
              tool_name: 'todo_create',
              arguments: { title: 'Ship F25', priority: 'high' },
              autonomy_tier: 'IMMEDIATE_UNDO',
              status: 'executed',
              undo_id: 'undo-123',
            },
          ],
          undo_ids: ['undo-123'],
        },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.thinking).toBe('Routing to /mcp todo_create');
    expect(messages[1]?.toolCalls[0]?.toolName).toBe('todo_create');
    expect(messages[1]?.toolCalls[0]?.undoId).toBe('undo-123');
  });

  it('formats MCP tool names, payloads, undo targets, countdowns, and edited JSON payloads', () => {
    expect(humanizeToolName('finance_rebalance')).toEqual({
      domain: 'FINANCE',
      action: 'REBALANCE',
    });
    expect(summarizePayload({ title: 'Audit Vault', priority: 'high', extra: 1 })).toContain(
      'title="Audit Vault"',
    );
    expect(describeUndoTarget('tasks', '0195a000-1111-7000-8000-000000000099')).toBe(
      'tasks #0195a000…0099',
    );
    expect(formatCountdown('2026-11-15T08:15:00Z', Date.parse('2026-11-15T08:05:30Z'))).toBe(
      '09:30',
    );
    expect(formatCountdown('2026-11-15T08:00:00Z', Date.parse('2026-11-15T08:05:30Z'))).toBeNull();

    expect(parseEditedPayload('{"target_weight_pct":"25"}')).toEqual({
      ok: true,
      value: { target_weight_pct: '25' },
    });
    expect(parseEditedPayload('[1,2,3]').ok).toBe(false);
    expect(parseEditedPayload('{broken').ok).toBe(false);
  });

  it('extracts safe Vault relative note paths and rejects path-traversal sequences', () => {
    const cited = extractCitedNotePaths([
      'Grounded in [VAULT NOTE: Weekly (01-inbox/2026-W46.md)] and `lists/youtube/rust-async.md`.',
      'Ignore ../secret.md and /etc/passwd.md and https://example.com/foo.md',
    ]);
    expect(cited).toEqual(['01-inbox/2026-W46.md', 'lists/youtube/rust-async.md']);
  });

  it('formats distilled Markdown transcripts and session keys', () => {
    const md = transcriptToMarkdown('Q4 Strategy', 'sess_q4', [
      { role: 'user', rawRole: 'user', content: 'Review @goals' },
      { role: 'assistant', rawRole: 'assistant', content: 'All 3 KRs are on track.' },
    ]);
    expect(md).toContain('# Q4 Strategy');
    expect(md).toContain('## Operator\n\nReview @goals');
    expect(md).toContain('## Hermes\n\nAll 3 KRs are on track.');
    expect(newHermesSessionKey()).toMatch(/^sess_[a-f0-9]+$/);
    expect(originLabel('frieren_popover')).toBe('FRIEREN');
    expect(originLabel('knight_run')).toBe('KNIGHT_RUN');
  });
});
