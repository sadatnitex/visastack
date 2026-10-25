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
  evaluateCommercialReadiness: vi.fn(),
  getDeploymentMode: vi.fn(),
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
}));
vi.mock('../../../lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai')>()),
  resolveAiLimits: (...args: unknown[]) => mocks.resolveAiLimits(...args),
}));
vi.mock('../../../lib/readiness', () => ({ evaluateReadiness: mocks.evaluateReadiness }));
vi.mock('../../../lib/commercial-readiness', () => ({
  evaluateCommercialReadiness: mocks.evaluateCommercialReadiness,
}));
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
  mocks.evaluateCommercialReadiness.mockReturnValue({
    ready: false,
    gates: [{ key: 'pentest', label: 'Penetration test', satisfied: false }],
  });
});

describe('Platform > Operations', () => {
  it('uses real aggregate totals, an explicit no-measurement state and a separate operational rail', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Registered accounts');
    expect(text).toContain('Traveller records');
    expect(text).toContain('Not measured');
    expect(html).toContain('admin-reference-working-area');
    expect(html).toContain('admin-reference-rail');
    expect(text).toContain('Recorded activity, last 30 days');
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
    expect(text).toContain('Operational signals');
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
    expect(text).toContain('Platform readiness detail');
    expect(text).toContain('Degraded: something required is missing');
    expect(text).toContain('1 pending: 0083_example');
    expect(text).toContain('missing: NEON_AUTH_COOKIE_SECRET');
    expect(html).toContain('id="admin-platform-readiness"');
  });

  it('labels the pilot scorecard in product words', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Product scorecard');
    expect(text).toContain('Cases started');
    expect(text).toContain('Accounts created');
  });

  it('explains that the learning-area figures wait for a database update instead of showing zeros', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Learning areas');
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
    expect(text).toContain('Commercial readiness');
    expect(text).toContain('controlled_pilot');
    expect(text).toContain('this guard does not apply yet');
    expect(mocks.evaluateCommercialReadiness).not.toHaveBeenCalled();
  });

  it('shows the commercial gate breakdown in commercial mode', async () => {
    mocks.getDeploymentMode.mockReturnValue('commercial');
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('0 of 1 gates satisfied');
    expect(text).toContain('Penetration test');
    expect(text).toContain('unmet');
  });

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
    expect(text).toContain('Some sections could not be loaded');
    expect(text).toContain('AI cost');
    expect(text).toContain('product scorecard');
    // the rest of the page is still there
    expect(text).toContain('Operational signals');
    expect(text).toContain('Platform readiness detail');
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
