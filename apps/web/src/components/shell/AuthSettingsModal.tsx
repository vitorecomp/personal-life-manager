import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { FuiBadge, FuiButton, FuiInput, FuiPanelHeader, FUI_TOKENS } from '@hermes/ui';
import {
  apiDelete,
  apiGet,
  apiPost,
  unwrapList,
  type ApiTokenSummary,
  type CreatedPatResponse,
  type PairingQrResponse,
} from '../../api/client';
import { useAppStore } from '../../store/appStore';

export function AuthSettingsModal() {
  const open = useAppStore((s) => s.authModalOpen);
  const setOpen = useAppStore((s) => s.setAuthModalOpen);
  const queryClient = useQueryClient();

  const [username, setUsername] = useState('operator');
  const [password, setPassword] = useState('');
  const [patName, setPatName] = useState('');
  const [patError, setPatError] = useState<string | null>(null);
  const [mintedPat, setMintedPat] = useState<CreatedPatResponse | null>(null);

  const defaultOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8080';
  const [primaryUrl, setPrimaryUrl] = useState(defaultOrigin);
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [qrTokenName, setQrTokenName] = useState('Mobile Companion');
  const [pairingQr, setPairingQr] = useState<PairingQrResponse | null>(null);

  // Clear one-time secrets on close and dismiss modal on Escape
  useEffect(() => {
    if (!open) {
      setMintedPat(null);
      setPairingQr(null);
      setPatError(null);
      setPassword('');
      return undefined;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  const { data: me } = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      try {
        return await apiGet<any>('/api/auth/me');
      } catch {
        return { username: 'operator', role: 'admin' };
      }
    },
    enabled: open,
  });

  const { data: tokens = [] } = useQuery({
    queryKey: ['auth-tokens'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/auth/tokens');
        return unwrapList<ApiTokenSummary>(res, ['tokens']);
      } catch {
        return [];
      }
    },
    enabled: open,
  });

  const loginMutation = useMutation({
    mutationFn: async () => apiPost('/api/auth/login', { username, password }),
    onSuccess: () => {
      setPassword('');
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => apiPost('/api/auth/logout', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
    },
  });

  const createPatMutation = useMutation({
    mutationFn: async (name: string) =>
      apiPost<CreatedPatResponse>('/api/auth/tokens', {
        name,
        scopes: ['read', 'write', 'mcp'],
      }),
    onSuccess: (created) => {
      const data = (created as any)?.data ?? created;
      setMintedPat(data);
      setPatName('');
      setPatError(null);
      queryClient.invalidateQueries({ queryKey: ['auth-tokens'] });
    },
    onError: (err: any) => {
      setPatError(String(err?.message || 'Failed to mint PAT'));
    },
  });

  const revokePatMutation = useMutation({
    mutationFn: async (id: string) => apiDelete(`/api/auth/tokens/${encodeURIComponent(id)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-tokens'] });
    },
  });

  const generateQrMutation = useMutation({
    mutationFn: async () =>
      apiPost<PairingQrResponse>('/api/auth/pairing-qr', {
        primary_url: primaryUrl.trim() || defaultOrigin,
        fallback_url: fallbackUrl.trim() || null,
        token_name: qrTokenName.trim() || 'Mobile Companion',
      }),
    onSuccess: (qr) => {
      const data = (qr as any)?.data ?? qr;
      setPairingQr(data);
      queryClient.invalidateQueries({ queryKey: ['auth-tokens'] });
    },
  });

  if (!open) {
    return null;
  }

  const handleMintPat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = patName.trim();
    if (!trimmed) {
      setPatError('[VALIDATION // PAT NAME REQUIRED]');
      return;
    }
    createPatMutation.mutate(trimmed);
  };

  return (
    <div
      data-testid="auth-settings-backdrop"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 950,
        backgroundColor: 'rgba(8, 8, 11, 0.84)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        borderRadius: '0px',
      }}
    >
      <div
        data-testid="auth-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Operator Auth, PAT Manager & Mobile Pairing QR"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.accentOrange}`,
          color: FUI_TOKENS.inkStark,
          fontFamily: FUI_TOKENS.fontMono,
          borderRadius: '0px',
        }}
      >
        <FuiPanelHeader
          title="UPLINK // AUTH, PERSONAL ACCESS TOKENS & PAIRING QR"
          code="SEC_01"
          accent="orange"
          actions={
            <FuiButton variant="secondary" size="sm" onClick={() => setOpen(false)}>
              [ESC]
            </FuiButton>
          }
        />

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Section 1: Operator Session */}
          <section
            style={{
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <strong style={{ fontSize: '12px', color: FUI_TOKENS.accentOrange }}>
                01 // OPERATOR SESSION
              </strong>
              <FuiBadge tone="phosphor">
                USER: {String(me?.username || 'operator').toUpperCase()}
              </FuiBadge>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '160px' }}>
                <FuiInput
                  label="USERNAME"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: '160px' }}>
                <FuiInput
                  label="PASSWORD"
                  type="password"
                  data-testid="auth-password-input"
                  placeholder="hermes-os-local"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <FuiButton
                variant="primary"
                size="sm"
                data-testid="auth-login-btn"
                onClick={() => loginMutation.mutate()}
              >
                Login
              </FuiButton>
              <FuiButton
                variant="secondary"
                size="sm"
                data-testid="auth-logout-btn"
                onClick={() => logoutMutation.mutate()}
              >
                Logout
              </FuiButton>
            </div>
          </section>

          {/* Section 2: PAT Manager */}
          <section
            style={{
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <strong style={{ fontSize: '12px', color: FUI_TOKENS.accentOrange }}>
              02 // PERSONAL ACCESS TOKENS (SHA-256 plm_pat_...)
            </strong>

            <form
              onSubmit={handleMintPat}
              style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '10px' }}
            >
              <div style={{ flex: 1 }}>
                <FuiInput
                  label="TOKEN NAME"
                  data-testid="pat-name-input"
                  placeholder="Workstation CLI / Mobile Uplink"
                  value={patName}
                  onChange={(e) => {
                    setPatName(e.target.value);
                    if (patError) setPatError(null);
                  }}
                />
              </div>
              <FuiButton type="submit" variant="primary" size="sm" data-testid="mint-pat-btn">
                Mint PAT
              </FuiButton>
            </form>

            {patError && (
              <div
                data-testid="pat-error-banner"
                style={{
                  marginTop: '8px',
                  padding: '6px 8px',
                  border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                  color: FUI_TOKENS.accentVermilion,
                  fontSize: '12px',
                }}
              >
                {patError}
              </div>
            )}

            {mintedPat && (
              <div
                data-testid="minted-pat-banner"
                style={{
                  marginTop: '10px',
                  padding: '8px 10px',
                  border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
                  backgroundColor: FUI_TOKENS.bgPanel,
                  fontSize: '12px',
                }}
              >
                <div style={{ color: FUI_TOKENS.accentPhosphor, fontWeight: 700 }}>
                  [NEW PAT MINTED — COPY NOW (SHOWN ONCE)]
                </div>
                <code data-testid="minted-pat-value">{mintedPat.token}</code>
              </div>
            )}

            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {tokens.map((tok) => (
                <div
                  key={tok.id}
                  data-testid={`pat-row-${tok.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    backgroundColor: FUI_TOKENS.bgPanel,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    fontSize: '12px',
                  }}
                >
                  <div>
                    <strong>{tok.name}</strong>{' '}
                    <span style={{ color: FUI_TOKENS.inkMuted }}>({tok.token_prefix}...)</span>
                  </div>
                  <FuiButton
                    variant="danger"
                    size="sm"
                    data-testid={`revoke-pat-${tok.id}`}
                    onClick={() => revokePatMutation.mutate(tok.id)}
                  >
                    Revoke
                  </FuiButton>
                </div>
              ))}
            </div>
          </section>

          {/* Section 3: Mobile Pairing QR */}
          <section
            style={{
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <strong style={{ fontSize: '12px', color: FUI_TOKENS.accentCyan }}>
              03 // MOBILE COMPANION PAIRING QR (REF-01)
            </strong>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '8px',
                marginTop: '10px',
              }}
            >
              <FuiInput
                label="PRIMARY SERVER URL"
                data-testid="qr-primary-url-input"
                value={primaryUrl}
                onChange={(e) => setPrimaryUrl(e.target.value)}
              />
              <FuiInput
                label="FALLBACK URL (TAILSCALE/LAN)"
                data-testid="qr-fallback-url-input"
                placeholder="http://100.64.0.1:8080"
                value={fallbackUrl}
                onChange={(e) => setFallbackUrl(e.target.value)}
              />
              <FuiInput
                label="DEVICE / TOKEN LABEL"
                data-testid="qr-token-name-input"
                value={qrTokenName}
                onChange={(e) => setQrTokenName(e.target.value)}
              />
            </div>

            <div style={{ marginTop: '10px' }}>
              <FuiButton
                variant="cyan"
                size="sm"
                data-testid="generate-pairing-qr-btn"
                onClick={() => generateQrMutation.mutate()}
              >
                Generate Pairing QR
              </FuiButton>
            </div>

            {pairingQr && (
              <div
                data-testid="pairing-qr-code"
                data-fui-chart="qr"
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '12px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.accentCyan}`,
                  borderRadius: '0px',
                }}
              >
                <div style={{ padding: '8px', backgroundColor: '#F6F6F4', borderRadius: '0px' }}>
                  <QRCodeSVG
                    value={pairingQr.qr_payload_json || JSON.stringify(pairingQr)}
                    size={128}
                  />
                </div>
                <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div>PRIMARY: {pairingQr.primary_url}</div>
                  {pairingQr.fallback_url && <div>FALLBACK: {pairingQr.fallback_url}</div>}
                  <div>TOKEN: {pairingQr.token}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
