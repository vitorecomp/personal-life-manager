export {
  E2E_PATHS,
  E2E_URLS,
  PRIMARY_PROTECTED_DATA_ROOT,
  VAULT_OWNERSHIP_MARKER_FILE,
  canonicalizeWithMissingLeaf,
  getProtectedDataRoots,
  assertSafeE2eDataPath,
  isSafeE2eDataPath,
  registerHarnessOwnedVaultRoot,
  getVaultOwnershipInfo,
  isHarnessOwnedVaultRoot,
  ensureRunFixtureEnv,
  buildDefaultBackendEnv,
  ensureStackReady,
  stopManagedStack,
  withIsolatedBackend,
  resolveBackendBinary,
  type E2ePaths,
  type E2eUrls,
  type SafePathGuardOptions,
} from './env';

export {
  ApiClient,
  createApiClient,
  unwrapList,
  createPatToken,
  readSseEvents,
  uniqueId,
  CleanupRegistry,
  assertSafeCleanupRoot,
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  type ApiResponse,
  type SseEventRecord,
} from './api-helpers';

export {
  McpClient,
  McpHttpError,
  createMcpClient,
  type JsonRpcErrorObject,
  type JsonRpcEnvelope,
  type McpRawResponse,
  type McpTool,
  type McpToolList,
  type McpToolCallResult,
} from './mcp-helpers';

export {
  startMockHermesGateway,
  type MockHermesGatewayTriggerMcp,
  type MockHermesGatewayOptions,
  type RecordedGatewayRequest,
  type MockHermesGatewayHandle,
} from './mock-hermes-gateway';

export {
  startMockTcpServer,
  startMockHttpServer,
  type MockTcpServerHandle,
  type MockHttpServerHandle,
} from './mock-probe-target';

export {
  createYoutubeFixtureEnv,
  type YoutubeFixtureOptions,
  type YoutubeFixtureEnv,
} from './youtube-fixtures';

export {
  waitForAppReady,
  auditZeroBorderRadius,
  auditInteractiveFontFloor,
  auditColorTokens,
  auditPixelatedSprites,
  auditApertureLogo,
  auditOrthogonalBlueprintCorridors,
  FUI_COMPLIANT_SELF_TEST_HTML,
  FUI_VIOLATING_SELF_TEST_HTML,
  type BorderRadiusViolation,
  type FontFloorViolation,
  type SpriteViolation,
  type ColorTokensAuditResult,
  type ApertureLogoAuditResult,
  type BlueprintCorridorsAuditResult,
} from './fui-rubric';
