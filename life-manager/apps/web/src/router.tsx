import React, { useCallback, useEffect, useState } from 'react';
import { FinanceView } from './components/finance/FinanceView';
import { StockCycleView } from './components/finance/StockCycleView';
import { AppShell } from './components/shell/AppShell';
import { CoursesPage } from './pages/CoursesPage';
import { DashboardPage } from './pages/DashboardPage';
import { GoalsPage } from './pages/GoalsPage';
import { HermesPage } from './pages/HermesPage';
import { KnightsPage } from './pages/KnightsPage';
import { RoutinesPage } from './pages/RoutinesPage';
import { TodosPage } from './pages/TodosPage';

export function normalizePathname(raw: string): string {
  if (!raw || raw === '/') return '/dashboard';
  return raw;
}

function safeDecodeURIComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export interface AppRouterProps {
  initialPath?: string;
}

export function AppRouter({ initialPath }: AppRouterProps) {
  const [pathname, setPathname] = useState<string>(() => {
    if (initialPath) return normalizePathname(initialPath);
    if (typeof window === 'undefined') return '/dashboard';
    const current = window.location.pathname;
    if (current === '/' || !current) {
      try {
        window.history.replaceState(null, '', '/dashboard');
      } catch {
        // Ignore history error in restricted environments
      }
      return '/dashboard';
    }
    return current;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    (window as any).__HERMES_CSR_MARKER__ =
      (window as any).__HERMES_CSR_MARKER__ ?? 'hermes-csr-v1';

    const handlePopState = () => {
      setPathname(normalizePathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to: string) => {
    const cleanPath = to.split('?')[0] || '/dashboard';
    if (typeof window !== 'undefined') {
      try {
        window.history.pushState(null, '', to);
      } catch {
        // Ignore history error
      }
    }
    setPathname(normalizePathname(cleanPath));
  }, []);

  const renderRouteView = () => {
    if (pathname === '/monitor') {
      return <DashboardPage kioskMode onNavigate={navigate} />;
    }
    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
      const slug = pathname.startsWith('/dashboard/')
        ? safeDecodeURIComponent(pathname.slice('/dashboard/'.length))
        : undefined;
      return <DashboardPage kioskMode={false} slug={slug} onNavigate={navigate} />;
    }
    if (pathname.startsWith('/hermes')) {
      return <HermesPage />;
    }
    if (pathname.startsWith('/agents') || pathname.startsWith('/knights')) {
      return <KnightsPage />;
    }
    if (pathname.startsWith('/todos')) {
      return <TodosPage />;
    }
    if (pathname.startsWith('/routines')) {
      return <RoutinesPage />;
    }
    if (pathname.startsWith('/goals')) {
      return <GoalsPage />;
    }
    if (pathname.startsWith('/courses')) {
      return <CoursesPage />;
    }
    if (
      pathname === '/finance/stock-cycle' ||
      pathname.startsWith('/finance/stock-cycle/') ||
      pathname === '/finance/cycle'
    ) {
      return <StockCycleView />;
    }
    if (
      pathname === '/finance' ||
      pathname === '/finance/retirement' ||
      pathname.startsWith('/finance/')
    ) {
      return <FinanceView />;
    }
    return <DashboardPage kioskMode={false} onNavigate={navigate} />;
  };

  return (
    <AppShell pathname={pathname} onNavigate={navigate}>
      {renderRouteView()}
    </AppShell>
  );
}
export default AppRouter;
