import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FuiBadge,
  FuiButton,
  FUI_TOKENS,
  MicroAnimIcon,
  PrivacyMaskToggle,
  SystemApertureLogo,
} from '@hermes/ui';
import { apiGet, type HealthResponse } from '../../api/client';
import { useEventStream } from '../../api/useEventStream';
import { useAppStore } from '../../store/appStore';
import { FrierenCompanionController } from '../companion/FrierenCompanionController';
import { ActiveTimerBar } from './ActiveTimerBar';
import { AuthSettingsModal } from './AuthSettingsModal';
import { BootGate } from './BootGate';
import { QuickCaptureModal } from './QuickCaptureModal';

export interface AppShellProps {
  pathname: string;
  onNavigate: (to: string) => void;
  children: React.ReactNode;
}

export interface NavSubItem {
  id: string;
  key: string;
  path: string;
  to: string;
  label: string;
  code: string;
  testId: string;
}

export interface NavItem {
  id: string;
  path: string;
  to: string;
  label: string;
  code: string;
  subItems?: ReadonlyArray<NavSubItem>;
  children?: ReadonlyArray<NavSubItem>;
}

export const FINANCE_SUB_ITEMS: ReadonlyArray<NavSubItem> = [
  {
    id: 'finance-retirement',
    key: 'retirement',
    path: '/finance/retirement',
    to: '/finance/retirement',
    label: 'Retirement',
    code: '11A',
    testId: 'nav-link-finance-retirement',
  },
  {
    id: 'finance-stock-cycle',
    key: 'stock-cycle',
    path: '/finance/stock-cycle',
    to: '/finance/stock-cycle',
    label: 'Stock Cycle',
    code: '11B',
    testId: 'nav-link-finance-stock-cycle',
  },
];

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: 'dashboard', path: '/dashboard', to: '/dashboard', label: 'DASHBOARD', code: '03' },
  { id: 'monitor', path: '/monitor', to: '/monitor', label: 'MONITOR', code: '03K' },
  { id: 'hermes', path: '/hermes', to: '/hermes', label: 'HERMES', code: '04' },
  { id: 'agents', path: '/agents', to: '/agents', label: 'KNIGHTS', code: '05' },
  { id: 'todos', path: '/todos', to: '/todos', label: 'TODOS', code: '07' },
  { id: 'routines', path: '/routines', to: '/routines', label: 'ROUTINES', code: '08' },
  { id: 'goals', path: '/goals', to: '/goals', label: 'GOALS', code: '09' },
  { id: 'courses', path: '/courses', to: '/courses', label: 'COURSES', code: '10' },
  {
    id: 'finance',
    path: '/finance',
    to: '/finance',
    label: 'FINANCE',
    code: '11',
    subItems: FINANCE_SUB_ITEMS,
    children: FINANCE_SUB_ITEMS,
  },
];

export function AppShell({ pathname, onNavigate, children }: AppShellProps) {
  useEventStream();

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem('hermes-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebarCollapsed = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('hermes-sidebar-collapsed', String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const setQuickCaptureOpen = useAppStore((s) => s.setQuickCaptureOpen);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const companionOpen = useAppStore((s) => s.companionOpen);
  const setCompanionOpen = useAppStore((s) => s.setCompanionOpen);
  const isAssistantStreaming = useAppStore((s) => s.isAssistantStreaming);

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      try {
        return await apiGet<HealthResponse>('/api/health');
      } catch {
        return {
          status: 'ok',
          db_online: true,
          hermes_gateway: 'offline_mock',
        } satisfies HealthResponse;
      }
    },
    refetchInterval: 15000,
  });

  const gatewayMode: 'online' | 'offline_mock' =
    health?.hermes_gateway === 'offline_mock' ? 'offline_mock' : 'online';
  const dbOnline = health?.db_online !== false;
  const isKioskMonitor = pathname === '/monitor';

  const routeBg =
    pathname.startsWith('/agents') || pathname.startsWith('/knights')
      ? FUI_TOKENS.bgArena
      : pathname.startsWith('/goals')
        ? FUI_TOKENS.bgBlueprint
        : FUI_TOKENS.bgCarbon;

  return (
    <div
      data-testid="hermes-web-shell"
      data-fui-ready="true"
      data-fui-canvas="true"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: routeBg,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        borderRadius: '0px',
      }}
    >
      <BootGate gatewayMode={gatewayMode} />

      {/* Full-Height Left Collapsible Navigation Sidebar */}
      <aside
        data-testid="app-shell-sidebar"
        data-position="left"
        data-collapsed={sidebarCollapsed ? 'true' : 'false'}
        aria-label="Module Navigation Sidebar"
        style={{
          width: sidebarCollapsed ? '60px' : isKioskMonitor ? '180px' : '216px',
          minHeight: '100vh',
          alignSelf: 'stretch',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '12px',
          padding: sidebarCollapsed ? '10px 6px' : isKioskMonitor ? '10px 8px' : '12px 10px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          borderRight: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarCollapsed ? 'center' : 'space-between',
              gap: '6px',
              padding: '0 2px 8px 2px',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: FUI_TOKENS.inkMuted,
              borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            {!sidebarCollapsed && <span>MODULES [03–11]</span>}
            <button
              type="button"
              data-testid="sidebar-collapse-toggle"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
              title={sidebarCollapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
              onClick={toggleSidebarCollapsed}
              style={{
                padding: '4px 6px',
                fontSize: '12px',
                fontFamily: FUI_TOKENS.fontMono,
                fontWeight: 700,
                color: FUI_TOKENS.inkStark,
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
                cursor: 'pointer',
              }}
            >
              {sidebarCollapsed ? '»' : '«'}
            </button>
          </div>

          {/* Primary CSR Navigation */}
          <nav
            aria-label="Primary Module Navigation"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '4px',
              borderRadius: '0px',
            }}
          >
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.path ||
                (item.path !== '/dashboard' && pathname.startsWith(`${item.path}/`)) ||
                (item.path === '/dashboard' && pathname.startsWith('/dashboard/'));
              return (
                <div
                  key={item.path}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    borderRadius: '0px',
                  }}
                >
                  <a
                    href={item.path}
                    data-testid={`nav-link-${item.label.toLowerCase()}`}
                    aria-label={item.label}
                    title={`${item.label} [${item.code}]`}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => {
                      if (
                        e.button === 0 &&
                        !e.metaKey &&
                        !e.ctrlKey &&
                        !e.shiftKey &&
                        !e.altKey
                      ) {
                        e.preventDefault();
                        onNavigate(item.path);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: sidebarCollapsed ? 'center' : 'space-between',
                      gap: '6px',
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: sidebarCollapsed ? '8px 4px' : '8px 10px',
                      fontSize: '12px',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontWeight: active ? 700 : 500,
                      textDecoration: 'none',
                      backgroundColor: active ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgPanel,
                      color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${active ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                      borderLeft: active
                        ? `3px solid ${FUI_TOKENS.inkStark}`
                        : `3px solid ${FUI_TOKENS.accentOrange}`,
                      borderRadius: '0px',
                    }}
                  >
                    {!sidebarCollapsed && (
                      <span style={{ fontSize: '12px', borderRadius: '0px' }}>{item.label}</span>
                    )}
                    <span
                      aria-hidden={!sidebarCollapsed}
                      style={{ fontSize: '12px', borderRadius: '0px' }}
                    >
                      [{item.code}]
                    </span>
                  </a>

                  {!sidebarCollapsed && item.subItems && item.subItems.length > 0 && (
                    <div
                      data-testid={`nav-subitems-${item.id}`}
                      role="group"
                      aria-label={`${item.label} Sub-navigation`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        paddingLeft: '12px',
                        borderLeft: `1px solid ${FUI_TOKENS.borderHairline}`,
                        marginLeft: '6px',
                        borderRadius: '0px',
                      }}
                    >
                      {item.subItems.map((sub) => {
                        const subActive =
                          sub.key === 'retirement'
                            ? pathname === '/finance' ||
                              pathname === '/finance/retirement' ||
                              pathname.startsWith('/finance/retirement/')
                            : sub.key === 'stock-cycle'
                              ? pathname === '/finance/stock-cycle' ||
                                pathname.startsWith('/finance/stock-cycle/') ||
                                pathname === '/finance/cycle'
                              : pathname === sub.path || pathname.startsWith(`${sub.path}/`);
                        return (
                          <a
                            key={sub.path}
                            href={sub.path}
                            data-testid={sub.testId}
                            data-subitem-testid={`nav-subitem-${sub.key}`}
                            data-subitem-id={sub.id}
                            aria-label={sub.label}
                            title={`${sub.label} [${sub.code}]`}
                            aria-current={subActive ? 'page' : undefined}
                            onClick={(e) => {
                              if (
                                e.button === 0 &&
                                !e.metaKey &&
                                !e.ctrlKey &&
                                !e.shiftKey &&
                                !e.altKey
                              ) {
                                e.preventDefault();
                                onNavigate(sub.path);
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '6px',
                              width: '100%',
                              boxSizing: 'border-box',
                              padding: '6px 8px',
                              fontSize: '12px',
                              fontFamily: FUI_TOKENS.fontMono,
                              fontWeight: subActive ? 700 : 500,
                              textDecoration: 'none',
                              backgroundColor: subActive
                                ? FUI_TOKENS.bgPanel
                                : FUI_TOKENS.bgCarbon,
                              color: subActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkMuted,
                              border: `1px solid ${
                                subActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                              }`,
                              borderLeft: subActive
                                ? `3px solid ${FUI_TOKENS.accentOrange}`
                                : `3px solid ${FUI_TOKENS.borderHairline}`,
                              borderRadius: '0px',
                            }}
                          >
                            <span style={{ fontSize: '12px', borderRadius: '0px' }}>
                              {sub.label}
                            </span>
                            <span style={{ fontSize: '12px', borderRadius: '0px' }}>
                              [{sub.code}]
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div
          style={{
            padding: sidebarCollapsed ? '6px 4px' : '6px 8px',
            fontSize: '12px',
            textAlign: sidebarCollapsed ? 'center' : 'left',
            color: FUI_TOKENS.inkMuted,
            backgroundColor: FUI_TOKENS.bgPanel,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          {sidebarCollapsed ? (
            <div style={{ color: FUI_TOKENS.accentCyan }}>CSR</div>
          ) : (
            <>
              <div>SYS // CSR_READY</div>
              <div style={{ color: FUI_TOKENS.accentCyan }}>ROUTE: {pathname}</div>
            </>
          )}
        </div>
      </aside>

      {/* Right Workspace Column: Header + Main Route Outlet */}
      <div
        data-testid="app-shell-workspace"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: routeBg,
          borderRadius: '0px',
        }}
      >
        <header
          data-testid="app-shell-header"
          style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: FUI_TOKENS.bgCarbon,
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          {/* Top Telemetry & Global Controls Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              padding: isKioskMonitor ? '6px 12px' : '8px 16px',
              borderRadius: '0px',
            }}
          >
            {/* Brand Identity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '0px' }}>
              <SystemApertureLogo
                size={32}
                status={dbOnline ? 'online' : 'offline'}
                isThinking={isAssistantStreaming}
                title="HERMES // OS System Aperture"
              />
              <div>
                <div
                  style={{
                    fontFamily: FUI_TOKENS.fontDisplay,
                    fontSize: '16px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: FUI_TOKENS.inkStark,
                  }}
                >
                  HERMES // OS
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                  <MicroAnimIcon variant="WIFI" size={14} active={dbOnline} />
                  <span style={{ color: dbOnline ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentVermilion }}>
                    {dbOnline ? 'DB_ONLINE' : 'DB_DEGRADED'}
                  </span>
                  <span style={{ color: FUI_TOKENS.inkMuted }}>|</span>
                  <span
                    style={{
                      color:
                        gatewayMode === 'online'
                          ? FUI_TOKENS.accentPhosphor
                          : FUI_TOKENS.accentAmber,
                    }}
                  >
                    GATEWAY:{gatewayMode.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Global Controls: ActiveTimerBar, Cmd+K, Privacy Mask, Frieren Cmd+J, Auth/QR */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '6px',
                borderRadius: '0px',
              }}
            >
              <ActiveTimerBar />

              <FuiButton
                data-testid="quick-capture-trigger"
                aria-label="Quick Capture (Cmd+K)"
                variant="primary"
                size="sm"
                onClick={() => setQuickCaptureOpen(true)}
              >
                [+ QUICK CAPTURE // CMD+K]
              </FuiButton>

              <PrivacyMaskToggle label="👁️ PRIVACY" />

              <FuiButton
                data-testid="companion-popover-trigger"
                variant="secondary"
                size="sm"
                onClick={() => setCompanionOpen(!companionOpen)}
              >
                [FRIEREN // CMD+J]
              </FuiButton>

              <FuiButton
                data-testid="auth-settings-trigger"
                variant="secondary"
                size="sm"
                onClick={() => setAuthModalOpen(true)}
              >
                [UPLINK // AUTH]
              </FuiButton>
            </div>
          </div>

          {/* Omnipresent 3px #F87C18 Frieren Ledge */}
          <FrierenCompanionController
            mode="ledge"
            pathname={pathname}
            dbOnline={dbOnline}
            gatewayMode={gatewayMode}
            onNavigate={onNavigate}
          />
        </header>

        {/* Main Route Outlet */}
        <main
          role="main"
          data-testid="app-shell-body"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: routeBg,
            borderRadius: '0px',
          }}
        >
          {children}
        </main>
      </div>

      {/* Global Modals & Omnipresent Frieren Popover */}
      <QuickCaptureModal />
      <AuthSettingsModal />
      <FrierenCompanionController
        mode="popover"
        pathname={pathname}
        dbOnline={dbOnline}
        gatewayMode={gatewayMode}
        onNavigate={onNavigate}
      />
    </div>
  );
}
