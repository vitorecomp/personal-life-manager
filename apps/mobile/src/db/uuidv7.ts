export const RFC9562_UUIDV7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let lastTimestampMs = -1;
let monotonicCounter = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Generates a time-ordered RFC 9562 UUIDv7 identifier (`019...`).
 * Guarantees strict monotonic lexicographical ordering across same-millisecond bursts
 * (> 4,096 IDs/ms via timestamp carry) and negative clock jitter (`rawTs <= lastTimestampMs`).
 */
export function generateUuidV7(nowMs: number = Date.now()): string {
  const rawTs = Math.max(0, Math.floor(nowMs));
  if (rawTs <= lastTimestampMs) {
    monotonicCounter += 1;
    if (monotonicCounter > 0x0fff) {
      lastTimestampMs += 1;
      monotonicCounter = 0;
    }
  } else {
    lastTimestampMs = rawTs;
    const seed = randomBytes(2);
    // 10-bit random seed leaves 3,072 increments of headroom before timestamp rollover
    monotonicCounter = (((seed[0] ?? 0) << 8) | (seed[1] ?? 0)) & 0x03ff;
  }

  const hexTs = BigInt(lastTimestampMs).toString(16).padStart(12, '0').slice(-12);
  const randA = monotonicCounter.toString(16).padStart(3, '0').slice(-3);

  const randBBytes = randomBytes(8);
  randBBytes[0] = ((randBBytes[0] ?? 0) & 0x3f) | 0x80; // Variant 10xx (8, 9, a, b)
  const randBHex = Array.from(randBBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${hexTs.slice(0, 8)}-${hexTs.slice(8, 12)}-7${randA}-${randBHex.slice(0, 4)}-${randBHex.slice(4, 16)}`;
}

export function isValidUuidV7(value: string): boolean {
  return RFC9562_UUIDV7_RE.test(value);
}
