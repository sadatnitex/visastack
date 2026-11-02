import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';
import {
  AgencyCollectionScope,
  CollectionLinkProof,
  agencyCollectionPrincipal,
  agencyCollectionScopeProblem,
  collectionLinkProof,
} from './collection-scope';

/** The agency document request gates cannot be forged, copied or kept (UMPE P6). */

vi.mock('../organizations', () => ({ isOrgAdmin: async () => true }));

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const TOKEN = 'B'.repeat(43);

beforeEach(() => vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'true'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('AgencyCollectionScope', () => {
  it('is minted only by agencyCollectionPrincipal, and a copy, a literal or a constructor call is refused', async () => {
    const minted = await agencyCollectionPrincipal({} as Db, ACCOUNT, ORG);
    if (!minted.ok) throw new Error('refused');
    const scope = minted.value;
    expect(AgencyCollectionScope.isGenuine(scope)).toBe(true);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(agencyCollectionScopeProblem(scope)).toBeUndefined();
    expect(agencyCollectionScopeProblem({ ...scope })?.code).toBe('not_found');
    expect(
      agencyCollectionScopeProblem({
        kind: 'agency_collection',
        accountId: ACCOUNT,
        organizationId: ORG,
        verifiedAt: new Date(),
      })?.code,
    ).toBe('not_found');
    const Ctor = AgencyCollectionScope as unknown as new (a: string, o: string) => unknown;
    expect(() => new Ctor(ACCOUNT, ORG)).toThrow(/agencyCollectionPrincipal/);
  });

  it('is good for one request only: an old scope is refused and its time cannot be moved', async () => {
    const minted = await agencyCollectionPrincipal({} as Db, ACCOUNT, ORG);
    if (!minted.ok) throw new Error('refused');
    const scope = minted.value;
    vi.useFakeTimers({ now: Date.now() + 6 * 60 * 1000 });
    expect(agencyCollectionScopeProblem(scope)?.code).toBe('not_found');
    scope.verifiedAt.setTime(Date.now());
    expect(agencyCollectionScopeProblem(scope)?.code).toBe('not_found');
  });

  it('is refused while the switch is off, and for malformed ids', async () => {
    expect((await agencyCollectionPrincipal({} as Db, 'x', ORG)).ok).toBe(false);
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'false');
    expect((await agencyCollectionPrincipal({} as Db, ACCOUNT, ORG)).ok).toBe(false);
  });
});

describe('CollectionLinkProof', () => {
  it('is made only from a well-formed token and only while the switch is on', () => {
    const proof = collectionLinkProof(TOKEN);
    expect(proof && CollectionLinkProof.isGenuine(proof)).toBe(true);
    expect(proof?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(proof?.tokenHash).not.toContain(TOKEN);
    expect(CollectionLinkProof.isGenuine({ ...proof })).toBe(false);
    for (const bad of ['', 'short', `${TOKEN}=`, null, 42])
      expect(collectionLinkProof(bad)).toBeNull();
    const Ctor = CollectionLinkProof as unknown as new (h: string) => unknown;
    expect(() => new Ctor('a'.repeat(64))).toThrow(/collectionLinkProof/);
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', '');
    expect(collectionLinkProof(TOKEN)).toBeNull();
  });
});
