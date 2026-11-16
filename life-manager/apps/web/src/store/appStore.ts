import { create } from 'zustand';

const ACTIVE_SESSION_STORAGE_KEY = 'hermes-active-session-key';
const LEGACY_SESSION_STORAGE_KEY = 'hermes-session-key';
const BOOT_COMPLETE_KEY = 'hermes-boot-complete';

function readInitialSessionKey(): string {
  if (typeof window === 'undefined') return 'hermes-primary-session';
  try {
    return (
      window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_SESSION_STORAGE_KEY) ||
      'hermes-primary-session'
    );
  } catch {
    return 'hermes-primary-session';
  }
}

function readInitialBootDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('boot') === '1') return false;
    if (params.get('skipBoot') === '1') return true;
    return window.sessionStorage.getItem(BOOT_COMPLETE_KEY) === 'true';
  } catch {
    return false;
  }
}

export interface AppStoreState {
  activeSessionKey: string;
  setActiveSessionKey: (key: string) => void;
  quickCaptureOpen: boolean;
  setQuickCaptureOpen: (open: boolean) => void;
  authModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  companionOpen: boolean;
  setCompanionOpen: (open: boolean) => void;
  activeDashboardId: string | null;
  setActiveDashboardId: (id: string | null) => void;
  selectedEntityId: string | null;
  selectedEntityLabel: string | null;
  setSelectedEntity: (id: string | null, label?: string | null) => void;
  isAssistantStreaming: boolean;
  setAssistantStreaming: (streaming: boolean) => void;
  bootDismissed: boolean;
  dismissBoot: () => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  activeSessionKey: readInitialSessionKey(),
  setActiveSessionKey: (key: string) => {
    const clean = key.trim() || 'hermes-primary-session';
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, clean);
        window.localStorage.setItem(LEGACY_SESSION_STORAGE_KEY, clean);
      } catch {
        // Ignore storage quota errors
      }
    }
    set({ activeSessionKey: clean });
  },
  quickCaptureOpen: false,
  setQuickCaptureOpen: (open: boolean) => set({ quickCaptureOpen: open }),
  authModalOpen: false,
  setAuthModalOpen: (open: boolean) => set({ authModalOpen: open }),
  companionOpen: false,
  setCompanionOpen: (open: boolean) => set({ companionOpen: open }),
  activeDashboardId: null,
  setActiveDashboardId: (id: string | null) => set({ activeDashboardId: id }),
  selectedEntityId: null,
  selectedEntityLabel: null,
  setSelectedEntity: (id: string | null, label: string | null = null) =>
    set({ selectedEntityId: id, selectedEntityLabel: label }),
  isAssistantStreaming: false,
  setAssistantStreaming: (streaming: boolean) => set({ isAssistantStreaming: streaming }),
  bootDismissed: readInitialBootDismissed(),
  dismissBoot: () => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(BOOT_COMPLETE_KEY, 'true');
      } catch {
        // Ignore storage errors
      }
    }
    set({ bootDismissed: true });
  },
}));
