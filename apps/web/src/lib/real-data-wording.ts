import 'server-only';
import { createNeonDb, resolveDatabaseUrl } from '@visastack/db';
import type { Db } from '@visastack/services';
import { getPlatformCapabilities } from './capabilities';
import { getDeploymentMode } from './deployment-mode';
import { isPublicBetaOpen } from './public-beta';
import { readReadinessSignals, rememberedReadinessSignals } from './readiness-signals';

/**
 * Owner decision, 19 Nov 2026: "stop telling madeup details etc" once the site is live for real
 * use. The words follow the `realApplicantData` capability (every operational gate met, or
 * deferred by the owner under its register id), never deployment mode. Rolling back is unsetting
 * the deferral settings: the capability, and so the words, close again.
 */

/** Real personal data is switched on: exactly the `realApplicantData` capability, never in development. */
export function realDataOpen(): boolean {
  if (getDeploymentMode() === 'development') return false;
  return getPlatformCapabilities().realApplicantData === 'available';
}

/**
 * Whether the words invite people to use their own details and documents (at their own risk)
 * instead of asking for made-up details: real personal data is switched on, or the free public
 * beta is open (owner decision of 26 Oct 2026, #233). Made-up wording shows only when neither holds.
 * Which version name a page uses (public beta or invited pilot) still follows `isPublicBetaOpen`.
 */
export function ownDetailsWelcome(): boolean {
  return isPublicBetaOpen() || realDataOpen();
}

/** How long a page waits for the database facts before it shows the closed wording. */
export const REAL_DATA_FACTS_WAIT_MS = 1500;

let factsDb: { readonly url: string; readonly db: Db } | null = null;

/**
 * The capability reads two database facts (the AI provider settings, the scan runner's proof)
 * remembered for five minutes from the latest read on this server; while they are unknown it
 * fails closed. A page that shows these words calls this first, so the words do not fall back to
 * "made-up details" just because this server has not read them yet. It reads them only while they
 * are unknown (a shared, cached read, so at most once per five minutes per server), waits at most
 * `REAL_DATA_FACTS_WAIT_MS`, and never throws. Unknown facts are never guessed: if the read fails
 * or is slow, the capability stays closed and the closed wording shows.
 */
export async function refreshRealDataFacts(): Promise<void> {
  if (getDeploymentMode() === 'development') return;
  if (rememberedReadinessSignals().aiProvider.kind !== 'unknown') return;
  const url = resolveDatabaseUrl(process.env);
  if (!url) return;
  if (factsDb?.url !== url) factsDb = { url, db: createNeonDb(url) as unknown as Db };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      readReadinessSignals(factsDb.db),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, REAL_DATA_FACTS_WAIT_MS);
      }),
    ]);
  } catch {
    // readReadinessSignals never throws; a failure leaves the facts unknown and the words closed.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `realDataOpen` after `refreshRealDataFacts`. */
export async function resolveRealDataOpen(): Promise<boolean> {
  await refreshRealDataFacts();
  return realDataOpen();
}

/** `ownDetailsWelcome` after `refreshRealDataFacts`. */
export async function resolveOwnDetailsWelcome(): Promise<boolean> {
  await refreshRealDataFacts();
  return ownDetailsWelcome();
}
