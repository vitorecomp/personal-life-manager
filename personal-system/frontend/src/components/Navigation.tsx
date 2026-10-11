'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CheckSquare, Clock, Server, Brain } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ActiveTimer } from '@/lib/types';

export default function Navigation() {
  const pathname = usePathname();
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);

  useEffect(() => {
    const fetchTimer = () => {
      api.getActiveTimer()
        .then((timer) => setActiveTimer(timer?.is_running ? timer : null))
        .catch(() => setActiveTimer(null));
    };

    fetchTimer();
    const interval = setInterval(fetchTimer, 10000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Tasks', href: '/tasks', icon: CheckSquare },
    { name: 'Time Tracker', href: '/time', icon: Clock },
    { name: 'Servers', href: '/servers', icon: Server },
  ];

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            <Link href="/" className="flex items-center space-x-2 text-zinc-900 dark:text-white font-bold text-lg">
              <span className="p-1.5 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                <Brain className="w-5 h-5" />
              </span>
              <span>Personal System</span>
            </Link>

            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium">
              Second Brain
            </span>
          </div>

          <nav className="flex space-x-1 sm:space-x-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-semibold'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center space-x-3">
            {activeTimer && (
              <Link
                href="/time"
                className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium animate-pulse"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Recording: {activeTimer.task_title || 'Focus'}</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
