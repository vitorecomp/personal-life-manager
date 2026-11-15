import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { E2E_PATHS, ensureRunFixtureEnv } from './harness/env';

// Initialize shared per-run temporary fixture root and validate paths before forking workers
ensureRunFixtureEnv();
void E2E_PATHS.secondBrainDir;
void E2E_PATHS.youtubeListsDb;
void E2E_PATHS.youtubeListsNotesDir;

const e2eRoot = import.meta.dirname;
const testDir = process.env.E2E_TEST_DIR
  ? path.resolve(e2eRoot, process.env.E2E_TEST_DIR)
  : './tests';
const resolvedTestRoot = path.resolve(e2eRoot, testDir);
const outputDir = process.env.E2E_OUTPUT_DIR
  ? path.resolve(e2eRoot, process.env.E2E_OUTPUT_DIR)
  : './test-results';

const chromeExecutable = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const baseURL = (process.env.E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');

export default defineConfig({
  testDir,
  outputDir,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  respectGitIgnore: false,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  testIgnore: [
    '**/node_modules/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '**/.tmp/**',
  ],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      executablePath: chromeExecutable,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
    },
  },
  projects: [
    {
      name: 'tier1',
      testDir: path.join(resolvedTestRoot, 'tier1'),
      testMatch: '**/*.spec.ts',
    },
    {
      name: 'tier2',
      testDir: path.join(resolvedTestRoot, 'tier2'),
      testMatch: '**/*.spec.ts',
    },
    {
      name: 'tier3',
      testDir: path.join(resolvedTestRoot, 'tier3'),
      testMatch: '**/*.spec.ts',
    },
    {
      name: 'tier4',
      testDir: path.join(resolvedTestRoot, 'tier4'),
      testMatch: '**/*.spec.ts',
    },
  ],
});
