/**
 * UMPE P1, R09: the static destination data (packages/core/src/destinations) is a research lead,
 * never a verified checklist. It can never produce a ready readiness state or a linked checklist:
 * readiness comes only from a reviewed, published pack attached to the case, and the matching
 * reads only published catalogue packs from the database.
 *
 * Synthetic people only; the destination rows are the shipped static data as it is.
 */
import { readFileSync } from 'node:fs';
import { isErr, isOk } from '@visastack/core';
import { DESTINATIONS, DESTINATION_ROUTES } from '@visastack/core/destinations';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { computeReadiness, createMission } from './missions';
import { findMatchingPublicPack, listFittingPublicPacks } from './pack-matching';

const TEST_TIMEOUT_MS = 120_000;

/** The modules that decide readiness, checklists and matching. */
const DECIDING_MODULES = [
  'missions.ts',
  'packs.ts',
  'pack-matching.ts',
  'rule-conditions.ts',
] as const;

function source(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
}

describe('UMPE P1 R09: static destination data never becomes a verified checklist', () => {
  it('no readiness, checklist or matching module reads the static destination data', () => {
    for (const file of DECIDING_MODULES) {
      expect(source(file)).not.toMatch(/destinations/);
    }
  });

  it('the one service that reads it records a visit and writes no case or checklist', () => {
    const countryStart = source('country-start.ts');
    expect(countryStart).toMatch(/@visastack\/core\/destinations/);
    expect(countryStart).not.toMatch(/schema\.|packVersion|attachPack|createMission|missions/);
  });

  describe('with every shipped destination and route', () => {
    let db: Db;
    let actor: string;
    let applicantId: string;
    beforeAll(async () => {
      const client = await createMigratedPglite();
      db = drizzle(client, { schema }) as unknown as Db;
      const account = await provisionAccount(db, { email: 'r09@example.com' });
      if (!isOk(account)) throw new Error('provision');
      actor = account.value.id;
      await setConsent(db, {
        actorAccountId: actor,
        accountId: actor,
        type: 'CORE_PROCESSING',
        granted: true,
      });
      const applicant = await createApplicant(db, {
        actorAccountId: actor,
        ownerAccountId: actor,
        displayName: 'Synthetic Traveller',
      });
      if (!isOk(applicant)) throw new Error('applicant');
      applicantId = applicant.value.id;
    }, TEST_TIMEOUT_MS);

    it('the shipped data is not empty, so the checks below cover real rows', () => {
      expect(DESTINATIONS.length).toBeGreaterThan(0);
      expect(DESTINATION_ROUTES.length).toBeGreaterThan(0);
    });

    it(
      'no route links or lists a checklist when no published pack exists',
      async () => {
        const known = { terms: ['Bangladesh', 'BD'], known: true };
        for (const route of DESTINATION_ROUTES) {
          const destination = DESTINATIONS.find((d) => d.country === route.country);
          const terms = {
            country: [route.country, ...(destination ? [destination.iso2] : [])],
            purpose: [route.purpose],
            route: [route.name, ...(route.code ? [route.code] : [])],
            traveller: { nationality: known, residence: known },
          };
          expect(await findMatchingPublicPack(db, terms)).toBeNull();
          expect(await listFittingPublicPacks(db, terms)).toEqual([]);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'a case started from a static destination has no readiness and is never ready',
      async () => {
        const thin = DESTINATIONS.find((d) => !d.researched) ?? DESTINATIONS[0];
        const rich = DESTINATIONS.find((d) => d.researched) ?? DESTINATIONS[0];
        for (const destination of [thin, rich]) {
          if (!destination) throw new Error('destinations');
          const route = DESTINATION_ROUTES.find((r) => r.country === destination.country);
          const mission = await createMission(db, {
            actorAccountId: actor,
            applicantId,
            title: `Synthetic ${destination.country}`,
            destination: destination.country,
            jurisdiction: destination.iso2,
            ...(route ? { purpose: route.purpose } : {}),
          });
          if (!isOk(mission)) throw new Error('mission');
          expect(mission.value.packVersionId).toBeNull();
          const readiness = await computeReadiness(db, mission.value.id);
          expect(isErr(readiness)).toBe(true);
        }
      },
      TEST_TIMEOUT_MS,
    );
  });
});
