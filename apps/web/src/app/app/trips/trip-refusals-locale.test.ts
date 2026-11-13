import { type ServiceError, keyedError, serviceError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The trip screens' refusals in the visitor's language. Every place the trip actions show a
 * service's words goes through the services message list; the lines the actions say before the
 * service is asked (a made-up id, a name or address checked first, the feature switched off) use
 * the service's own key, so a real and a made-up record get one answer in each language.
 * Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const svc = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listApplicants: vi.fn(),
  getTrip: vi.fn(),
  tripCompanionsAvailable: vi.fn(),
  addCompanion: vi.fn(),
  removeCompanion: vi.fn(),
  resendInvitation: vi.fn(),
  addTravellerToTrip: vi.fn(),
  removeTravellerFromTrip: vi.fn(),
  addTripEvidence: vi.fn(),
  setTripEvidenceAllowance: vi.fn(),
  removeTripEvidence: vi.fn(),
  createApplicant: vi.fn(),
  startGroupTrip: vi.fn(),
}));

vi.mock('../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (s: unknown) => unknown) => fn({ db: {}, accountId: 'account-1' }),
}));
vi.mock('../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('../../../lib/providers', () => ({ createKeyManagementPort: () => ({}) }));
vi.mock('../../../lib/send-now', () => ({ sendEmailNow: vi.fn() }));
vi.mock('./trip-data', () => ({ tripExists: async () => true }));
vi.mock('./trip-checklist', () => ({ linkTripChecklist: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error;
  },
}));

const actions = await import('./actions');
const { companionRefusalField } = await import('./companion-field');

const BENGALI = /[ঀ-৿]/;
const PREV = { ok: true, message: '' };
const TRIP = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const EVIDENCE = '44444444-4444-4444-8444-444444444444';
const NAME = 'Synthetic Traveller';
const bn = serviceMessages.bn as Readonly<Record<string, string>>;

function form(fields: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of typeof value === 'string' ? [value] : value) data.append(name, one);
  }
  return data;
}

const refused = (error: ServiceError) => ({ ok: false, error });

interface Row {
  readonly name: string;
  readonly key: ServiceMessageKey;
  readonly code?: ServiceError['code'];
  readonly field?: string;
  /** Words the action puts before the refusal (the traveller it is about). */
  readonly prefix?: string;
  readonly run: (error: ServiceError) => Promise<{ ok: boolean; message: string; field?: string }>;
}

/** Someone Else typed on Add Travellers, with nobody else ticked. */
const someoneElse = (email = '') =>
  actions.addTravellersAction(
    PREV,
    form({ tripId: TRIP, newPersonName: 'Synthetic Friend', newPersonEmail: email }),
  );

const ROWS: readonly Row[] = [
  {
    name: 'remove a traveller',
    key: 'umpe_trip_service.group_trips_are_not_switched_on',
    run: (error) => {
      svc.removeTravellerFromTrip.mockResolvedValue(refused(error));
      return actions.removeTravellerAction(PREV, form({ tripId: TRIP, applicantId: PERSON }));
    },
  },
  {
    name: 'share a document: the service refuses it',
    key: 'umpe_trip_service.only_travel_documents_such_as_bookings',
    field: 'documentId',
    run: (error) => {
      svc.addTripEvidence.mockResolvedValue(refused(error));
      return actions.addTripEvidenceAction(PREV, form({ tripId: TRIP, documentId: DOC }));
    },
  },
  {
    name: 'share a document: a made-up or foreign id the gate refuses',
    key: 'umpe_trip_service.that_document_is_not_available',
    field: 'documentId',
    run: () => {
      svc.requireAccess.mockResolvedValue(refused(serviceError('not_found', 'not found')));
      return actions.addTripEvidenceAction(PREV, form({ tripId: TRIP, documentId: DOC }));
    },
  },
  {
    name: 'share a document: the service has no such document',
    key: 'umpe_trip_service.that_document_is_not_available',
    code: 'not_found',
    field: 'documentId',
    run: (error) => {
      svc.addTripEvidence.mockResolvedValue(refused(error));
      return actions.addTripEvidenceAction(PREV, form({ tripId: TRIP, documentId: DOC }));
    },
  },
  {
    name: 'use a shared document for someone: the service refuses it',
    key: 'umpe_trip_service.that_shared_document_is_not_available',
    code: 'not_found',
    run: (error) => {
      svc.setTripEvidenceAllowance.mockResolvedValue(refused(error));
      return actions.tripEvidenceAllowanceAction(
        PREV,
        form({ tripId: TRIP, evidenceId: EVIDENCE, applicantId: PERSON, allowed: 'yes' }),
      );
    },
  },
  {
    name: 'use a shared document for someone: a made-up id',
    key: 'umpe_trip_service.that_shared_document_is_not_available',
    run: () =>
      actions.tripEvidenceAllowanceAction(
        PREV,
        form({ tripId: TRIP, evidenceId: 'nope', applicantId: PERSON, allowed: 'yes' }),
      ),
  },
  {
    name: 'stop sharing a document: the service refuses it',
    key: 'umpe_trip_service.that_shared_document_is_not_available',
    code: 'not_found',
    run: (error) => {
      svc.removeTripEvidence.mockResolvedValue(refused(error));
      return actions.removeTripEvidenceAction(
        PREV,
        form({ tripId: TRIP, evidenceId: EVIDENCE, applicantId: PERSON }),
      );
    },
  },
  {
    name: 'stop sharing a document: a made-up id',
    key: 'umpe_trip_service.that_shared_document_is_not_available',
    run: () =>
      actions.removeTripEvidenceAction(
        PREV,
        form({ tripId: TRIP, evidenceId: 'nope', applicantId: PERSON }),
      ),
  },
  {
    name: 'remove someone else',
    key: 'umpe_trip_companion_email.that_person_is_not_on_this',
    code: 'not_found',
    run: (error) => {
      svc.removeCompanion.mockResolvedValue(refused(error));
      return actions.removeCompanionAction(PREV, form({ tripId: TRIP, companionId: 'c-1' }));
    },
  },
  {
    name: 'send an invitation again',
    key: 'umpe_trip_companions.this_person_has_already_joined_the',
    run: (error) => {
      svc.resendInvitation.mockResolvedValue(refused(error));
      return actions.resendCompanionAction(PREV, form({ tripId: TRIP, companionId: 'c-1' }));
    },
  },
  {
    name: 'add someone else: a name checked before the service',
    key: 'umpe_trip_companions.enter_a_name_of_up_to',
    field: 'newPersonName',
    run: () =>
      actions.addTravellersAction(PREV, form({ tripId: TRIP, newPersonName: 'x'.repeat(200) })),
  },
  {
    name: 'add someone else: an address checked before the service',
    key: 'umpe_trip_companions.enter_a_valid_email_address_or',
    field: 'newPersonEmail',
    run: () => someoneElse('not-an-address'),
  },
  {
    name: 'add someone else: switched off',
    key: 'umpe_trip_companions.not_switched_on',
    field: 'newPersonName',
    run: () => {
      svc.tripCompanionsAvailable.mockResolvedValue(false);
      return someoneElse();
    },
  },
  ...(
    [
      ['umpe_trip_companions.enter_a_name_of_up_to', 'newPersonName'],
      ['umpe_trip_companions.enter_a_valid_email_address_or', 'newPersonEmail'],
      ['umpe_trip_companions.that_is_your_own_email_address', 'newPersonEmail'],
      ['umpe_trip_companions.you_have_already_added_someone_with', 'newPersonEmail'],
      ['umpe_trip_companions.not_switched_on', 'newPersonName'],
    ] as const
  ).map(
    ([key, field]): Row => ({
      name: `add someone else: the service says ${key}`,
      key,
      field,
      run: (error) => {
        svc.addCompanion.mockResolvedValue(refused(error));
        return someoneElse('friend@example.test');
      },
    }),
  ),
  {
    name: 'add someone else: too many invitations (no field)',
    key: 'umpe_trip_companions.too_many_invitations_in_a_short',
    code: 'rate_limited',
    run: (error) => {
      svc.addCompanion.mockResolvedValue(refused(error));
      return someoneElse('friend@example.test');
    },
  },
  {
    name: 'add a ticked traveller',
    key: 'umpe_trip_service.group_trips_are_not_switched_on',
    field: 'traveller',
    prefix: `${NAME}: `,
    run: (error) => {
      svc.addTravellerToTrip.mockResolvedValue(refused(error));
      return actions.addTravellersAction(PREV, form({ tripId: TRIP, traveller: [PERSON] }));
    },
  },
  {
    name: 'add a new family member',
    key: 'applicants.a_display_name_is_required',
    field: 'newName',
    run: (error) => {
      svc.createApplicant.mockResolvedValue(refused(error));
      return actions.addTravellersAction(
        PREV,
        form({
          tripId: TRIP,
          newName: 'Synthetic Child',
          newKind: 'MINOR_GUARDIAN',
          newAuthority: 'true',
        }),
      );
    },
  },
  {
    name: 'start a group trip: no reason for travel, checked before the service',
    key: 'umpe_package_start.choose_why_you_are_travelling',
    field: 'purpose',
    run: () =>
      actions.startGroupTripAction(
        PREV,
        form({ destination: 'JP', purpose: '', traveller: [PERSON] }),
      ),
  },
  {
    name: 'start a group trip',
    key: 'umpe_trip_service.the_trip_could_not_be_started',
    field: 'traveller',
    prefix: `${NAME}: `,
    run: (error) => {
      svc.startGroupTrip.mockResolvedValue(refused(error));
      return actions.startGroupTripAction(
        PREV,
        form({ destination: 'JP', purpose: 'tourism', traveller: [PERSON] }),
      );
    },
  },
];

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  loc.locale = 'en';
  const proof = { applicant: { id: PERSON, displayName: NAME } };
  svc.requireAccess.mockResolvedValue({ ok: true, value: proof });
  svc.listApplicants.mockResolvedValue([{ id: PERSON }]);
  svc.getTrip.mockResolvedValue({ ok: true, value: {} });
  svc.tripCompanionsAvailable.mockResolvedValue(true);
});

describe('trip refusals in the visitor language', () => {
  it.each(ROWS)('en: $name shows the exact English', async (row) => {
    const error = keyedError(row.code ?? 'invalid', row.key);
    const state = await row.run(error);
    expect(state.ok).toBe(false);
    expect(state.message).toBe(`${row.prefix ?? ''}${error.message}`);
    expect(state.field).toBe(row.field);
  });

  it.each(ROWS)('bn: $name shows the checked Bangla', async (row) => {
    loc.locale = 'bn';
    const error = keyedError(row.code ?? 'invalid', row.key);
    const state = await row.run(error);
    const own = bn[row.key];
    // Every converted trip line has checked Bangla; one without would be shown in English.
    expect(own).toMatch(BENGALI);
    expect(state.message).toBe(`${row.prefix ?? ''}${own}`);
    expect(state.field).toBe(row.field);
  });

  it('a document the gate refuses and one the service cannot find get one answer, in both languages', async () => {
    for (const locale of ['en', 'bn'] as const) {
      loc.locale = locale;
      svc.requireAccess.mockResolvedValue(refused(serviceError('not_found', 'not found')));
      const gate = await actions.addTripEvidenceAction(
        PREV,
        form({ tripId: TRIP, documentId: DOC }),
      );
      svc.requireAccess.mockResolvedValue({ ok: true, value: {} });
      svc.addTripEvidence.mockResolvedValue(
        refused(keyedError('not_found', 'umpe_trip_service.that_document_is_not_available')),
      );
      const missing = await actions.addTripEvidenceAction(
        PREV,
        form({ tripId: TRIP, documentId: DOC }),
      );
      expect(missing).toEqual(gate);
      expect(gate.message).toMatch(
        locale === 'bn' ? BENGALI : /^That document is not available\.$/,
      );
    }
  });

  it('an unkeyed refusal keeps the English the service sent, under bn too', async () => {
    loc.locale = 'bn';
    svc.removeTravellerFromTrip.mockResolvedValue(refused(serviceError('invalid', 'plain words')));
    const state = await actions.removeTravellerAction(
      PREV,
      form({ tripId: TRIP, applicantId: PERSON }),
    );
    expect(state).toEqual({ ok: false, message: 'plain words' });
  });

  it('a consent refusal keeps its pointer to Home', async () => {
    loc.locale = 'bn';
    svc.addCompanion.mockResolvedValue(
      refused(keyedError('consent_required', 'missions.core_processing_consent_is_required')),
    );
    const state = await someoneElse('friend@example.test');
    expect(state.message).toBe('Turn on Let VisaStack Process My Details on Home, then try again.');
  });
});

describe('which Add Someone Else field a companion refusal is about', () => {
  it('is the email field exactly for the companion refusals that are about an address', () => {
    const en = serviceMessages.en as Readonly<Record<string, string>>;
    const keys = Object.keys(en).filter((key) => key.startsWith('umpe_trip_companions.'));
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      const english = en[key] ?? '';
      expect([key, companionRefusalField({ message: english, messageKey: key })]).toEqual([
        key,
        /email/i.test(english) ? 'newPersonEmail' : 'newPersonName',
      ]);
    }
  });

  it('an unkeyed refusal is placed by its English, as before', () => {
    expect(companionRefusalField({ message: 'Bad email address.' })).toBe('newPersonEmail');
    expect(companionRefusalField({ message: 'Bad name.' })).toBe('newPersonName');
  });
});
