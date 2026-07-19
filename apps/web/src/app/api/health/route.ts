import { CORE_VERSION } from '@visastack/core';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe. Kept deliberately dependency-free so it stays
 * green even when downstream services (DB, storage, AI) are degraded — a
 * degraded dependency is reported by dedicated readiness checks in Phase 6,
 * not by flipping liveness to 500.
 */
export function GET(): Response {
  return Response.json({
    status: 'ok',
    service: 'visastack-web',
    coreVersion: CORE_VERSION,
    timestamp: new Date().toISOString(),
  });
}
