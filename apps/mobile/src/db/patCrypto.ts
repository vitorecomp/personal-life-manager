const VAULT_CIPHER_PREFIX = 'enc:v1:';
const DEFAULT_VAULT_SECRET = 'HERMES_COMPANION_AT_REST_CIPHER_KEY_2026_V1';

function buildKeySchedule(clientId: string): Uint8Array {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(DEFAULT_VAULT_SECRET);
  const clientBytes = encoder.encode(clientId || 'hermes-mobile-default');

  // FNV-1a 32-bit digest over secret::clientId so clientId diffuses into every byte from index 0
  let h1 = 0x811c9dc5;
  for (let i = 0; i < secretBytes.length; i += 1) {
    h1 ^= secretBytes[i]!;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  h1 ^= 0x3a;
  h1 = Math.imul(h1, 0x01000193) >>> 0;
  for (let i = 0; i < clientBytes.length; i += 1) {
    h1 ^= clientBytes[i]!;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }

  const scheduleLen = Math.max(64, secretBytes.length + clientBytes.length);
  const out = new Uint8Array(scheduleLen);
  let state = h1 || 0x9e3779b9;
  for (let i = 0; i < scheduleLen; i += 1) {
    state ^= (state << 13) >>> 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    const sByte = secretBytes[i % secretBytes.length]!;
    const cByte = clientBytes[i % clientBytes.length]!;
    const digestByte = (h1 >>> ((i & 3) * 8)) & 0xff;
    out[i] = (sByte ^ cByte ^ digestByte ^ (state & 0xff) ^ ((i * 37 + 0x5a) & 0xff)) & 0xff;
  }
  return out;
}

/**
 * Encrypts a Personal Access Token (`plm_pat_...`) using a multi-byte XOR stream cipher
 * and hex encoding (`enc:v1:<hex>`) so plaintext `plm_pat_...` never appears in
 * `localStorage`, `sessionStorage`, or serialized SQLite snapshots.
 */
export function encryptPat(rawPat: string, clientId = 'hermes-mobile-default'): string {
  const trimmed = rawPat.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(VAULT_CIPHER_PREFIX)) {
    return trimmed;
  }

  const key = buildKeySchedule(clientId);
  const encoder = new TextEncoder();
  const plainBytes = encoder.encode(trimmed);
  const cipherHex: string[] = [];

  for (let i = 0; i < plainBytes.length; i += 1) {
    const k = key[i % key.length] ?? 0x42;
    const mask = ((i * 19 + 0xa5) & 0xff) ^ k;
    const encryptedByte = ((plainBytes[i] ?? 0) ^ mask) & 0xff;
    cipherHex.push(encryptedByte.toString(16).padStart(2, '0'));
  }

  return `${VAULT_CIPHER_PREFIX}${cipherHex.join('')}`;
}

/**
 * Decrypts an `enc:v1:<hex>` ciphertext envelope in memory at request time.
 */
export function decryptPat(encryptedPat: string, clientId = 'hermes-mobile-default'): string {
  const trimmed = (encryptedPat || '').trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith(VAULT_CIPHER_PREFIX)) {
    return trimmed;
  }

  const hexBody = trimmed.slice(VAULT_CIPHER_PREFIX.length);
  if (hexBody.length === 0 || hexBody.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hexBody)) {
    return '';
  }

  const key = buildKeySchedule(clientId);
  const out = new Uint8Array(hexBody.length / 2);

  for (let i = 0; i < out.length; i += 1) {
    const byteVal = Number.parseInt(hexBody.slice(i * 2, i * 2 + 2), 16);
    const k = key[i % key.length] ?? 0x42;
    const mask = ((i * 19 + 0xa5) & 0xff) ^ k;
    out[i] = (byteVal ^ mask) & 0xff;
  }

  const decoder = new TextDecoder();
  return decoder.decode(out);
}

/**
 * Produces a safe display mask that never contains the full secret token.
 */
export function maskPatPrefix(rawPat: string): string {
  const trimmed = rawPat.trim();
  if (!trimmed) return '';
  const suffix = trimmed.startsWith('plm_pat_') ? trimmed.slice(8, 12) : trimmed.slice(0, 4);
  return `PAT // ${suffix.toUpperCase()}••••`;
}

export interface ParsedPairingQrPayload {
  primaryUrl: string;
  fallbackUrl: string;
  token: string;
  tokenName?: string;
}

/**
 * Parses a Desktop Pairing QR payload (`POST /api/auth/pairing-qr`) from raw JSON
 * or nested `qr_payload_json`.
 */
export function parsePairingQrPayload(rawInput: string): ParsedPairingQrPayload | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    const outer = JSON.parse(trimmed) as Record<string, unknown>;
    let source = outer;
    if (typeof outer.qr_payload_json === 'string' && outer.qr_payload_json.trim().startsWith('{')) {
      try {
        source = {
          ...outer,
          ...(JSON.parse(outer.qr_payload_json) as Record<string, unknown>),
        };
      } catch {
        // Keep outer object if nested JSON fails
      }
    }

    const primaryUrl = String(
      source.primary_url ??
        source.primaryUrl ??
        source.server_url ??
        source.base_url ??
        source.url ??
        '',
    ).trim();

    const fallbackUrl = String(
      source.fallback_url ?? source.fallbackUrl ?? '',
    ).trim();

    const token = String(
      source.token ?? source.pat ?? source.access_token ?? '',
    ).trim();

    const tokenName =
      typeof source.token_name === 'string'
        ? source.token_name
        : typeof source.tokenName === 'string'
          ? source.tokenName
          : undefined;

    if (!primaryUrl && !fallbackUrl && !token) {
      return null;
    }

    return {
      primaryUrl,
      fallbackUrl,
      token,
      tokenName,
    };
  } catch {
    return null;
  }
}
