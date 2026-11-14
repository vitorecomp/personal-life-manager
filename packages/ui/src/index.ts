// F18: Tokens, Hooks, Privacy Mask & Core 0px Rectilinear Primitives
export {
  FUI_TOKENS,
  FUI_CSS_VARS,
  fuiHatchStyle,
  type FuiTokenKey,
  type FuiSurfaceVariant,
  type FuiAccentTone,
} from './tokens';

export { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';

export {
  PrivacyMaskProvider,
  usePrivacyMask,
  PrivacyValue,
  PrivacyMaskToggle,
  formatMaskedCurrency,
  isNonCurrencyToken,
  type PrivacyValueKind,
  type PrivacyMaskContextValue,
  type PrivacyMaskProviderProps,
  type PrivacyValueProps,
  type PrivacyMaskToggleProps,
} from './privacy/PrivacyMask';

export {
  FuiPanel,
  FuiPanelHeader,
  type FuiHeaderAccent,
  type FuiPanelHeaderProps,
  type FuiPanelProps,
} from './primitives/FuiPanel';

export {
  FuiButton,
  type FuiButtonVariant,
  type FuiButtonSize,
  type FuiButtonProps,
} from './primitives/FuiButton';

export {
  FuiInput,
  FuiSelect,
  type FuiInputProps,
  type FuiSelectOption,
  type FuiSelectProps,
} from './primitives/FuiInput';

export {
  FuiTabs,
  type FuiTabItem,
  type FuiTabsProps,
} from './primitives/FuiTabs';

export {
  FuiBadge,
  FuiCalloutTag,
  type FuiBadgeProps,
  type FuiCalloutTagProps,
} from './primitives/FuiBadge';

export {
  FuiModal,
  type FuiModalProps,
} from './primitives/FuiModal';

export {
  FuiFigureRow,
  type FuiFigureRowProps,
} from './primitives/FuiFigureRow';

export {
  FuiBatteryCapsule,
  type FuiBatteryCapsuleProps,
} from './primitives/FuiBatteryCapsule';

// F19: REF-10 Mechanical 8-Blade Shutter Aperture Brand Logo & HUD Ring Glyph Atlas
export {
  SystemApertureLogo,
  type SystemApertureStatus,
  type SystemApertureLogoProps,
} from './brand/SystemApertureLogo';

export {
  HudRingGlyph,
  HUD_RING_GLYPH_VARIANTS,
  type HudRingGlyphVariant,
  type HudRingGlyphProps,
} from './brand/HudRingGlyph';

// F20: REF-09 Orbital Boot Astrolabe, REF-08 Geodesic Thinking Orb & REF-11/12 Loaders
export {
  OrbitalBootScreen,
  BOOT_STAGE_LABELS,
  type BootStage,
  type OrbitalBootScreenProps,
} from './loaders/OrbitalBootScreen';

export {
  GeodesicThinkingOrb,
  buildGeodesicIcosphere,
  type Vec3,
  type GeodesicMesh,
  type ThinkingOrbQueryNode,
  type GeodesicThinkingOrbProps,
} from './loaders/GeodesicThinkingOrb';

export {
  ModularHudLoader,
  MODULAR_HUD_LOADER_VARIANTS,
  type ModularHudLoaderVariant,
  type ModularHudLoaderProps,
} from './loaders/ModularHudLoader';

export {
  MicroAnimIcon,
  MICRO_ANIM_ICON_VARIANTS,
  type MicroAnimIconVariant,
  type MicroAnimIconProps,
} from './loaders/MicroAnimIcon';

// F21: Hot-Swappable Pixel-Art PNG + JSON Sprite Engine (REF-14, REF-14b, REF-13)
export type {
  PixelScale,
  SpriteSize,
  SpriteRect,
  SpriteAnimationDef,
  AsepriteFrameEntry,
  AsepriteFrameTag,
  SpriteSheetMeta,
  SpriteSheetDescriptor,
  ResolvedSpriteFrame,
  NormalizedAnimation,
  NormalizedSpriteSheet,
  CompanionAnimationName,
  CompanionAnimationHint,
  KnightArchetype,
  KnightAnimState,
  PixelSpriteProps,
  CompanionNudge,
  CompanionChatMessage,
  CompanionUndoAction,
  CompanionApprovalRequest,
  CompanionOfflinePhrase,
  CompanionPageContext,
  CompanionStageProps,
  IsometricKnightSpriteProps,
} from './sprites/types';

export {
  FRIEREN_MINI_SPRITE,
  FRIEREN_PORTRAIT_SPRITE,
  KNIGHTS_ISOMETRIC_SPRITE,
  FRIEREN_MINI_SHEET_URL,
  FRIEREN_PORTRAIT_SHEET_URL,
  KNIGHTS_ISOMETRIC_SHEET_URL,
  DEFAULT_COMPANION_OFFLINE_PHRASES,
  clampSpriteScale,
  resolveCompanionAnimationKey,
  normalizeSpriteDescriptor,
} from './sprites/registry';

export { PixelSprite } from './sprites/PixelSprite';
export { CompanionStage } from './sprites/CompanionStage';
export { IsometricKnightSprite } from './sprites/IsometricKnightSprite';

// F22: Shared Tactical Telemetry & Finance Visual Charts (REF-01, REF-06, REF-07)
export {
  computeWaffleAllocation,
  computeWaffleTiles,
  WAFFLE_PALETTE_RAMP,
  WAFFLE_UNALLOCATED_COLOR,
  sanitizeFinite,
  clamp,
  type WaffleSliceInput,
  type WaffleAllocatedSlice,
  type WaffleTileCell,
  type ComputeWaffleOptions,
  type WaffleComputationResult,
} from './charts/math';

export {
  LifeRadarReticle,
  FocusBarcode24h,
  BinaryDotMatrix8x12,
  WaveformSparkline,
  ConstellationMesh,
  type LifePillarKey,
  type LifePillarDatum,
  type LifeRadarReticleProps,
  type FocusSessionInterval,
  type FocusBarcode24hProps,
  type MatrixCellState,
  type BinaryDotMatrix8x12Props,
  type WaveformSparklineProps,
  type ConstellationNode,
  type ConstellationEdge,
  type ConstellationMeshProps,
} from './charts/TelemetryCharts';

export {
  WaffleGrid10x20,
  HatchedDonutGauge,
  PairedHatchBarChart,
  CandlestickChart,
  type WaffleGrid10x20Props,
  type DonutLegendItem,
  type HatchedDonutGaugeProps,
  type MonthlyBarRange,
  type PairedMonthDatum,
  type PairedHatchBarChartProps,
  type CandleRange,
  type CandleDatum,
  type CandlestickChartProps,
} from './charts/FinanceCharts';
