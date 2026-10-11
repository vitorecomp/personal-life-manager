'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Task, TimeStats, ServerSummary, ActiveTimer } from '@/lib/types';
import {
  Clock,
  CheckSquare,
  Server,
  Play,
  Square,
  ArrowRight,
  Activity,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeStats, setTimeStats] = useState<TimeStats | null>(null);
  const [serverSummary, setServerSummary] = useState<ServerSummary | null>(null);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      await api.getHealth();
      setBackendOnline(true);

      const [taskList, stats, servers, timer] = await Promise.all([
        api.getTasks(),
        api.getTimeStats().catch(() => null),
        api.getServerSummary().catch(() => null),
        api.getActiveTimer().catch(() => null),
      ]);

      setTasks(taskList);
      setTimeStats(stats);
      setServerSummary(servers);
      setActiveTimer(timer?.is_running ? timer : null);
    } catch {
      setBackendOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleStartTimer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    try {
      const timer = await api.startTimer({
        task_title: quickTitle,
        category: 'deep_work',
        project: 'General',
      });
      setActiveTimer(timer);
      setQuickTitle('');
    } catch (err) {
      console.error('Failed to start timer:', err);
    }
  };

  const handleStopTimer = async () => {
    try {
      await api.stopTimer('Stopped from dashboard');
      setActiveTimer(null);
      loadData();
    } catch (err) {
      console.error('Failed to stop timer:', err);
    }
  };

  const formatSeconds = (sec: number) => {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const pendingTasks = tasks.filter((t) => t.status !== 'done');

  return (
    <div className="space-y-8">
      {/* Top Banner / System Health */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Operational Overview
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Second Brain command center: tracking time, managing tasks, and monitoring server nodes.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {backendOnline === true && (
            <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>
              Backend API Online (8080)
            </div>
          )}
          {backendOnline === false && (
            <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
              Backend Offline (Run `make run` in backend)
            </div>
          )}
        </div>
      </div>

      {/* Primary KPI Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Time Metric */}
        <Link
          href="/time"
          className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-indigo-500/50 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Clock className="w-5 h-5" />
            </span>
            <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-indigo-500 transition-colors" />
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Time Tracked Today</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
              {timeStats ? formatSeconds(timeStats.today_seconds) : '0m'}
            </p>
            <p className="text-xs text-zinc-400 mt-1">
              {timeStats ? `${formatSeconds(timeStats.this_week_seconds)} this week` : 'No sessions recorded yet'}
            </p>
          </div>
        </Link>

        {/* Tasks Metric */}
        <Link
          href="/tasks"
          className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-indigo-500/50 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <CheckSquare className="w-5 h-5" />
            </span>
            <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-blue-500 transition-colors" />
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Active Tasks</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
              {pendingTasks.length} <span className="text-sm font-normal text-zinc-400">pending</span>
            </p>
            <p className="text-xs text-zinc-400 mt-1">
              {tasks.filter((t) => t.status === 'done').length} completed
            </p>
          </div>
        </Link>

        {/* Server Metric */}
        <Link
          href="/servers"
          className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-indigo-500/50 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <Server className="w-5 h-5" />
            </span>
            <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-emerald-500 transition-colors" />
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Monitored Infrastructure</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-1">
              {serverSummary?.online || 0}{' '}
              <span className="text-sm font-normal text-zinc-400">
                / {serverSummary?.total_servers || 0} nodes healthy
              </span>
            </p>
            <p className="text-xs text-zinc-400 mt-1">
              {serverSummary?.offline ? `${serverSummary.offline} offline` : 'All registered servers online'}
            </p>
          </div>
        </Link>
      </div>

      {/* Quick Focus Session Widget */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-purple-500/5 to-transparent border border-indigo-500/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" />
              Focus & Time Session
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {activeTimer
                ? `Currently recording focus time for: "${activeTimer.task_title}"`
                : 'Start a focus session right now to track deep work.'}
            </p>
          </div>

          {activeTimer ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center space-x-2 text-sm font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                <span>Active Timer Running</span>
              </div>
              <button
                onClick={handleStopTimer}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition shadow-sm"
              >
                <Square className="w-3.5 h-3.5" />
                Stop & Save
              </button>
            </div>
          ) : (
            <form onSubmit={handleStartTimer} className="flex items-center gap-2">
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="What are you working on?"
                className="px-3.5 py-2 rounded-xl text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
              />
              <button
                type="submit"
                disabled={!quickTitle.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition shadow-sm"
              >
                <Play className="w-3.5 h-3.5" />
                Start Focus
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Two Column Layout: Urgent Tasks & Server Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Priority Tasks */}
        <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-blue-500" />
              Tasks & Next Actions
            </h3>
            <Link href="/tasks" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              View all tasks →
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {pendingTasks.slice(0, 4).map((task) => (
              <div
                key={task.id}
                className="p-3.5 rounded-xl border border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-800/30 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{task.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                      {task.project}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium ${
                        task.priority === 'urgent'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                          : task.priority === 'high'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {task.priority}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono text-zinc-400 capitalize">{task.status.replace('_', ' ')}</span>
              </div>
            ))}

            {pendingTasks.length === 0 && (
              <div className="text-center py-6 text-sm text-zinc-400">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/60 mb-2" />
                No active tasks pending!
              </div>
            )}
          </div>
        </div>

        {/* Infrastructure Monitoring Snapshot */}
        <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-500" />
              Server Infrastructure Status
            </h3>
            <Link href="/servers" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              Manage servers →
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">Continuous Health Prober</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Background worker checks TCP & HTTP endpoints every 30s.
                  </p>
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Active
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center pt-2">
              <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/40 dark:border-emerald-800/30">
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Online</p>
                <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                  {serverSummary?.online || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-800/30">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Degraded</p>
                <p className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1">
                  {serverSummary?.degraded || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/40 dark:border-rose-800/30">
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Offline</p>
                <p className="text-xl font-bold text-rose-700 dark:text-rose-300 mt-1">
                  {serverSummary?.offline || 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
