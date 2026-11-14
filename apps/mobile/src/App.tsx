import {
  type CompanionApprovalRequest,
  type CompanionChatMessage,
  type CompanionNudge,
  type CompanionUndoAction,
  FUI_TOKENS,
  FuiBadge,
  FuiButton,
  MicroAnimIcon,
  SystemApertureLogo,
} from '@hermes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DayProfile,
  type MobileDailyCheckinRow,
  type MobileOfflinePhraseRow,
  type MobileProjectRow,
  type MobileRoutineStackView,
  MobileSqliteEngine,
  type MobileTaskRow,
  type MobileTimeSessionRow,
  type MobileUplinkConfigRow,
  type TimerMode,
} from './db/sqliteEngine';
import { generateUuidV7 } from './db/uuidv7';
import {
  type DeltaSyncResult,
  dismissCompanionNudge,
  executeMcpApproval,
  executeMcpUndo,
  fetchCompanionNudges,
  probeAndVerifyUplink,
  runDeltaSync,
  streamCompanionChat,
  type UplinkProbeResult,
} from './services/uplinkSync';
import { CompanionSurface } from './views/CompanionSurface';
import { RoutinesSurface } from './views/RoutinesSurface';
import { TodosSurface } from './views/TodosSurface';
import { UplinkConfigSurface } from './views/UplinkConfigSurface';

export const ALLOWED_MOBILE_SURFACES = [
  'ROUTINES',
  'TODOS',
  'COMPANION',
  'UPLINK_CONFIG',
] as const;

export type MobileSurface = (typeof ALLOWED_MOBILE_SURFACES)[number];

const EXCLUDED_DESKTOP_ROUTES = new Set([
  '/dashboard',
  '/monitor',
  '/hermes',
  '/agents',
  '/goals',
  '/courses',
  '/finance',
]);

function resolvePathnameRoute(pathname: string): {
  initialSurface: MobileSurface;
  excludedRoute: string | null;
} {
  const clean = (pathname || '/').trim().toLowerCase().replace(/\/+$/, '') || '/';
  if (clean === '/' || clean === '/index.html' || clean === '/routines') {
    return { initialSurface: 'ROUTINES', excludedRoute: null };
  }
  if (clean === '/todos') {
    return { initialSurface: 'TODOS', excludedRoute: null };
  }
  if (clean === '/companion') {
    return { initialSurface: 'COMPANION', excludedRoute: null };
  }
  if (clean === '/uplink' || clean === '/uplink_config' || clean === '/settings') {
    return { initialSurface: 'UPLINK_CONFIG', excludedRoute: null };
  }
  if (EXCLUDED_DESKTOP_ROUTES.has(clean)) {
    return { initialSurface: 'ROUTINES', excludedRoute: pathname };
  }
  return { initialSurface: 'ROUTINES', excludedRoute: pathname };
}

const DEFAULT_UPLINK_FALLBACK: MobileUplinkConfigRow = {
  id: 1,
  client_id: '01932a00-0000-7000-8000-000000000001',
  primary_server_url: 'http://127.0.0.1:8080',
  fallback_server_url: '',
  active_server_url: 'http://127.0.0.1:8080',
  encrypted_pat: '',
  token_prefix: '',
  last_server_seq: 0,
  last_sync_at: null,
  last_verified_at: null,
  last_latency_ms: null,
  uplink_status: 'offline',
  session_key: 'mobile-companion-main',
  updated_at: '2026-11-14T08:00:00.000Z',
};

const TAB_DATA_MAP: Record<MobileSurface, string> = {
  ROUTINES: 'routines',
  TODOS: 'todos',
  COMPANION: 'companion',
  UPLINK_CONFIG: 'uplink',
};

export function App() {
  const routeInit = resolvePathnameRoute(
    typeof window !== 'undefined' ? window.location.pathname : '/',
  );

  const [activeSurface, setActiveSurface] = useState<MobileSurface>(routeInit.initialSurface);
  const [excludedRoute, setExcludedRoute] = useState<string | null>(routeInit.excludedRoute);
  const [dayProfile, setDayProfile] = useState<DayProfile>('workday');

  const engineRef = useRef<MobileSqliteEngine | null>(null);
  const [dbReady, setDbReady] = useState<boolean>(false);

  // Domain state hydrated from 10-table SQLite
  const [projects, setProjects] = useState<MobileProjectRow[]>([]);
  const [tasks, setTasks] = useState<MobileTaskRow[]>([]);
  const [activeTimer, setActiveTimer] = useState<MobileTimeSessionRow | null>(null);
  const [routineStacks, setRoutineStacks] = useState<MobileRoutineStackView[]>([]);
  const [dailyCheckin, setDailyCheckin] = useState<MobileDailyCheckinRow | null>(null);
  const [offlinePhrases, setOfflinePhrases] = useState<MobileOfflinePhraseRow[]>([]);
  const [uplinkConfig, setUplinkConfig] = useState<MobileUplinkConfigRow>(DEFAULT_UPLINK_FALLBACK);
  const [outboxCount, setOutboxCount] = useState<number>(0);

  // Uplink & Companion runtime state
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(false);
  const [isProbingOrSyncing, setIsProbingOrSyncing] = useState<boolean>(false);
  const [lastProbeResult, setLastProbeResult] = useState<UplinkProbeResult | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<DeltaSyncResult | null>(null);

  const [offlineTriggerSignal, setOfflineTriggerSignal] = useState<number>(0);
  const [gatewayMode, setGatewayMode] = useState<'online' | 'offline_mock'>('online');
  const [chatMessages, setChatMessages] = useState<CompanionChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [undoActions, setUndoActions] = useState<CompanionUndoAction[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<CompanionApprovalRequest[]>([]);
  const [nudges, setNudges] = useState<CompanionNudge[]>([]);

  const refreshStateFromSqlite = useCallback(
    (eng?: MobileSqliteEngine | null, profileOverride?: DayProfile) => {
      const target = eng ?? engineRef.current;
      if (!target) return;
      const activeProf = profileOverride ?? dayProfile;
      setProjects(target.listProjects());
      setTasks(target.listTasks());
      setActiveTimer(target.getActiveTimer());
      setRoutineStacks(target.listRoutineStacks(activeProf));
      setDailyCheckin(target.getDailyCheckin());
      setOfflinePhrases(target.listOfflinePhrases());
      setUplinkConfig(target.getUplinkConfig());
      setOutboxCount(target.getOutboxMutations().length);
    },
    [dayProfile],
  );

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = 'HERMES Companion // MOBILE';
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    MobileSqliteEngine.create()
      .then((eng) => {
        if (!mounted) return;
        engineRef.current = eng;
        setDbReady(true);
        refreshStateFromSqlite(eng);
      })
      .catch(() => {
        if (!mounted) return;
        setDbReady(true);
      });

    const handlePopState = () => {
      const resolved = resolvePathnameRoute(window.location.pathname);
      setExcludedRoute(resolved.excludedRoute);
      setActiveSurface(resolved.initialSurface);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      mounted = false;
      window.removeEventListener('popstate', handlePopState);
    };
  }, [refreshStateFromSqlite]);

  const isOnline = !simulatedOffline && uplinkConfig.uplink_status === 'online';
  const isSyncing = isProbingOrSyncing || uplinkConfig.uplink_status === 'syncing';

  const handleChangeDayProfile = (nextProfile: DayProfile) => {
    setDayProfile(nextProfile);
    if (engineRef.current) {
      setRoutineStacks(engineRef.current.listRoutineStacks(nextProfile));
    }
  };

  // =========================================================================
  // Routines Handlers (0ms SQLite + Outbox + Offline Frieren Trigger)
  // =========================================================================

  const handleToggleHabit = (routineItemId: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.toggleRoutineItemLog(routineItemId);
    refreshStateFromSqlite(eng);
    if (!isOnline) {
      setOfflineTriggerSignal((prev) => prev + 1);
    }
  };

  const handleStepHabitValue = (routineItemId: string, delta: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.stepRoutineItemValue(routineItemId, delta);
    refreshStateFromSqlite(eng);
    if (!isOnline) {
      setOfflineTriggerSignal((prev) => prev + 1);
    }
  };

  const handleAddHabitItem = (routineId: string, title: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.createRoutineItem({ routineId, title });
    refreshStateFromSqlite(eng);
  };

  const handleSaveDailyCheckin = (input: {
    energyScore: number;
    moodScore: number;
    sleepHours: number;
    highlight: string;
  }) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.upsertDailyCheckin({
      dayProfileUsed: dayProfile,
      energyScore: input.energyScore,
      moodScore: input.moodScore,
      sleepHours: input.sleepHours,
      highlight: input.highlight,
    });
    refreshStateFromSqlite(eng);
  };

  // =========================================================================
  // Todos & Focus Timer Handlers (0ms SQLite + Outbox)
  // =========================================================================

  const handleQuickCaptureTodo = (rawText: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.createTaskFromQuickCapture(rawText);
    refreshStateFromSqlite(eng);
  };

  const handleToggleTask = (taskId: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    const updated = eng.toggleTaskCompletion(taskId);
    refreshStateFromSqlite(eng);
    if (updated?.status === 'done' && !isOnline) {
      setOfflineTriggerSignal((prev) => prev + 1);
    }
  };

  const handleDeleteTask = (taskId: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.deleteTask(taskId);
    refreshStateFromSqlite(eng);
  };

  const handleStartTimer = (taskId: string | null, mode: TimerMode) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.startFocusTimer({ taskId, timerMode: mode });
    refreshStateFromSqlite(eng);
  };

  const handleStopTimer = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.stopFocusTimer();
    refreshStateFromSqlite(eng);
  };

  // =========================================================================
  // Uplink & Delta Sync Handlers
  // =========================================================================

  const handleSaveUplinkOnly = (input: {
    primaryServerUrl: string;
    fallbackServerUrl: string;
    rawPat?: string;
  }) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.saveUplinkConfig({
      primaryServerUrl: input.primaryServerUrl,
      fallbackServerUrl: input.fallbackServerUrl,
      rawPat: input.rawPat,
    });
    refreshStateFromSqlite(eng);
  };

  const handleTestAndSaveUplink = async (input: {
    primaryServerUrl: string;
    fallbackServerUrl: string;
    rawPat?: string;
  }) => {
    const eng = engineRef.current;
    if (!eng) return;

    eng.saveUplinkConfig({
      primaryServerUrl: input.primaryServerUrl,
      fallbackServerUrl: input.fallbackServerUrl,
      rawPat: input.rawPat,
    });
    refreshStateFromSqlite(eng);

    setIsProbingOrSyncing(true);
    try {
      const probeRes = await probeAndVerifyUplink(eng);
      setLastProbeResult(probeRes);
      refreshStateFromSqlite(eng);

      if (probeRes.online && !simulatedOffline) {
        const syncRes = await runDeltaSync(eng);
        setLastSyncResult(syncRes);
        refreshStateFromSqlite(eng);

        const pat = eng.getDecryptedPat();
        const fetchedNudges = await fetchCompanionNudges({
          activeUrl: probeRes.activeUrl,
          decryptedPat: pat,
        });
        setNudges(fetchedNudges);
      }
    } finally {
      setIsProbingOrSyncing(false);
    }
  };

  const handleSyncNow = async () => {
    const eng = engineRef.current;
    if (!eng || simulatedOffline) return;

    setIsProbingOrSyncing(true);
    try {
      const probeRes = await probeAndVerifyUplink(eng);
      setLastProbeResult(probeRes);
      if (probeRes.online) {
        const syncRes = await runDeltaSync(eng);
        setLastSyncResult(syncRes);
      }
      refreshStateFromSqlite(eng);
    } finally {
      setIsProbingOrSyncing(false);
    }
  };

  // =========================================================================
  // Companion Online SSE & Offline Phrase Handlers
  // =========================================================================

  const handleSendCompanionMessage = async (message: string) => {
    const eng = engineRef.current;
    if (!eng || !isOnline) return;

    const userMsg: CompanionChatMessage = {
      id: generateUuidV7(),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    };
    const assistantMsgId = generateUuidV7();
    const initialAssistantMsg: CompanionChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '...',
      isStreaming: true,
    };

    setChatMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setIsStreaming(true);

    try {
      const cfg = eng.getUplinkConfig();
      const pat = eng.getDecryptedPat();
      const result = await streamCompanionChat({
        activeUrl: cfg.active_server_url || cfg.primary_server_url,
        decryptedPat: pat,
        sessionKey: cfg.session_key,
        message,
        activeRoute: '/companion',
        callbacks: {
          onThinking: (thinking, mode) => {
            setGatewayMode(mode);
            setChatMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, thinkingText: thinking } : m)),
            );
          },
          onToken: (_delta, accumulated) => {
            setChatMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, content: accumulated } : m)),
            );
          },
          onUndoAvailable: (undo) => {
            setUndoActions((prev) => [undo, ...prev]);
          },
          onApprovalRequired: (approval) => {
            setPendingApprovals((prev) => [approval, ...prev]);
          },
        },
      });

      setGatewayMode(result.gatewayMode);
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: result.finalMessage,
                thinkingText: result.thinkingText || m.thinkingText,
                isStreaming: false,
              }
            : m,
        ),
      );

      // Reconcile any MCP tool changes via delta sync
      await runDeltaSync(eng);
      refreshStateFromSqlite(eng);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Chat stream failed';
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `[UPLINK_INTERRUPTED] ${errMsg}`, isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleMcpUndo = async (undoId: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    const cfg = eng.getUplinkConfig();
    const ok = await executeMcpUndo({
      activeUrl: cfg.active_server_url || cfg.primary_server_url,
      decryptedPat: eng.getDecryptedPat(),
      undoId,
    });
    if (ok) {
      setUndoActions((prev) =>
        prev.map((u) => (u.undoId === undoId ? { ...u, undone: true } : u)),
      );
      await runDeltaSync(eng);
      refreshStateFromSqlite(eng);
    }
  };

  const handleMcpApprove = async (
    approvalId: string,
    payloadJson?: Record<string, unknown> | string,
  ) => {
    const eng = engineRef.current;
    if (!eng) return;
    const cfg = eng.getUplinkConfig();
    const ok = await executeMcpApproval({
      activeUrl: cfg.active_server_url || cfg.primary_server_url,
      decryptedPat: eng.getDecryptedPat(),
      approvalId,
      decision: 'approve',
      payloadJson,
    });
    if (ok) {
      setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
      await runDeltaSync(eng);
      refreshStateFromSqlite(eng);
    }
  };

  const handleMcpReject = async (approvalId: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    const cfg = eng.getUplinkConfig();
    const ok = await executeMcpApproval({
      activeUrl: cfg.active_server_url || cfg.primary_server_url,
      decryptedPat: eng.getDecryptedPat(),
      approvalId,
      decision: 'reject',
    });
    if (ok) {
      setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
    }
  };

  const handleDismissNudge = async (nudgeId: string) => {
    setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
    const eng = engineRef.current;
    if (!eng || !isOnline) return;
    const cfg = eng.getUplinkConfig();
    await dismissCompanionNudge({
      activeUrl: cfg.active_server_url || cfg.primary_server_url,
      decryptedPat: eng.getDecryptedPat(),
      nudgeId,
    });
  };

  const handleAddOfflinePhrase = (phraseText: string, animationHint: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.createOfflinePhrase({ phraseText, triggerContext: 'any', animationHint });
    refreshStateFromSqlite(eng);
  };

  const handleDeleteOfflinePhrase = (id: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.deleteOfflinePhrase(id);
    refreshStateFromSqlite(eng);
  };

  return (
    <main
      data-testid="hermes-mobile-shell"
      data-db-ready={dbReady ? 'true' : 'false'}
      style={{
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        minHeight: '100vh',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        borderRadius: '0px',
      }}
    >
      {/* Top Tactical FUI Header Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '10px 12px',
          backgroundColor: FUI_TOKENS.bgPanel,
          borderBottom: `2px solid ${FUI_TOKENS.accentOrange}`,
          boxSizing: 'border-box',
          borderRadius: '0px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            borderRadius: '0px',
          }}
        >
          <SystemApertureLogo
            size={28}
            status={isSyncing ? 'syncing' : isOnline ? 'online' : 'offline'}
            isThinking={isStreaming}
          />
          <span
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.inkStark,
              letterSpacing: '0.04em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderRadius: '0px',
            }}
          >
            HERMES COMPANION // {activeSurface}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexShrink: 0,
            borderRadius: '0px',
          }}
        >
          <MicroAnimIcon variant="WIFI" size={16} active={isOnline || isSyncing} />
          <FuiBadge
            data-testid="mobile-header-uplink-badge"
            tone={isSyncing ? 'orange' : isOnline ? 'phosphor' : 'amber'}
          >
            {isSyncing
              ? 'ONLINE // SYNCING'
              : isOnline
                ? 'ONLINE // SYNCED'
                : `OFFLINE // QUEUED (${outboxCount})`}
          </FuiBadge>
        </div>
      </header>

      {/* Excluded Desktop Route Guard Banner (T2-F33) */}
      {excludedRoute && (
        <div
          data-testid="out-of-mobile-scope-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            margin: '10px 12px 0 12px',
            padding: '8px 10px',
            backgroundColor: FUI_TOKENS.bgPanel,
            border: `1px solid ${FUI_TOKENS.accentOrange}`,
            color: FUI_TOKENS.accentOrange,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          <span>
            [OUT_OF_MOBILE_SCOPE // ROUTE_EXCLUDED_ON_COMPANION: {excludedRoute}]
          </span>
          <FuiButton
            size="sm"
            variant="secondary"
            data-testid="dismiss-excluded-route-btn"
            onClick={() => setExcludedRoute(null)}
          >
            DISMISS
          </FuiButton>
        </div>
      )}

      {/* Active Surface Body */}
      <div
        style={{
          flex: 1,
          padding: '12px',
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: '100%',
          overflowX: 'hidden',
          borderRadius: '0px',
        }}
      >
        {activeSurface === 'ROUTINES' && (
          <RoutinesSurface
            dayProfile={dayProfile}
            onChangeDayProfile={handleChangeDayProfile}
            stacks={routineStacks}
            dailyCheckin={dailyCheckin}
            onToggleHabit={handleToggleHabit}
            onStepHabitValue={handleStepHabitValue}
            onAddHabitItem={handleAddHabitItem}
            onSaveDailyCheckin={handleSaveDailyCheckin}
          />
        )}

        {activeSurface === 'TODOS' && (
          <TodosSurface
            tasks={tasks}
            projects={projects}
            activeTimer={activeTimer}
            onQuickCapture={handleQuickCaptureTodo}
            onToggleTask={handleToggleTask}
            onDeleteTask={handleDeleteTask}
            onStartTimer={handleStartTimer}
            onStopTimer={handleStopTimer}
          />
        )}

        {activeSurface === 'COMPANION' && (
          <CompanionSurface
            isOnline={isOnline}
            gatewayMode={gatewayMode}
            sessionKey={uplinkConfig.session_key}
            offlinePhrases={offlinePhrases}
            queuedMutationsCount={outboxCount}
            offlineTriggerSignal={offlineTriggerSignal}
            messages={chatMessages}
            isStreaming={isStreaming}
            undoActions={undoActions}
            pendingApprovals={pendingApprovals}
            nudges={nudges}
            onSendMessage={(msg) => {
              void handleSendCompanionMessage(msg);
            }}
            onUndo={(id) => {
              void handleMcpUndo(id);
            }}
            onApprove={(id, payload) => {
              void handleMcpApprove(id, payload);
            }}
            onReject={(id) => {
              void handleMcpReject(id);
            }}
            onDismissNudge={(id) => {
              void handleDismissNudge(id);
            }}
            onAddOfflinePhrase={handleAddOfflinePhrase}
            onDeleteOfflinePhrase={handleDeleteOfflinePhrase}
            onTriggerOfflineMotivation={() => setOfflineTriggerSignal((prev) => prev + 1)}
          />
        )}

        {activeSurface === 'UPLINK_CONFIG' && (
          <UplinkConfigSurface
            config={uplinkConfig}
            outboxCount={outboxCount}
            simulatedOffline={simulatedOffline}
            isProbingOrSyncing={isProbingOrSyncing}
            lastProbeResult={lastProbeResult}
            lastSyncResult={lastSyncResult}
            onTestAndSaveUplink={handleTestAndSaveUplink}
            onSaveUplinkOnly={handleSaveUplinkOnly}
            onSyncNow={handleSyncNow}
            onToggleSimulatedOffline={() => setSimulatedOffline((prev) => !prev)}
          />
        )}
      </div>

      {/* Persistent Active Focus Timer Dock (rendered above bottom nav when timer is active) */}
      {activeTimer && activeSurface !== 'TODOS' && (
        <div
          data-testid="persistent-mobile-timer-dock"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '8px 12px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderTop: `1px solid ${FUI_TOKENS.accentPhosphor}`,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentPhosphor,
            borderRadius: '0px',
          }}
        >
          <span>[⏱ FOCUS_ACTIVE // {activeTimer.timer_mode.toUpperCase()}]</span>
          <FuiButton size="sm" variant="danger" onClick={handleStopTimer}>
            ■ STOP
          </FuiButton>
        </div>
      )}

      {/* Bottom 4-Tab Mobile Navigation Bar */}
      <nav
        aria-label="Mobile Navigation"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '4px',
          padding: '8px 10px',
          backgroundColor: FUI_TOKENS.bgPanel,
          borderTop: `1px solid ${FUI_TOKENS.accentOrange}`,
          boxSizing: 'border-box',
          borderRadius: '0px',
        }}
      >
        {ALLOWED_MOBILE_SURFACES.map((surface) => {
          const isCurrent = activeSurface === surface;
          return (
            <button
              key={surface}
              type="button"
              data-tab={TAB_DATA_MAP[surface]}
              data-testid={`mobile-tab-${surface.toLowerCase()}`}
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => setActiveSurface(surface)}
              style={{
                fontSize: '12px',
                fontFamily: FUI_TOKENS.fontMono,
                fontWeight: 700,
                padding: '10px 4px',
                backgroundColor: isCurrent ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                color: isCurrent ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                border: `1px solid ${
                  isCurrent ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                }`,
                cursor: 'pointer',
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                borderRadius: '0px',
              }}
            >
              {surface}
            </button>
          );
        })}
      </nav>
    </main>
  );
}
