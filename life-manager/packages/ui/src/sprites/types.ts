import type React from 'react';

export type PixelScale = 2 | 3 | 4;

export interface SpriteSize {
  w: number;
  h: number;
}

export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteAnimationDef {
  row: number;
  startCol?: number;
  frames: number;
  fps: number;
  loop: boolean;
  frameDurationsMs?: number[];
}

export interface AsepriteFrameEntry {
  filename?: string;
  frame: SpriteRect;
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: SpriteRect;
  sourceSize?: SpriteSize;
  duration?: number;
}

export interface AsepriteFrameTag {
  name: string;
  from: number;
  to: number;
  direction?: 'forward' | 'reverse' | 'pingpong';
  repeat?: string | number;
}

export interface SpriteSheetMeta {
  app: string;
  version?: string;
  image: string;
  format?: 'RGBA8888' | string;
  size: SpriteSize;
  frameSize?: SpriteSize;
  scale?: PixelScale | number | string;
  frameTags?: AsepriteFrameTag[];
}

export interface SpriteSheetDescriptor {
  meta: SpriteSheetMeta;
  animations?: Record<string, SpriteAnimationDef>;
  frames?: Record<string, AsepriteFrameEntry> | AsepriteFrameEntry[];
}

export interface ResolvedSpriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  durationMs: number;
}

export interface NormalizedAnimation {
  name: string;
  loop: boolean;
  fps: number;
  frames: ResolvedSpriteFrame[];
}

export interface NormalizedSpriteSheet {
  image: string;
  size: SpriteSize;
  frameSize: SpriteSize;
  scale: PixelScale;
  animations: Record<string, NormalizedAnimation>;
  defaultAnimation: string;
}

export type CompanionAnimationName =
  | 'idle_ledge_sit'
  | 'walk_ledge'
  | 'read_grimoire'
  | 'cast_blue_flora'
  | 'sip_tea'
  | 'cozy_nap'
  | 'mimic_gag'
  | 'wind_blink_loop'
  | 'calm_gaze';

export type CompanionAnimationHint =
  | CompanionAnimationName
  | 'grimoire'
  | 'stargazing'
  | 'blue_flower_spell'
  | 'tea'
  | 'nod_off'
  | 'reading_grimoire'
  | 'casting'
  | 'sleeping'
  | 'idle_gaze'
  | 'wind_blink';

export type KnightArchetype = 'paladin' | 'vanguard' | 'lore_warden' | 'inquisitor' | 'artificer';
export type KnightAnimState = 'idle' | 'cast' | 'alert' | 'barracks_rest';

export interface PixelSpriteProps {
  /** Bundled or custom sprite descriptor JSON object. */
  descriptor: SpriteSheetDescriptor;
  /** Primary PNG atlas URL or data URI. */
  sheetUrl: string;
  /** Fallback descriptor + sheetUrl used automatically if primary validation or image load fails. */
  fallback?: { descriptor: SpriteSheetDescriptor; sheetUrl: string };
  /** Active animation name inside `descriptor.animations` (or Aseprite `frameTags`). */
  animation: string;
  /** Integer zoom override (`2 | 3 | 4`); defaults to `clampSpriteScale(descriptor.meta.scale)`. */
  scale?: PixelScale | number;
  /** Pause playback on current frame (`false` default). */
  paused?: boolean;
  /** Horizontal pixel mirror (`true` when walking left along ledge). */
  flipX?: boolean;
  /** Accessible label. */
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Fired when a non-looping animation (`loop: false`) reaches its final frame. */
  onAnimationComplete?: (animation: string) => void;
  /** Fired if custom sprite validation/load fails and fallback activates. */
  onFallback?: (reason: string) => void;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  'data-testid'?: string;
}

export interface CompanionNudge {
  id: string;
  title: string;
  message: string;
  severity?: 'info' | 'warning' | 'critical';
  module?: string;
  suggestedPrompt?: string;
}

export interface CompanionChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinkingText?: string;
  createdAt?: string;
  isStreaming?: boolean;
}

export interface CompanionUndoAction {
  undoId: string;
  toolName: string;
  summary: string;
  undone?: boolean;
}

export interface CompanionApprovalRequest {
  id: string;
  toolName: string;
  summary?: string;
  payloadJson: Record<string, unknown> | string;
  status?: 'pending' | 'approved' | 'rejected';
}

export interface CompanionOfflinePhrase {
  id: string;
  phraseText: string;
  triggerContext?: 'any' | 'tap' | 'screen_open' | 'todo_done' | 'routine_done';
  animationHint?: CompanionAnimationHint | null;
}

export interface CompanionPageContext {
  activeRoute: string;
  activeDashboardId?: string | null;
  selectedEntityId?: string | null;
  selectedEntityLabel?: string | null;
}

export interface CompanionStageProps {
  /**
   * Operating surface mode:
   * - `'ledge'`: Perched `32×32` mini-sprite atop a `3px` `#F87C18` horizontal FUI shelf + `!` nudge badge (`Web` & `/monitor`).
   * - `'popover'`: `Cmd+J` waist-up `REF-14` atmospheric portrait + streaming chat + `[Undo]`/`[Approve]` cards (`Web`).
   * - `'mobile'`: Capacitor `COMPANION` tab switching between Online live SSE chat and Offline random loops + `REF-01` quote bubble (`Mobile`).
   */
  mode: 'ledge' | 'popover' | 'mobile';
  /** Online reachability (`true` default on Web; dynamic `IN_RANGE` vs `OFFLINE` on Mobile). */
  online?: boolean;
  /** Backend gateway mode badge (`'online' | 'offline_mock'`). */
  gatewayMode?: 'online' | 'offline_mock';
  /** Explicit animation override (`read_grimoire`, `cast_blue_flora`, etc.); auto-managed when omitted. */
  animation?: CompanionAnimationHint;
  /** Integer pixel scale (`2 | 3 | 4`). */
  scale?: PixelScale;
  /** Horizontal position (`0..100` %) along the `3px` `#F87C18` shelf in `'ledge'` mode. */
  ledgePositionPct?: number;
  /** Proactive cross-module nudges (`!` pixel scroll badge in `'ledge'` & strip in `'popover'`). */
  nudges?: CompanionNudge[];
  onDismissNudge?: (nudgeId: string) => void;
  onSelectNudge?: (nudge: CompanionNudge) => void;
  /** Shared `X-Hermes-Session-Key` (`04` & `06`). */
  sessionKey?: string;
  /** Automatic page context chip (`06` §2). */
  pageContext?: CompanionPageContext;
  /** Popover open state & toggle callbacks (`Cmd+J`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 1-click "Expand in Full Hermes View ↗" (`Web` `'popover'` only — omitted in `'mobile'` per strict `02` boundary!). */
  onExpandToHermes?: (sessionKey?: string) => void;
  /** Streaming chat & tiered `/mcp` write autonomy props (`'popover'` & online `'mobile'`). */
  messages?: CompanionChatMessage[];
  isStreaming?: boolean;
  onSendMessage?: (message: string, context?: CompanionPageContext) => void;
  undoActions?: CompanionUndoAction[];
  onUndo?: (undoId: string) => void;
  pendingApprovals?: CompanionApprovalRequest[];
  onApprove?: (approvalId: string, editedPayloadJson?: Record<string, unknown> | string) => void;
  onReject?: (approvalId: string) => void;
  children?: React.ReactNode;
  /** Mobile Offline mode props (`02` §3 & `06` §2). */
  offlinePhrases?: CompanionOfflinePhrase[];
  queuedMutationsCount?: number;
  /** Incrementing key or token allowing Todo/Routine checkoff in `apps/mobile` to trigger a fresh non-repeating quote + animation! */
  offlineTriggerSignal?: number | string;
  /** Hot-swappable custom sprite overrides (gracefully falls back to bundled defaults on error). */
  customMiniSprite?: { sheetUrl: string; descriptor: SpriteSheetDescriptor };
  customPortraitSprite?: { sheetUrl: string; descriptor: SpriteSheetDescriptor };
  className?: string;
  'data-testid'?: string;
}

export interface IsometricKnightSpriteProps {
  archetype: KnightArchetype;
  state?: KnightAnimState;
  scale?: PixelScale;
  name?: string;
  crestColor?: string;
  /** Monthly budget quota remaining `0..100` (`HP` crimson bar; `0` shows `[BUDGET_0]` circuit-breaker state). */
  hpPct?: number;
  /** Latest run context token load `0..100` (`EP` cyan bar). */
  epPct?: number;
  /** Renders bouncing pixel `[!]` badge (auto-true when `state === 'alert'`). */
  hasAlert?: boolean;
  /** Active turn unit in Turn-Order Timeline / Arena (`[ACTIVE]` chevron + bright isometric diamond base cursor). */
  active?: boolean;
  /** Selected unit in Arena / Forge. */
  selected?: boolean;
  /** Show compact `HP`/`EP` bars & nameplate beneath/above sprite (default `true` when `hpPct` or `epPct` provided). */
  showHud?: boolean;
  customSprite?: { sheetUrl: string; descriptor: SpriteSheetDescriptor };
  onClick?: () => void;
  className?: string;
  'data-testid'?: string;
}
