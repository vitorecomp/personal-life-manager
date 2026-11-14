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

const NAV_ITEMS: ReadonlyArray<{ path: string; label: string; code: string }> = [
  { path: '/dashboard', label: 'DASHBOARD', code: '03' },
  { path: '/monitor', label: 'MONITOR', code: '03K' },
  { path: '/hermes', label: 'HERMES', code: '04' },
  { path: '/agents', label: 'KNIGHTS', code: '05' },
  { path: '/todos', label: 'TODOS', code: '07' },
  { path: '/routines', label: 'ROUTINES', code: '08' },
  { path: '/goals', label: 'GOALS', code: '09' },
  { path: '/courses', label: 'COURSES', code: '10' },
  { path: '/finance', label: 'FINANCE', code: '11' },
];

export function AppShell({ pathname, onNavigate, children }: AppShellProps) {
  useEventStream();

  const setQuickCaptureOpen = useAppStore((s) => s.setQuickCaptureOpen);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const companionOpen = useAppStore((s) => s.companionOpen);
  const setCompanionOpen = useAppStore((s) => s.setCompanionOpen);

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
        flexDirection: 'column',
        backgroundColor: routeBg,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        borderRadius: '0px',
      }}
    >
      <BootGate gatewayMode={gatewayMode} />

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
        {/* Top Telemetry & Navigation Bar */}
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
              isThinking={false}
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

          {/* Primary CSR Navigation */}
          <nav
            aria-label="Primary Module Navigation"
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
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
                <a
                  key={item.path}
                  href={item.path}
                  data-testid={`nav-link-${item.label.toLowerCase()}`}
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontWeight: active ? 700 : 500,
                    textDecoration: 'none',
                    backgroundColor: active ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgPanel,
                    color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    border: `1px solid ${active ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                    borderRadius: '0px',
                  }}
                >
                  <span aria-hidden="true">[{item.code}]</span>
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>

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
          gatewayMode={gatewayMode}
          onNavigate={onNavigate}
        />
      </header>

      {/* Main Route Outlet */}
      <main
        role="main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: routeBg,
          borderRadius: '0px',
        }}
      >
        {children}
      </main>

      {/* Global Modals & Omnipresent Frieren Popover */}
      <QuickCaptureModal />
      <AuthSettingsModal />
      <FrierenCompanionController
        mode="popover"
        pathname={pathname}
        gatewayMode={gatewayMode}
        onNavigate={onNavigate}
      />
    </div>
  );
}
