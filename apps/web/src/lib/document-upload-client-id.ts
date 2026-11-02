/**
 * Upload ids (UMPE P3): one per file, kept for every attempt at sending that file, so the server
 * answers a repeat with the copy it already stored instead of storing a second one. A version 4
 * UUID from the browser's own random source; older browsers without `randomUUID` build one from
 * `getRandomValues`.
 */
export function newUploadId(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
