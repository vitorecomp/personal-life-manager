import {
  Task,
  TaskFilter,
  TimeSession,
  ActiveTimer,
  TimeStats,
  ServerNode,
  ServerSummary,
} from './types';

export interface TaskFilterParams {
  status?: string;
  priority?: string;
  project?: string;
  search?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP error ${res.status}`);
    }

    if (res.status === 204) {
      return {} as T;
    }

    return await res.json();
  } catch (error: any) {
    console.error(`API Error [${path}]:`, error);
    throw error;
  }
}

export const api = {
  // Health
  getHealth: () => request<{ status: string; service: string }>('/api/health'),

  // Tasks
  getTasks: (filter?: TaskFilterParams) => {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.priority) params.set('priority', filter.priority);
    if (filter?.project) params.set('project', filter.project);
    if (filter?.search) params.set('search', filter.search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<Task[]>(`/api/tasks${qs}`);
  },
  createTask: (task: Partial<Task>) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id: string, task: Partial<Task>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(task) }),
  deleteTask: (id: string) =>
    request<{ message: string }>(`/api/tasks/${id}`, { method: 'DELETE' }),

  // Time & Timers
  getActiveTimer: () => request<ActiveTimer | null>('/api/time/timer'),
  startTimer: (timer: { task_title: string; task_id?: string; project?: string; category?: string }) =>
    request<ActiveTimer>('/api/time/timer/start', { method: 'POST', body: JSON.stringify(timer) }),
  stopTimer: (notes: string = '') =>
    request<TimeSession>('/api/time/timer/stop', { method: 'POST', body: JSON.stringify({ notes }) }),
  discardTimer: () =>
    request<{ message: string }>('/api/time/timer/discard', { method: 'POST' }),
  getSessions: (limit: number = 30) =>
    request<TimeSession[]>(`/api/time/sessions?limit=${limit}`),
  getTimeStats: () => request<TimeStats>('/api/time/stats'),

  // Servers
  getServers: () => request<ServerNode[]>('/api/servers'),
  createServer: (server: Partial<ServerNode>) =>
    request<ServerNode>('/api/servers', { method: 'POST', body: JSON.stringify(server) }),
  updateServer: (id: string, server: Partial<ServerNode>) =>
    request<ServerNode>(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(server) }),
  deleteServer: (id: string) =>
    request<{ message: string }>(`/api/servers/${id}`, { method: 'DELETE' }),
  checkServer: (id: string) =>
    request<ServerNode>(`/api/servers/${id}/check`, { method: 'POST' }),
  getServerSummary: () => request<ServerSummary>('/api/servers/summary'),
};
