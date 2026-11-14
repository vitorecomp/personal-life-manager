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
      }
      if (eventType.includes('task')) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      }
      if (eventType.includes('routine')) {
        queryClient.invalidateQueries({ queryKey: ['routines'] });
        queryClient.invalidateQueries({ queryKey: ['routines-analytics'] });
      }
      if (eventType.includes('mcp') || eventType.includes('approval') || eventType.includes('undo')) {
        queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
        queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
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
        if (e.data) {
          try {
            const data = JSON.parse(e.data);
            if (data?.type) parsedType = String(data.type).toLowerCase();
          } catch {
            // Ignore non-JSON frame
          }
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
