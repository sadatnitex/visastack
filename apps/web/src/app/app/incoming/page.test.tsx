import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  listApplicants: vi.fn(),
  hasConsent: vi.fn(),
  documentUploadReceiptsReady: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) =>
    callback({ db: {}, accountId: 'account-a' }),
}));
vi.mock('../../../lib/i18n-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/i18n-server')>()),
  primeLocale: async () => 'en',
}));
interface PanelProps {
  readonly people?: unknown;
  readonly ownerKey?: unknown;
  readonly notice?: unknown;
  readonly retryUnknown?: unknown;
  readonly limitBytes?: unknown;
}
const panel = vi.hoisted(() => ({ props: [] as PanelProps[] }));
vi.mock('./incoming-panel', () => ({
  IncomingPanel: (props: PanelProps) => {
    panel.props.push(props);
    return <div data-stub="IncomingPanel" />;
  },
}));

const { default: IncomingPage } = await import('./page');
const page = (search: Record<string, string> = {}) =>
  renderServer(IncomingPage({ searchParams: Promise.resolve(search) }));

function switchOn() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('WEB_SHARE_TARGET', 'on');
  vi.stubEnv('PWA_SERVICE_WORKER', undefined);
}

beforeEach(() => {
  vi.resetAllMocks();
  panel.props = [];
  service.listApplicants.mockResolvedValue([
    { id: 'p1', displayName: 'Rahim Example' },
    { id: 'p2', displayName: 'Nadia Example' },
  ]);
  service.hasConsent.mockResolvedValue(true);
  service.documentUploadReceiptsReady.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe('WP-PIC11 the shared files page', () => {
  it('does not exist while the share switch is off', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_SHARE_TARGET', undefined);
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('does not exist while the service worker is off', async () => {
    switchOn();
    vi.stubEnv('PWA_SERVICE_WORKER', 'off');
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it("hands the panel this account's key, its people and the normal upload limits", async () => {
    switchOn();
    const html = await page();
    expect(textOf(html)).toContain('Shared Files');
    const props = panel.props[0];
    expect(props?.people).toEqual([
      { id: 'p1', name: 'Rahim Example' },
      { id: 'p2', name: 'Nadia Example' },
    ]);
    expect(props?.ownerKey).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(props?.notice).toBeNull();
    expect(props?.retryUnknown).toBe(true);
    expect(typeof props?.limitBytes).toBe('number');
  });

  it('passes on that a share did not come through, or held nothing usable', async () => {
    switchOn();
    await page({ missed: '1' });
    expect(panel.props[0]?.notice).toBe('missed');
    await page({ none: '1' });
    expect(panel.props[1]?.notice).toBe('none');
  });

  it('after the switch went off, a phone still sharing lands on one plain line, not an error', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WEB_SHARE_TARGET', 'off');
    const html = await page({ missed: '1' });
    expect(textOf(html)).toContain('not available right now, so nothing was kept');
    expect(panel.props).toHaveLength(0);
  });

  it('asks for processing permission first, and sends nothing', async () => {
    switchOn();
    service.hasConsent.mockResolvedValue(false);
    const html = await page();
    expect(textOf(html)).toContain('Let VisaStack Process My Details');
    expect(panel.props).toHaveLength(0);
  });

  it('asks for a person first when the account has none', async () => {
    switchOn();
    service.listApplicants.mockResolvedValue([]);
    const html = await page();
    expect(textOf(html)).toContain('Add the person these documents are for');
    expect(panel.props).toHaveLength(0);
  });
});
