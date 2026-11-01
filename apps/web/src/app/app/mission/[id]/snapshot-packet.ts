/**
 * A snapshot taken once the case has reached one of these stages of the reviewer workflow is the
 * application packet (Build Spec section 4.5, "pack production"), not just a working capture. The
 * case page and its All Snapshots page mark the same snapshots, so both read this one list.
 */
export const PACKET_STATES: ReadonlySet<string> = new Set(['READY_TO_EXPORT', 'LOCKED', 'CLOSED']);

/** Whether a snapshot's stored content says it was taken at a packet stage. */
export function isPacketSnapshot(content: unknown): boolean {
  const state = (content as { state?: unknown } | null)?.state;
  return typeof state === 'string' && PACKET_STATES.has(state);
}
