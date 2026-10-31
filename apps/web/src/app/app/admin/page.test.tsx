import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  getMigrationStatus: vi.fn(),
  collectOperationalSignals: vi.fn(),
  getPilotScorecard: vi.fn(),
  getPlatformOverview: vi.fn(),
  getPlatformEvidenceBytes: vi.fn(),
  getProductAnalytics: vi.fn(),
  listFailedJobs: vi.fn(),
  totalAiCostUnits: vi.fn(),
  resolveAiLimits: vi.fn(),
  evaluateReadiness: vi.fn(),
  getDeploymentMode: vi.fn(),
  travellerPlansEnabled: vi.fn(),
  personBillingPresent: vi.fn(),
  personRefundGuardPresent: vi.fn(),
  paymentMode: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../lib/admin', () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
  bootstrapAdminEmails: () => [],
}));
vi.mock('@visastack/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/db')>()),
  getMigrationStatus: (...args: unknown[]) => mocks.getMigrationStatus(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  collectOperationalSignals: (...args: unknown[]) => mocks.collectOperationalSignals(...args),
  getPilotScorecard: (...args: unknown[]) => mocks.getPilotScorecard(...args),
  getPlatformOverview: (...args: unknown[]) => mocks.getPlatformOverview(...args),
  getPlatformEvidenceBytes: (...args: unknown[]) => mocks.getPlatformEvidenceBytes(...args),
  getProductAnalytics: (...args: unknown[]) => mocks.getProductAnalytics(...args),
  listFailedJobs: (...args: unknown[]) => mocks.listFailedJobs(...args),
  totalAiCostUnits: (...args: unknown[]) => mocks.totalAiCostUnits(...args),
  travellerPlansEnabled: () => mocks.travellerPlansEnabled(),
  personBillingPresent: (...args: unknown[]) => mocks.personBillingPresent(...args),
  personRefundGuardPresent: (...args: unknown[]) => mocks.personRefundGuardPresent(...args),
}));
vi.mock('../../../lib/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/providers')>()),
  paymentMode: () => mocks.paymentMode(),
}));
vi.mock('../../../lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai')>()),
  resolveAiLimits: (...args: unknown[]) => mocks.resolveAiLimits(...args),
}));
vi.mock('../../../lib/readiness', () => ({ evaluateReadiness: mocks.evaluateReadiness }));
vi.mock('../../../lib/deployment-mode', () => ({ getDeploymentMode: mocks.getDeploymentMode }));
vi.mock('./action-buttons', async () => {
  const { stub } = await import('../../../lib/next-mocks.test-support');
  return { RetryJobButton: stub('RetryJobButton') };
});
vi.mock('./reconcile-buttons', async () => {
  const { stub } = await import('../../../lib/next-mocks.test-support');
  return { ReconcileButtons: stub('ReconcileButtons') };
});

const { default: Page } = await import('./page');

const readiness = {
  ready: false,
  status: 'degraded',
  deploymentMode: 'controlled_pilot',
  env: {
    database: { DATABASE_URL: true },
    signIn: { NEON_AUTH_BASE_URL: true, NEON_AUTH_COOKIE_SECRET: false },
  },
  db: { connected: true, schemaApplied: true },
  migrations: { checked: true, applied: 83, expected: 84, pending: ['0083_example'] },
  providers: { valid: true },
  hosting: { ready: true },
  capabilities: { signedBlobStorage: true, asyncIntakeSweep: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.getPlatformOverview.mockResolvedValue({
    ok: true,
    value: {
      accounts: 9,
      travellers: 4,
      agencies: 2,
      approvedVersions: 0,
      terminalVersions: 0,
      activity: [],
    },
  });
  mocks.getDeploymentMode.mockReturnValue('controlled_pilot');
  mocks.getMigrationStatus.mockResolvedValue({
    checked: true,
    applied: 83,
    expected: 84,
    pending: [],
  });
  mocks.collectOperationalSignals.mockResolvedValue([
    {
      key: 'database_migrations',
      label: 'Database migrations',
      status: 'critical',
      reading: '1 migration pending',
      detail: 'Run the manual migration workflow.',
    },
    {
      key: 'intake_queue_age',
      label: 'Intake queue age',
      status: 'ok',
      reading: 'Nothing waiting',
      detail: 'Age of the oldest due job.',
    },
  ]);
  mocks.getPilotScorecard.mockResolvedValue([
    { eventType: 'MISSION_CREATED', total: 4, last7Days: 2 },
    { eventType: 'ACCOUNT_CREATED', total: 9, last7Days: 3 },
  ]);
  mocks.getPlatformEvidenceBytes.mockResolvedValue(1024);
  mocks.getProductAnalytics.mockResolvedValue({ available: false, reason: 'schema_pending' });
  mocks.listFailedJobs.mockResolvedValue([
    {
      id: 'j1',
      documentName: 'passport.pdf',
      errorCode: 'ocr_timeout',
      attempts: 5,
      maxAttempts: 5,
      lastError: 'timed out',
    },
  ]);
  mocks.totalAiCostUnits.mockResolvedValue(0);
  mocks.resolveAiLimits.mockResolvedValue({ budgetLimitUnits: 1_000_000 });
  mocks.evaluateReadiness.mockResolvedValue(readiness);
  mocks.travellerPlansEnabled.mockReturnValue(false);
  mocks.personBillingPresent.mockResolvedValue(true);
  mocks.personRefundGuardPresent.mockResolvedValue(true);
  mocks.paymentMode.mockReturnValue(null);
});

/** The Traveller Plans row of the readiness detail: its words and whether it is shown as a problem. */
function travellerPlansRowOf(html: string): { value: string; problem: boolean } {
  const match = html.match(
    /<span class="row-key">Traveller Plans<\/span><span class="([^"]*)"[^>]*>([^<]*)<\/span>/,
  );
  if (!match) throw new Error('no Traveller Plans row');
  return { value: match[2] ?? '', problem: (match[1] ?? '').includes('badge-danger') };
}

describe('Platform Readiness Detail: Traveller Plans (ADR 0025 T6)', () => {
  it('says Off while traveller plans are not sold', async () => {
    const html = await renderServer(Page());
    expect(travellerPlansRowOf(html)).toEqual({ value: 'Off', problem: false });
  });

  it('says Test, and who can pay, while payments are in test mode', async () => {
    mocks.travellerPlansEnabled.mockReturnValue(true);
    mocks.paymentMode.mockReturnValue('TEST');
    mocks.personRefundGuardPresent.mockResolvedValue(false);
    const html = await renderServer(Page());
    // No real money moves in test mode, so a missing refund guard is not a problem yet.
    expect(travellerPlansRowOf(html)).toEqual({
      value: 'Test (only the platform owner can pay), Refunds not ready yet',
      problem: false,
    });
  });

  it('says Live when on and live, with every migration in place', async () => {
    mocks.travellerPlansEnabled.mockReturnValue(true);
    mocks.paymentMode.mockReturnValue('LIVE');
    const html = await renderServer(Page());
    expect(travellerPlansRowOf(html)).toEqual({ value: 'Live', problem: false });
  });

  it('says Database behind when migrations 0110 or 0111 are missing', async () => {
    mocks.personBillingPresent.mockResolvedValue(false);
    mocks.personRefundGuardPresent.mockResolvedValue(false);
    const html = await renderServer(Page());
    expect(travellerPlansRowOf(html)).toEqual({
      value: 'Off, Database behind, Refunds not ready yet',
      problem: false,
    });
  });

  it('marks Live without the refund guard of migration 0112 as a problem, and nothing else changes', async () => {
    mocks.travellerPlansEnabled.mockReturnValue(true);
    mocks.paymentMode.mockReturnValue('LIVE');
    mocks.personRefundGuardPresent.mockResolvedValue(false);
    mocks.evaluateReadiness.mockResolvedValue({ ...readiness, ready: true, status: 'ready' });
    const html = await renderServer(Page());
    expect(travellerPlansRowOf(html)).toEqual({
      value: 'Live, Refunds not ready yet',
      problem: true,
    });
    // The overall reading still comes from evaluateReadiness alone.
    const text = textOf(html);
    expect(text).toMatch(/Overall\s*Ready/);
    expect(text).not.toContain('Degraded: something required is missing');
  });

  it('says the database could not be checked when the probe fails, and names the section', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.travellerPlansEnabled.mockReturnValue(true);
    mocks.paymentMode.mockReturnValue('LIVE');
    mocks.personRefundGuardPresent.mockRejectedValue(new Error('permission denied for pg_proc'));
    const html = await renderServer(Page());
    expect(travellerPlansRowOf(html)).toEqual({
      value: 'Live, Database could not be checked',
      problem: true,
    });
    expect(textOf(html)).toContain('traveller plans');
  });
});

describe('Platform > Operations', () => {
  it('uses real aggregate totals, an explicit no-measurement state and a separate operational rail', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Registered Accounts');
    expect(text).toContain('Traveller Records');
    expect(text).toContain('Not measured');
    expect(html).toContain('admin-reference-working-area');
    expect(html).toContain('admin-reference-rail');
    expect(text).toContain('Recorded Activity, Last 30 Days');
  });
  it('shows unavailable global counts when the independent aggregate reader fails', async () => {
    mocks.getPlatformOverview.mockRejectedValue(new Error('Read unavailable'));
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Activity counts are unavailable. No trend is inferred.');
    expect(text).toContain('Unavailable');
  });
  it('is the landing page of the platform area and names itself Operations', async () => {
    const html = await renderServer(Page());
    expect(html).toContain('>Operations<');
    expect(textOf(html)).toContain('Platform health, readiness, capacity and pilot measurement.');
  });

  it('shows every signal with its status and the explanation behind it', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Operational Signals');
    expect(text).toContain('Database migrations');
    expect(text).toContain('1 migration pending');
    expect(text).toContain('Critical');
    expect(text).toContain('Intake queue age');
    expect(text).toContain('Run the manual migration workflow.');
    expect(html).toContain('id="admin-signals"');
  });

  it('hands the signals the AI figures and the migration status it just read', async () => {
    await renderServer(Page());
    const options = mocks.collectOperationalSignals.mock.calls[0]?.[1];
    expect(options.ai.spentUnits).toBe(0);
    expect(options.ai.limitUnits).toBe(1_000_000);
    expect(options.migrations).toEqual({ checked: true, applied: 83, expected: 84, pending: [] });
  });

  it('shows the readiness detail, naming what is missing but never a value', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Platform Readiness Detail');
    expect(text).toContain('Degraded: something required is missing');
    expect(text).toContain('1 pending: 0083_example');
    expect(text).toContain('missing: NEON_AUTH_COOKIE_SECRET');
    expect(html).toContain('id="admin-platform-readiness"');
  });

  it('labels the pilot scorecard in product words', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Product Scorecard');
    expect(text).toContain('Cases Started');
    expect(text).toContain('Accounts Created');
  });

  it('explains that the learning-area figures wait for a database update instead of showing zeros', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Learning Areas');
    expect(text).toContain('Waiting for a database update');
  });

  it('lists a failed intake job with its error code and a retry control', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('passport.pdf');
    expect(text).toContain('ocr_timeout');
    expect(text).toContain('5/5 attempts');
    expect(stubProps<{ jobId: string }>(html, 'RetryJobButton').map((p) => p.jobId)).toEqual([
      'j1',
    ]);
    expect(stubProps(html, 'ReconcileButtons')).toHaveLength(1);
  });

  it('says commercial mode does not apply yet while the deployment is a controlled pilot', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Commercial Readiness');
    expect(text).toContain('controlled_pilot');
    expect(text).toContain('this guard does not apply yet');
    expect(text).not.toContain('gates satisfied');
  });

  it('shows the commercial gate breakdown from the readiness report in commercial mode', async () => {
    mocks.getDeploymentMode.mockReturnValue('commercial');
    mocks.evaluateReadiness.mockResolvedValue({
      ...readiness,
      commercial: {
        ready: false,
        gates: [{ key: 'pentest', label: 'Penetration test', satisfied: false }],
      },
    });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('0 of 1 gates satisfied');
    expect(text).toContain('Penetration test');
    expect(text).toContain('unmet');
  });

  it('says commercial readiness could not be evaluated when the readiness report failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getDeploymentMode.mockReturnValue('commercial');
    mocks.evaluateReadiness.mockRejectedValue(new Error('probe failed'));
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Commercial readiness could not be evaluated');
    expect(text).not.toContain('this guard does not apply yet');
  });

  it('shows the owner deferral and a refused deferral from the real guard, and never a configured value (S27)', async () => {
    const MARK = 'S27SECRETMARK';
    try {
      for (const name of [
        'RESEND_API_KEY',
        'STEP_UP_SIGNING_SECRET',
        'BLOB_READ_WRITE_TOKEN',
        'OPENAI_API_KEY',
      ]) {
        vi.stubEnv(name, `${MARK}-${name}`);
      }
      vi.stubEnv('COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST', 'H01');
      vi.stubEnv('COMMERCIAL_READINESS_DEFER_REAL_KEY_MANAGEMENT', 'H01');
      vi.stubEnv('COMMERCIAL_READINESS_DEFER_STEP_UP', `${MARK}-pasted`);
      const { evaluateCommercialReadiness } = await vi.importActual<
        typeof import('../../../lib/commercial-readiness')
      >('../../../lib/commercial-readiness');
      const commercial = evaluateCommercialReadiness({
        databaseReady: true,
        signals: { aiProvider: { kind: 'none_active' }, scannerEvidenceFresh: false },
      });
      mocks.getDeploymentMode.mockReturnValue('commercial');
      mocks.evaluateReadiness.mockResolvedValue({ ...readiness, commercial });
      const html = await renderServer(Page());
      const text = textOf(html);
      expect(text).toContain('Deferred by Owner (H01)');
      expect(text).toContain('1 of them deferred by the owner');
      expect(text).toContain('real key management (KMS) (Deferral Not Accepted)');
      expect(text).toContain('step-up (Deferral Not Accepted)');
      expect(html).not.toContain(MARK);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 15_000);

  it('refuses anyone who is not a platform administrator, without reading a figure', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('restricted to platform administrators');
    expect(mocks.getPilotScorecard).not.toHaveBeenCalled();
    expect(mocks.collectOperationalSignals).not.toHaveBeenCalled();
    expect(mocks.evaluateReadiness).not.toHaveBeenCalled();
  });

  it('keeps the page up when a table is missing, and names exactly what could not be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.totalAiCostUnits.mockRejectedValue(new Error('relation "ocr_runs" does not exist'));
    mocks.getPilotScorecard.mockRejectedValue(
      new Error('relation "product_events" does not exist'),
    );
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Some Sections Could Not Be Loaded');
    expect(text).toContain('AI cost');
    expect(text).toContain('product scorecard');
    // the rest of the page is still there
    expect(text).toContain('Operational Signals');
    expect(text).toContain('Platform Readiness Detail');
    expect(html).toContain('role="alert"');
  });
});

it('does not show zero spend or capacity meters when the readings are unavailable', async () => {
  mocks.getPlatformEvidenceBytes.mockRejectedValue(new Error('synthetic unavailable'));
  mocks.totalAiCostUnits.mockRejectedValue(new Error('synthetic unavailable'));
  const html = await renderServer(await Page());
  expect(textOf(html)).toContain('Evidence storage could not be read');
  expect(textOf(html)).toContain('AI usage or its limit could not be read');
  expect(html).not.toContain('meter-fill');
  expect(textOf(html)).not.toContain('$0.00 of');
  expect(mocks.collectOperationalSignals.mock.calls[0]?.[1]).not.toHaveProperty('ai');
});
