import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps } from '../../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({ listApplicants: vi.fn(), tripTablesReady: vi.fn() }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('./start-form', () => ({ TripStartForm: stub('TripStartForm') }));

const { default: TripStartPage } = await import('./page');

const OWN = [
  { id: 'mine', displayName: 'Rahima Akter' },
  { id: 'also-mine', displayName: 'Karim Hossain' },
];
const render = (traveller?: string | string[]) =>
  renderServer(
    TripStartPage({ searchParams: Promise.resolve(traveller === undefined ? {} : { traveller }) }),
  );
const chosen = async (traveller?: string | string[]) =>
  stubProps<{ initialTravellerId?: string }>(await render(traveller), 'TripStartForm')[0]
    ?.initialTravellerId;

beforeEach(() => {
  vi.resetAllMocks();
  service.listApplicants.mockResolvedValue(OWN);
  service.tripTablesReady.mockResolvedValue(false);
});

describe('Start a Trip: a traveller named in the address', () => {
  it('chooses a traveller who is on the signed-in account', async () => {
    expect(await chosen('also-mine')).toBe('also-mine');
  });

  it("ignores anyone who is not one of this account's own travellers", async () => {
    expect(await chosen('someone-elses-id')).toBeUndefined();
  });

  it('ignores a repeated or missing value', async () => {
    expect(await chosen(['mine', 'also-mine'])).toBeUndefined();
    expect(await chosen()).toBeUndefined();
  });

  it("still lists only the account's own travellers to the form", async () => {
    const html = await render('someone-elses-id');
    const [props] = stubProps<{ travellers: { applicantId: string }[] }>(html, 'TripStartForm');
    expect(props?.travellers.map((t) => t.applicantId)).toEqual(['mine', 'also-mine']);
  });
});
