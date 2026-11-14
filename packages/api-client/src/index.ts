import { v7 as uuidv7 } from 'uuid';

export interface HealthStatusResponse {
  status: string;
  db_online: boolean;
  redis_online: boolean;
  hermes_gateway: 'online' | 'offline_mock';
  version: string;
}

export interface ApiClientConfig {
  baseUrl: string;
  bearerToken?: string;
}

export function createApiHeaders(config?: Partial<ApiClientConfig>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (config?.bearerToken) {
    headers.Authorization = `Bearer ${config.bearerToken}`;
  }
  return headers;
}

export function createMutationId(): string {
  return uuidv7();
}
