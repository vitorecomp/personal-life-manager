'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { ActiveTimer, TimeSession, TimeStats, TimeCategory } from '@/lib/types';
import {
  Clock,
  Play,
  Square,
  RotateCcw,
  Tag,
  Briefcase,
  History,
  TrendingUp,
} from 'lucide-react';

const CATEGORIES: { id: TimeCategory; label: string }[] = [
  { id: 'deep_work', label: 'Deep Work' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'learning', label: 'Learning' },
  { id: 'admin', label: 'Admin' },
  { id: 'health', label: 'Health' },
];

export default function TimePage() {
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [stats, setStats] = useState<TimeStats | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Form controls for starting a timer
  const [taskTitle, setTaskTitle] = useState('');
  const [project, setProject] = useState('Personal System');
  const [category, setCategory] = useState<TimeCategory>('deep_work');
  const [stopNotes, setStopNotes] = useState('');
  const [showStopModal, setShowStopModal] = useState(false);

  const loadData = async () => {
    try {
      const [timer, sess, timeStats] = await Promise.all([
        api.getActiveTimer(),
        api.getSessions(25),
        api.getTimeStats(),
      ]);

      if (timer?.is_running) {
        setActiveTimer(timer);
        const started = new Date(timer.started_at).getTime();
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
      } else {
        setActiveTimer(null);
        setElapsedSeconds(0);
      }

      setSessions(sess || []);
      setStats(timeStats || null);
    } catch (err) {
      console.error('Failed to load time data:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Tick elapsed time every second if active
  useEffect(() => {
    if (!activeTimer?.is_running) return;

    const interval = setInterval(() => {
      const started = new Date(activeTimer.started_at).getTime();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTimer]);

  const handleStartTimer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    try {
      const timer = await api.startTimer({
        task_title: taskTitle,
        project: project || 'General',
        category,
      });
      setActiveTimer(timer);
      setTaskTitle('');
    } catch (err) {
      console.error('Failed to start timer:', err);
    }
  };

  const handleConfirmStop = async () => {
    try {
      await api.stopTimer(stopNotes);
      setShowStopModal(false);
      setStopNotes('');
      setActiveTimer(null);
      setElapsedSeconds(0);
      loadData();
    } catch (err) {
      console.error('Failed to stop timer:', err);
    }
  };

  const handleDiscardTimer = async () => {
    if (!confirm('Are you sure you want to discard this active timer? Time will not be saved.')) {
      return;
    }
    try {
      await api.discardTimer();
      setActiveTimer(null);
      setElapsedSeconds(0);
    } catch (err) {
      console.error('Failed to discard timer:', err);
    }
  };

  const formatTimerClock = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hours.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatHumanDuration = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${totalSec % 60}s`;
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Time Administration</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Record focus sessions, analyze productivity allocations, and monitor deep work.
        </p>
      </div>

      {/* Stopwatch Hero Card */}
      <div className="p-8 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm text-center">
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          {activeTimer ? 'Active Session in Progress' : 'Focus Stopwatch'}
        </span>

        {/* Big Clock Display */}
        <div className="my-6 text-6xl sm:text-7xl font-mono font-extrabold tracking-tight text-zinc-900 dark:text-white">
          {formatTimerClock(elapsedSeconds)}
        </div>

        {activeTimer ? (
          <div className="max-w-md mx-auto space-y-4">
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                {activeTimer.task_title}
              </p>
              <div className="flex items-center justify-center gap-2 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span>{activeTimer.project}</span>
                <span>•</span>
                <span className="capitalize">{activeTimer.category.replace('_', ' ')}</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setShowStopModal(true)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium text-sm transition shadow-sm"
              >
                <Square className="w-4 h-4" />
                Finish & Save Session
              </button>

              <button
                onClick={handleDiscardTimer}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm font-medium transition"
              >
                <RotateCcw className="w-4 h-4" />
                Discard
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleStartTimer} className="max-w-xl mx-auto space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                required
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="What are you working on?"
                className="flex-1 px-4 py-2.5 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <button
                type="submit"
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition shadow-sm"
              >
                <Play className="w-4 h-4" />
                Start Timer
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                  Project
                </label>
                <input
                  type="text"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TimeCategory)}
                  className="w-full px-3 py-1.5 rounded-lg text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Aggregate Statistics */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <TrendingUp className="w-4 h-4 text-indigo-500" />
              Time by Category
            </h3>
            <div className="mt-4 space-y-2.5">
              {Object.entries(stats.by_category || {}).map(([cat, secs]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400 capitalize">
                    {cat.replace('_', ' ')}
                  </span>
                  <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                    {formatHumanDuration(secs)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <Briefcase className="w-4 h-4 text-blue-500" />
              Time by Project
            </h3>
            <div className="mt-4 space-y-2.5">
              {Object.entries(stats.by_project || {}).map(([proj, secs]) => (
                <div key={proj} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">{proj}</span>
                  <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                    {formatHumanDuration(secs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Session History Table */}
      <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <History className="w-4 h-4 text-emerald-500" />
          Recorded Sessions
        </h3>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                <th className="pb-3">Task / Activity</th>
                <th className="pb-3">Project</th>
                <th className="pb-3">Category</th>
                <th className="pb-3">Duration</th>
                <th className="pb-3">Completed At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {sessions.map((sess) => (
                <tr key={sess.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                  <td className="py-3 font-medium text-zinc-900 dark:text-white">
                    {sess.task_title}
                    {sess.notes && (
                      <p className="text-xs text-zinc-400 font-normal mt-0.5">{sess.notes}</p>
                    )}
                  </td>
                  <td className="py-3 text-zinc-600 dark:text-zinc-400">{sess.project}</td>
                  <td className="py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 capitalize">
                      {sess.category.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                    {formatHumanDuration(sess.duration_seconds)}
                  </td>
                  <td className="py-3 text-xs text-zinc-400">
                    {new Date(sess.ended_at || sess.started_at).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}

              {sessions.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-400">
                    No recorded sessions yet. Start your first session above!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Save Session Notes Modal */}
      {showStopModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Save Focus Session</h3>
            <p className="text-xs text-zinc-500">
              Add any notes or takeaways from this work block before saving.
            </p>

            <textarea
              rows={3}
              value={stopNotes}
              onChange={(e) => setStopNotes(e.target.value)}
              placeholder="What did you accomplish?"
              className="w-full px-3.5 py-2 rounded-xl text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowStopModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStop}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm"
              >
                Save Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
