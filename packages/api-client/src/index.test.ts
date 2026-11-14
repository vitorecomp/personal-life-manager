import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { createApiHeaders, createMutationId } from './index';

describe('@hermes/api-client bootstrap contract', () => {
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
});
