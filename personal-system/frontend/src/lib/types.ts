export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  project: string;
  tags: string[];
  due_date?: string;
  estimated_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  project?: string;
  search?: string;
}

export type TimeCategory = 'deep_work' | 'maintenance' | 'learning' | 'admin' | 'health';

export interface TimeSession {
  id: string;
  task_id?: string;
  task_title: string;
  project: string;
  category: TimeCategory;
  started_at: string;
  ended_at?: string;
  duration_seconds: number;
  notes: string;
  tags: string[];
}

export interface ActiveTimer {
  task_id?: string;
  task_title: string;
  project: string;
  category: TimeCategory;
  started_at: string;
  is_running: boolean;
}

export interface TimeStats {
  today_seconds: number;
  this_week_seconds: number;
  by_category: Record<string, number>;
  by_project: Record<string, number>;
}

export type ServerStatus = 'online' | 'degraded' | 'offline' | 'unknown';
export type CheckType = 'tcp' | 'http';

export interface ServerNode {
  id: string;
  name: string;
  host: string;
  port: number;
  check_type: CheckType;
  http_url?: string;
  status: ServerStatus;
  last_checked_at?: string;
  last_latency_ms: number;
  last_message?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ServerSummary {
  total_servers: number;
  online: number;
  degraded: number;
  offline: number;
  unknown: number;
}
