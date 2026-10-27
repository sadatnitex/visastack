import { type SystemJob, type SystemScope, systemPrincipal } from './principal';

/**
 * Test-only (not exported from the package index): the scope a scheduled job runs under, for
 * tests of services that take one. `systemPrincipal` itself may only be referenced by the job
 * routes and by code in this folder, which is why tests reach it through here.
 */
export function systemScopeForTest<J extends SystemJob>(job: J): SystemScope<J> {
  return systemPrincipal(job);
}
