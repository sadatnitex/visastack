import { randomBytes } from 'node:crypto';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type KeyManagementPort,
  createApplicant,
  createMission,
  issueStepUpAssurance,
  provisionAccount,
  setConsent,
  verifyStepUp,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  /** What the identity check answers: a proof, or a request to sign in again. */
  stepUp: 'proof' as 'proof' | 'reauth' | 'not_configured',
  /** Makes the audit entry fail, as a database fault would. */
  auditFails: false,
}));

vi.mock('@visastack/services', async (importOriginal) => {
  const real = await importOriginal<typeof import('@visastack/services')>();
  return {
    ...real,
    recordOutputPrepared: (...args: Parameters<typeof real.recordOutputPrepared>) =>
      state.auditFails
        ? Promise.resolve({ ok: false, error: { code: 'upstream_error', message: 'down' } })
        : real.recordOutputPrepared(...args),
  };
});

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string; email: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId, email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));

const masterKey = Buffer.alloc(32, 9);
const keys: KeyManagementPort = {
  currentKeyVersion: () => 'test-v1',
  async generateDataKey() {
    return { keyVersion: 'test-v1', plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
  },
  async unwrapDataKey() {
    return masterKey;
  },
};
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: () => keys }));
vi.mock('../../../../../lib/step-up', () => ({
  establishStepUpProof: async (request: {
    accountId: string;
    action: 'EXPORT_PROFILE';
    resourceId: string;
  }) => {
    if (state.stepUp === 'reauth')
      return { kind: 'reauth_required', reauthUrl: '/auth/reauth?x=1' };
    if (state.stepUp === 'not_configured') return { kind: 'not_configured' };
    const secret = 'test-secret';
    const proof = verifyStepUp(secret, issueStepUpAssurance(secret, request), request);
    return { kind: 'proof', proof };
  },
}));

const { default: OutputsPage } = await import('./page');

let applicantId: string;
let missionId: string;

const render = (query: Record<string, string>) =>
  renderServer(
    OutputsPage({
      params: Promise.resolve({ id: applicantId }),
      searchParams: Promise.resolve(query),
    }),
  );

beforeEach(async () => {
  const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  const account = await provisionAccount(db, { email: 'owner@example.com' });
  if (!account.ok) throw new Error('account');
  state.accountId = account.value.id;
  await setConsent(db, {
    actorAccountId: state.accountId,
    accountId: state.accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: state.accountId,
    ownerAccountId: state.accountId,
    displayName: 'Nusrat Jahan',
  });
  if (!applicant.ok) throw new Error('applicant');
  applicantId = applicant.value.id;
  const mission = await createMission(db, {
    actorAccountId: state.accountId,
    applicantId,
    title: 'London trip',
    destination: 'United Kingdom',
  });
  if (!mission.ok) throw new Error('mission');
  missionId = mission.value.id;
}, 60_000);

describe('the printed cover on the briefs and summaries page', () => {
  it.each(['trip_essentials', 'agency_brief', 'case_handover'])(
    'puts the cover and a print button on the %s preview',
    async (output) => {
      const html = await render({ output, preview: '1', case: missionId });
      expect(html).toContain('data-print-cover="true"');
      const text = textOf(html);
      expect(text).toContain('Nusrat Jahan');
      expect(text).toContain('United Kingdom');
      expect(text).toContain('This shows what is gathered, not whether a visa will be approved.');
      expect(html).toContain('src="/flags/gb.svg"');
      expect(text).toContain('Print This Page');
      // The cover comes first, before the preview heading, so it is the first printed page.
      expect(html.indexOf('data-print-cover')).toBeLessThan(html.indexOf('output-preview-heading'));
    },
  );

  it('does not put the cover on an output that is not about a case', async () => {
    const html = await render({ output: 'confirmed_sheet', preview: '1' });
    expect(html).not.toContain('data-print-cover');
    expect(textOf(html)).not.toContain('Print This Page');
  });

  it('does not put the cover on the AI text, which is not a printed pack', async () => {
    const html = await render({ output: 'ai_context', preview: '1', case: missionId });
    expect(html).not.toContain('data-print-cover');
  });

  it('adds no picture address that is not from this site', async () => {
    const html = await render({ output: 'trip_essentials', preview: '1', case: missionId });
    expect(html).not.toMatch(/src="(data|blob):/);
  });
});
