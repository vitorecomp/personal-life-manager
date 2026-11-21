import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useEventStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      return undefined;
    }

    let source: EventSource | null = null;
    try {
      source = new window.EventSource('/api/events/stream');
    } catch {
      return undefined;
    }

    const handleInvalidateAll = (eventType: string) => {
      if (eventType.includes('dashboard') || eventType.includes('widget')) {
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        queryClient.invalidateQueries({ queryKey: ['life-score'] });
      }
      if (eventType.includes('server')) {
        queryClient.invalidateQueries({ queryKey: ['servers'] });
        queryClient.invalidateQueries({ queryKey: ['servers-summary'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      }
      if (eventType.includes('timer')) {
        queryClient.invalidateQueries({ queryKey: ['active-timer'] });
        queryClient.invalidateQueries({ queryKey: ['time-stats'] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['tasks-capacity'] });
        queryClient.invalidateQueries({ queryKey: ['tasks-flow'] });
        queryClient.invalidateQueries({ queryKey: ['time-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['ideal-week'] });
        queryClient.invalidateQueries({ queryKey: ['weekly-review'] });
      }
      if (eventType.includes('task')) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['tasks-flow'] });
        queryClient.invalidateQueries({ queryKey: ['tasks-capacity'] });
        queryClient.invalidateQueries({ queryKey: ['time-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['weekly-review'] });
        queryClient.invalidateQueries({ queryKey: ['goals'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        queryClient.invalidateQueries({ queryKey: ['life-score'] });
      }
      if (eventType.includes('routine')) {
        queryClient.invalidateQueries({ queryKey: ['routines'] });
        queryClient.invalidateQueries({ queryKey: ['routines-analytics'] });
        queryClient.invalidateQueries({ queryKey: ['ideal-week'] });
        queryClient.invalidateQueries({ queryKey: ['daily-checkin'] });
        queryClient.invalidateQueries({ queryKey: ['weekly-review'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        queryClient.invalidateQueries({ queryKey: ['life-score'] });
      }
      if (eventType.includes('mcp') || eventType.includes('approval') || eventType.includes('undo')) {
        queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
        queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
        queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['hermes-session'] });
      }
      if (eventType.includes('knight') || eventType.includes('agent')) {
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        queryClient.invalidateQueries({ queryKey: ['agents-queue'] });
        queryClient.invalidateQueries({ queryKey: ['agent-runs'] });
        queryClient.invalidateQueries({ queryKey: ['agent-run-detail'] });
        queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
        queryClient.invalidateQueries({ queryKey: ['hermes-sessions-sync'] });
      }
      if (
        eventType.includes('youtube') ||
        eventType.includes('vault') ||
        eventType.includes('course') ||
        eventType.includes('review')
      ) {
        queryClient.invalidateQueries({ queryKey: ['vault-notes'] });
        queryClient.invalidateQueries({ queryKey: ['courses'] });
        queryClient.invalidateQueries({ queryKey: ['courses-youtube'] });
        queryClient.invalidateQueries({ queryKey: ['courses-spaced-reviews'] });
        queryClient.invalidateQueries({ queryKey: ['course-detail'] });
        queryClient.invalidateQueries({ queryKey: ['goals'] });
        queryClient.invalidateQueries({ queryKey: ['goals-blueprint'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        queryClient.invalidateQueries({ queryKey: ['life-score'] });
      }
      if (
        eventType.includes('portfolio') ||
        eventType.includes('finance') ||
        eventType.includes('quote') ||
        eventType.includes('asset')
      ) {
        queryClient.invalidateQueries({ queryKey: ['finance-assets'] });
        queryClient.invalidateQueries({ queryKey: ['finance-allocation'] });
        queryClient.invalidateQueries({ queryKey: ['finance-retirement'] });
        queryClient.invalidateQueries({ queryKey: ['finance-monthly-plans'] });
        queryClient.invalidateQueries({ queryKey: ['finance-candles'] });
        queryClient.invalidateQueries({ queryKey: ['finance-snapshots'] });
        queryClient.invalidateQueries({ queryKey: ['goals'] });
        queryClient.invalidateQueries({ queryKey: ['goals-blueprint'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        queryClient.invalidateQueries({ queryKey: ['life-score'] });
        queryClient.invalidateQueries({ queryKey: ['companion-nudges'] });
      }
      if (eventType.includes('goal') || eventType.includes('okr') || eventType.includes('cycle')) {
        queryClient.invalidateQueries({ queryKey: ['goals'] });
        queryClient.invalidateQueries({ queryKey: ['goals-blueprint'] });
        queryClient.invalidateQueries({ queryKey: ['goals-cycles'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        queryClient.invalidateQueries({ queryKey: ['life-score'] });
        queryClient.invalidateQueries({ queryKey: ['companion-nudges'] });
      }
      if (eventType.includes('companion') || eventType.includes('nudge')) {
        queryClient.invalidateQueries({ queryKey: ['companion-nudges'] });
      }
    };

    const eventNames = [
      'dashboard_updated',
      'widget_refreshed',
      'server_status_changed',
      'timer_updated',
      'task_mutated',
      'routine_logged',
      'youtube_crawler_synced',
      'portfolio_price_alert',
      'goal_pace_at_risk',
      'knight_run_updated',
      'mcp_approval_required',
      'mcp_undo_available',
      'companion_nudge',
      'system_event',
      'message',
    ];

    const listeners: Array<{ name: string; fn: (e: MessageEvent) => void }> = [];

    for (const name of eventNames) {
      const fn = (e: MessageEvent) => {
        let parsedType = name;
        let parsedData: Record<string, unknown> | null = null;
        if (e.data) {
          try {
            const data = JSON.parse(e.data);
            if (data && typeof data === 'object') {
              parsedData = data as Record<string, unknown>;
              if (data.type) parsedType = String(data.type).toLowerCase();
            }
          } catch {
            // Ignore non-JSON frame
          }
        }
        if (parsedType === 'knight_run_updated' && parsedData) {
          const rawAgentId = parsedData.agent_id ?? parsedData.agentId;
          const rawAgentSlug = parsedData.agent_slug ?? parsedData.agentSlug;
          const rawRunId = parsedData.run_id ?? parsedData.runId;
          const normAgentId =
            rawAgentId !== undefined && rawAgentId !== null ? String(rawAgentId) : undefined;
          const normAgentSlug =
            rawAgentSlug !== undefined && rawAgentSlug !== null ? String(rawAgentSlug) : undefined;
          const normRunId =
            rawRunId !== undefined && rawRunId !== null ? String(rawRunId) : undefined;
          queryClient.setQueryData(['knight-live-cast'], {
            ...parsedData,
            agent_id: normAgentId,
            agentId: normAgentId,
            agent_slug: normAgentSlug,
            agentSlug: normAgentSlug,
            run_id: normRunId,
            runId: normRunId,
            status: parsedData.status ? String(parsedData.status) : 'running',
            receivedAt: Date.now(),
          });
        }
        handleInvalidateAll(parsedType);
      };
      source.addEventListener(name, fn as EventListener);
      listeners.push({ name, fn });
    }

    return () => {
      if (source) {
        for (const l of listeners) {
          source.removeEventListener(l.name, l.fn as EventListener);
        }
        source.close();
      }
    };
  }, [queryClient]);
}
