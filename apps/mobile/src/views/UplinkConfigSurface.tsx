import {
  FUI_TOKENS,
  FuiBadge,
  FuiButton,
  FuiInput,
  FuiPanel,
  FuiPanelHeader,
} from '@hermes/ui';
import React, { useEffect, useState } from 'react';
import { parsePairingQrPayload } from '../db/patCrypto';
import type { MobileUplinkConfigRow } from '../db/sqliteEngine';
import type { DeltaSyncResult, UplinkProbeResult } from '../services/uplinkSync';

export interface UplinkConfigSurfaceProps {
  config: MobileUplinkConfigRow;
  outboxCount: number;
  simulatedOffline: boolean;
  isProbingOrSyncing: boolean;
  lastProbeResult: UplinkProbeResult | null;
  lastSyncResult: DeltaSyncResult | null;
  onTestAndSaveUplink: (input: {
    primaryServerUrl: string;
    fallbackServerUrl: string;
    rawPat?: string;
  }) => Promise<void>;
  onSaveUplinkOnly: (input: {
    primaryServerUrl: string;
    fallbackServerUrl: string;
    rawPat?: string;
  }) => void;
  onSyncNow: () => Promise<void>;
  onToggleSimulatedOffline: () => void;
}

export function UplinkConfigSurface({
  config,
  outboxCount,
  simulatedOffline,
  isProbingOrSyncing,
  lastProbeResult,
  lastSyncResult,
  onTestAndSaveUplink,
  onSaveUplinkOnly,
  onSyncNow,
  onToggleSimulatedOffline,
}: UplinkConfigSurfaceProps) {
  const [primaryUrl, setPrimaryUrl] = useState<string>(config.primary_server_url);
  const [fallbackUrl, setFallbackUrl] = useState<string>(config.fallback_server_url);
  // Keep raw PAT only in ephemeral React state and clear it on save/test so plaintext never touches storage
  const [patInput, setPatInput] = useState<string>('');
  const [qrJsonText, setQrJsonText] = useState<string>('');
  const [qrImportStatus, setQrImportStatus] = useState<string | null>(null);

  // Sync controlled URL inputs when SQLite hydrates or pulls updated server URLs (never re-populate raw PAT)
  useEffect(() => {
    setPrimaryUrl(config.primary_server_url);
    setFallbackUrl(config.fallback_server_url);
  }, [config.primary_server_url, config.fallback_server_url]);

  const handleTestUplinkClick = async () => {
    const tokenToSave = patInput.trim() ? patInput.trim() : undefined;
    // Immediately clear controlled input before async work so plaintext is never lingered
    setPatInput('');
    await onTestAndSaveUplink({
      primaryServerUrl: primaryUrl,
      fallbackServerUrl: fallbackUrl,
      rawPat: tokenToSave,
    });
  };

  const handleSaveClick = () => {
    const tokenToSave = patInput.trim() ? patInput.trim() : undefined;
    setPatInput('');
    onSaveUplinkOnly({
      primaryServerUrl: primaryUrl,
      fallbackServerUrl: fallbackUrl,
      rawPat: tokenToSave,
    });
  };

  const handleImportQrPayload = async () => {
    const parsed = parsePairingQrPayload(qrJsonText);
    if (!parsed) {
      setQrImportStatus('ERROR // INVALID PAIRING QR JSON');
      return;
    }
    const nextPrimary = parsed.primaryUrl || primaryUrl;
    const nextFallback = parsed.fallbackUrl || fallbackUrl;
    setPrimaryUrl(nextPrimary);
    setFallbackUrl(nextFallback);
    setQrJsonText('');
    setPatInput('');
    setQrImportStatus(
      `IMPORTED // ${parsed.tokenName ?? 'PAIRING_QR'} (${nextPrimary || nextFallback})`,
    );

    await onTestAndSaveUplink({
      primaryServerUrl: nextPrimary,
      fallbackServerUrl: nextFallback,
      rawPat: parsed.token || undefined,
    });
  };

  return (
    <div
      data-testid="mobile-surface-uplink-config"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        borderRadius: '0px',
      }}
    >
      {/* Uplink Endpoints & Encrypted PAT Form
          CRITICAL (T3-36): The first 3 <input> elements in DOM order MUST be:
          inputs.nth(0): Primary Server URL
          inputs.nth(1): Fallback Server URL
          inputs.nth(2): Personal Access Token (plm_pat_...)
      */}
      <FuiPanel
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title="SERVER UPLINK // FAILOVER & ENCRYPTED PAT"
            code={config.uplink_status.toUpperCase()}
            accent={config.uplink_status === 'online' ? 'phosphor' : 'orange'}
          />
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          {/* Input 0: Primary Server URL */}
          <FuiInput
            data-testid="uplink-primary-url-input"
            label="PRIMARY SERVER URL (LAN / LOCAL)"
            placeholder="http://127.0.0.1:8080"
            value={primaryUrl}
            onChange={(e) => setPrimaryUrl(e.target.value)}
          />

          {/* Input 1: Fallback Server URL */}
          <FuiInput
            data-testid="uplink-fallback-url-input"
            label="FALLBACK SERVER URL (TAILSCALE / WAN)"
            placeholder="http://100.64.0.1:8080"
            value={fallbackUrl}
            onChange={(e) => setFallbackUrl(e.target.value)}
          />

          {/* Input 2: Personal Access Token */}
          <FuiInput
            data-testid="uplink-pat-input"
            type="password"
            autoComplete="off"
            label="PERSONAL ACCESS TOKEN (ENCRYPTED AT REST)"
            placeholder={
              config.token_prefix
                ? `${config.token_prefix} (STORED ENCRYPTED)`
                : 'plm_pat_0123456789abcdef...'
            }
            value={patInput}
            onChange={(e) => setPatInput(e.target.value)}
          />

          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              borderRadius: '0px',
            }}
          >
            <FuiButton
              type="button"
              variant="primary"
              data-testid="uplink-test-btn"
              disabled={isProbingOrSyncing}
              onClick={() => {
                void handleTestUplinkClick();
              }}
            >
              ⚡ TEST UPLINK
            </FuiButton>

            <FuiButton
              type="button"
              variant="secondary"
              data-testid="uplink-save-btn"
              onClick={handleSaveClick}
            >
              💾 SAVE UPLINK
            </FuiButton>

            <FuiButton
              type="button"
              variant="cyan"
              data-testid="uplink-sync-now-btn"
              disabled={isProbingOrSyncing}
              onClick={() => {
                void onSyncNow();
              }}
            >
              🔄 SYNC NOW
            </FuiButton>

            <FuiButton
              type="button"
              variant="ghost"
              data-testid="uplink-toggle-offline-btn"
              onClick={onToggleSimulatedOffline}
            >
              {simulatedOffline ? '🔌 GO ONLINE' : '🔌 SIMULATE OFFLINE'}
            </FuiButton>
          </div>
        </div>
      </FuiPanel>

      {/* Desktop Pairing QR JSON Import (uses <textarea> so <input> indices 0..2 are never shifted) */}
      <FuiPanel
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title="DESKTOP PAIRING QR // PAYLOAD IMPORT"
            code="QR // JSON"
            accent="cyan"
          />
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          <textarea
            data-testid="uplink-qr-json-input"
            aria-label="Desktop Pairing QR JSON payload"
            placeholder='{"primary_url":"http://192.168.1.42:8080","fallback_url":"http://100.64.0.1:8080","token":"plm_pat_..."}'
            rows={3}
            value={qrJsonText}
            onChange={(e) => setQrJsonText(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              color: FUI_TOKENS.inkStark,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            {qrImportStatus ? (
              <span
                data-testid="uplink-qr-import-status"
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: qrImportStatus.startsWith('ERROR')
                    ? FUI_TOKENS.accentVermilion
                    : FUI_TOKENS.accentPhosphor,
                  borderRadius: '0px',
                }}
              >
                {qrImportStatus}
              </span>
            ) : (
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                  borderRadius: '0px',
                }}
              >
                ACCEPTS /api/auth/pairing-qr PAYLOAD
              </span>
            )}
            <FuiButton
              type="button"
              size="sm"
              variant="secondary"
              data-testid="uplink-qr-import-btn"
              onClick={() => {
                void handleImportQrPayload();
              }}
            >
              📷 IMPORT PAIRING QR
            </FuiButton>
          </div>
        </div>
      </FuiPanel>

      {/* Uplink & Delta Sync Telemetry Readout */}
      <FuiPanel
        surface="panel"
        padding="sm"
        header={
          <FuiPanelHeader
            title="TELEMETRY // DELTA SYNC & VAULT CIPHER"
            code={`SEQ:${config.last_server_seq}`}
            accent="orange"
          />
        }
      >
        <div
          data-testid="uplink-telemetry-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              alignItems: 'center',
              borderRadius: '0px',
            }}
          >
            <FuiBadge tone={config.uplink_status === 'online' ? 'phosphor' : 'amber'}>
              STATUS: {simulatedOffline ? 'SIMULATED_OFFLINE' : config.uplink_status.toUpperCase()}
            </FuiBadge>
            <FuiBadge tone="orange">OUTBOX: {outboxCount} QUEUED</FuiBadge>
            <FuiBadge tone="cyan">CURSOR: {config.last_server_seq}</FuiBadge>
            {config.last_latency_ms !== null && (
              <FuiBadge tone="phosphor">RTT: {config.last_latency_ms}ms</FuiBadge>
            )}
            <FuiBadge tone="muted">
              VAULT: {config.encrypted_pat ? 'ENCRYPTED (enc:v1)' : 'UNSET'}
            </FuiBadge>
          </div>

          <div style={{ color: FUI_TOKENS.inkStark, borderRadius: '0px' }}>
            ACTIVE ENDPOINT: {config.active_server_url || 'NONE'}
            {lastProbeResult?.activeRole && lastProbeResult.activeRole !== 'NONE'
              ? ` [${lastProbeResult.activeRole}]`
              : ''}
          </div>

          {lastProbeResult?.error && (
            <div
              data-testid="uplink-probe-error"
              style={{ color: FUI_TOKENS.accentAmber, borderRadius: '0px' }}
            >
              PROBE_NOTE: {lastProbeResult.error}
            </div>
          )}

          {lastSyncResult && (
            <div
              data-testid="uplink-sync-summary"
              style={{
                color: lastSyncResult.success
                  ? FUI_TOKENS.accentPhosphor
                  : FUI_TOKENS.accentAmber,
                borderRadius: '0px',
              }}
            >
              {lastSyncResult.success
                ? `SYNC_OK // PUSHED:${lastSyncResult.pushedCount} PULLED:${lastSyncResult.pulledCount} SEQ:${lastSyncResult.latestServerSeq}`
                : `SYNC_DEFERRED // ${lastSyncResult.error ?? 'OFFLINE'}`}
            </div>
          )}
        </div>
      </FuiPanel>
    </div>
  );
}
