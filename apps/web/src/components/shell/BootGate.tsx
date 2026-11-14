import React, { useEffect, useState } from 'react';
import { FuiButton, OrbitalBootScreen, type BootStage } from '@hermes/ui';
import { useAppStore } from '../../store/appStore';

export interface BootGateProps {
  gatewayMode?: 'online' | 'offline_mock';
}

export function BootGate({ gatewayMode = 'online' }: BootGateProps) {
  const bootDismissed = useAppStore((s) => s.bootDismissed);
  const dismissBoot = useAppStore((s) => s.dismissBoot);
  const [stage, setStage] = useState<BootStage>(1);

  useEffect(() => {
    if (bootDismissed) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        dismissBoot();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const t1 = window.setTimeout(() => setStage(2), 35);
    const t2 = window.setTimeout(() => setStage(3), 70);
    const t3 = window.setTimeout(() => dismissBoot(), 110);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [bootDismissed, dismissBoot]);

  if (bootDismissed) {
    return null;
  }

  return (
    <div data-fui-boot="true" data-testid="boot-gate-overlay" style={{ borderRadius: '0px' }}>
      <OrbitalBootScreen
        stage={stage}
        gatewayMode={gatewayMode}
        sublabel={
          gatewayMode === 'offline_mock'
            ? 'HERMES_GATEWAY // OFFLINE_MOCK'
            : 'TELEMETRY_BUS // NOMINAL'
        }
      />
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 1001,
          borderRadius: '0px',
        }}
      >
        <FuiButton
          data-testid="boot-skip-btn"
          variant="primary"
          size="sm"
          onClick={() => dismissBoot()}
        >
          [SKIP // ENTER OS]
        </FuiButton>
      </div>
    </div>
  );
}
