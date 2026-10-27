import { type SystemJob, type SystemScope, systemPrincipal } from './principal';

/**
 * A scheduled job's scope for a test. Only the job routes and this folder may name
 * `systemPrincipal` (enforcement.test.ts), so a test that needs a scope asks for it here.
 */
export function systemScopeForTest<J extends SystemJob>(job: J): SystemScope<J> {
  return systemPrincipal(job);
}
