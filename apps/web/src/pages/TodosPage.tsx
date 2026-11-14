import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FuiBadge,
  FuiBatteryCapsule,
  FuiFigureRow,
  FuiPanel,
  FUI_TOKENS,
} from '@hermes/ui';
import { apiGet, unwrapList, type TaskRecord } from '../api/client';

export function TodosPage() {
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/tasks');
        return unwrapList<TaskRecord>(res, ['tasks']);
      } catch {
        return [];
      }
    },
  });

  const displayTasks: TaskRecord[] =
    tasks.length > 0
      ? tasks
      : [
          {
            id: 'seed-task-1',
            title: 'Calibrate Orbital Telemetry Bus',
            status: 'todo',
            priority: 'high',
            energy_level: 'deep_focus',
            estimated_minutes: 45,
          },
        ];

  return (
    <div
      data-testid="todos-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <FuiPanel
        headerTitle="TODO LIST // TERMINAL-I/O EXECUTION MATRIX (REF-04)"
        headerProps={{
          title: 'TODO LIST // TERMINAL-I/O EXECUTION MATRIX (REF-04)',
          code: 'MOD_07',
          accent: 'orange',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {displayTasks.map((task, idx) => (
            <FuiFigureRow
              key={task.id}
              code={`Fig. 1.${idx + 1}`}
              title={task.title}
              subtitle={`STATUS: ${String(task.status || 'todo').toUpperCase()} // PRIORITY: ${String(task.priority || 'medium').toUpperCase()}`}
              active={idx === 0}
              rightSlot={
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {task.energy_level && <FuiBadge tone="cyan">@{task.energy_level}</FuiBadge>}
                  <FuiBatteryCapsule progressPct={task.status === 'done' ? 100 : 50} segments={4} />
                </div>
              }
            />
          ))}
        </div>
      </FuiPanel>
    </div>
  );
}
