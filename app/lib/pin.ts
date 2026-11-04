/**
 * PIN hashing for the lock screen.
 *
 * Deliberately a small synchronous hash (salted djb2 variant, double pass)
 * rather than crypto.subtle — the app also runs over plain http on LAN
 * clients where SubtleCrypto is unavailable. This is a UI lock, not a
 * cryptographic boundary; the goal is that the raw PIN never sits in
 * settings in plaintext.
 */

const SALT = 'jarvis-lock-v1';

function djb2(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

export function hashPin(pin: string): string {
  const a = djb2(`${SALT}:${pin}`);
  const b = djb2(`${pin}:${SALT}:${a}`);
  return `${a.toString(16)}-${b.toString(16)}`;
}

export function verifyPin(pin: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false;
  return hashPin(pin) === storedHash;
}
