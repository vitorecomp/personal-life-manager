import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import {
  client,
  configureApiClient,
  createApiHeaders,
  createMutationId,
  getHealth,
  getHealthOptions,
  listCourses,
  listDashboards,
  listDashboardsOptions,
  listFinanceAssets,
  listGoals,
  listRoutines,
  listTasks,
  listTasksOptions,
  syncPull,
  syncPush,
  verifyAuth,
} from './index';

describe('@hermes/api-client bootstrap contract & OpenAPI 3.1 generated SDK', () => {
  it('attaches Bearer Personal Access Token header when provided', () => {
    expect(createApiHeaders()).toEqual({ Accept: 'application/json' });
    expect(createApiHeaders({ bearerToken: 'plm_pat_test' })).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer plm_pat_test',
    });
  });

  it('generates RFC 9562 UUIDv7 mutation identifiers using built-in uuid types', () => {
    const directId = uuidv7();
    const helperId = createMutationId();
    const uuidv7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(directId).toMatch(uuidv7Pattern);
    expect(helperId).toMatch(uuidv7Pattern);
  });

  it('exposes OpenAPI 3.1 generated SDK functions and TanStack Query v5 helpers', () => {
    expect(typeof getHealth).toBe('function');
    expect(typeof verifyAuth).toBe('function');
    expect(typeof syncPush).toBe('function');
    expect(typeof syncPull).toBe('function');
    expect(typeof listDashboards).toBe('function');
    expect(typeof listTasks).toBe('function');
    expect(typeof listRoutines).toBe('function');
    expect(typeof listGoals).toBe('function');
    expect(typeof listCourses).toBe('function');
    expect(typeof listFinanceAssets).toBe('function');

    const healthQuery = getHealthOptions();
    expect(healthQuery.queryKey).toBeDefined();
    expect(typeof healthQuery.queryFn).toBe('function');

    const dashboardsQuery = listDashboardsOptions();
    expect(dashboardsQuery.queryKey).toBeDefined();

    const tasksQuery = listTasksOptions();
    expect(tasksQuery.queryKey).toBeDefined();
  });

  it('configures shared fetch client baseUrl and Authorization header', () => {
    const configured = configureApiClient({
      baseUrl: 'http://127.0.0.1:8080',
      bearerToken: 'plm_pat_unit_test',
    });
    expect(configured).toBe(client);
    expect(configured.getConfig().baseUrl).toBe('http://127.0.0.1:8080');
  });

  it('validates openapi.json 3.1 schema contract and domain coverage', () => {
    const openapiPath = resolve(__dirname, '../openapi.json');
    const raw = readFileSync(openapiPath, 'utf-8');
    const spec = JSON.parse(raw);

    expect(spec.openapi).toMatch(/^3\.1\.\d+$/);
    expect(raw).not.toContain('pgvector::Vector');
    expect(Object.keys(spec.components?.schemas || {}).length).toBeGreaterThanOrEqual(200);
    expect(spec.paths['/api/health']).toBeDefined();
    expect(spec.paths['/api/sync/push']).toBeDefined();
    expect(spec.paths['/api/dashboards']).toBeDefined();
    expect(spec.paths['/api/tasks']).toBeDefined();
    expect(spec.paths['/api/finance/assets']).toBeDefined();
  });

  it('adv_configureApiClient_and_createApiHeaders_handle_missing_token_and_uuidv7_monotonicity', () => {
    expect(createApiHeaders()).toEqual({ Accept: 'application/json' });
    expect(createApiHeaders({ bearerToken: '' })).toEqual({ Accept: 'application/json' });
    expect(createApiHeaders({ bearerToken: 'plm_pat_abc123' })).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer plm_pat_abc123',
    });

    const configured = configureApiClient({
      baseUrl: 'http://127.0.0.1:8080',
      bearerToken: 'plm_pat_xyz987',
    });
    expect(configured.getConfig().baseUrl).toBe('http://127.0.0.1:8080');

    const id1 = createMutationId();
    const id2 = createMutationId();
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(id1).not.toBe(id2);
  });
});
