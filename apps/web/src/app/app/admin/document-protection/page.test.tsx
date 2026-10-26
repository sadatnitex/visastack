import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  getDocumentProtectionOverview: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getDocumentProtectionOverview: (...args: unknown[]) =>
    mocks.getDocumentProtectionOverview(...args),
}));
vi.mock('./forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { ProtectionSwitch: stub('ProtectionSwitch') };
});

const { default: Page } = await import('./page');

const base = {
  description: null,
  reason: null,
  changedAt: null,
  changedByEmail: null,
  overridden: false,
};

function overview(unknownRestricted: boolean) {
  return {
    unknown: {
      ...base,
      scope: 'UNKNOWN_TYPE',
      key: 'unknown',
      label: 'Documents Not Sorted Yet',
      description: 'Documents whose type is not known yet, or not recognised.',
      restricted: unknownRestricted,
      defaultRestricted: true,
      ...(unknownRestricted
        ? {}
        : {
            overridden: true,
            reason: 'Testing with agencies',
            changedAt: new Date('2026-10-20T10:00:00Z'),
            changedByEmail: 'security@example.com',
          }),
    },
    categories: [
      {
        ...base,
        scope: 'CATEGORY',
        key: 'medical',
        label: 'Medical',
        description: 'Health reports, vaccination and insurance records.',
        restricted: false,
        defaultRestricted: true,
        overridden: true,
        reason: 'Agencies said vaccination cards are routine',
        changedAt: new Date('2026-10-21T09:30:00Z'),
        changedByEmail: 'security@example.com',
        restrictedTypeCount: 1,
        types: [
          {
            ...base,
            scope: 'DOCUMENT_TYPE',
            key: 'VACCINATION_CERTIFICATE',
            label: 'Vaccination Certificate',
            restricted: false,
            defaultRestricted: false,
          },
          {
            ...base,
            scope: 'DOCUMENT_TYPE',
            key: 'OTHER_MEDICAL_DOCUMENT',
            label: 'Other Medical Document',
            restricted: true,
            defaultRestricted: true,
          },
        ],
      },
      {
        ...base,
        scope: 'CATEGORY',
        key: 'financial',
        label: 'Financial',
        description: 'Bank, tax, income, savings, property and sponsorship records.',
        restricted: true,
        defaultRestricted: true,
        restrictedTypeCount: 1,
        types: [
          {
            ...base,
            scope: 'DOCUMENT_TYPE',
            key: 'SALARY_SLIP',
            label: 'Salary Slip',
            restricted: false,
            defaultRestricted: true,
            overridden: true,
            reason: 'Agencies see these every day',
            changedAt: new Date('2026-10-22T08:00:00Z'),
            changedByEmail: 'security@example.com',
          },
          {
            ...base,
            scope: 'DOCUMENT_TYPE',
            key: 'BANK_STATEMENT',
            label: 'Bank Statement',
            restricted: true,
            defaultRestricted: true,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/document-protection';
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.getDocumentProtectionOverview.mockResolvedValue({ ok: true, value: overview(true) });
});

describe('Platform > Settings > Document Protection', () => {
  it('shows only the restricted notice to someone without the permission', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('This area is restricted to platform administrators');
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('DOCUMENT_PROTECTION_MANAGE');
    expect(mocks.getDocumentProtectionOverview).not.toHaveBeenCalled();
    expect(stubProps(html, 'ProtectionSwitch')).toEqual([]);
  });

  it('says in plain words what each switch does for travellers', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Document Protection');
    expect(text).toContain(
      'Ask for a fresh sign-in check before anyone previews or downloads these documents.',
    );
    expect(text).toContain('These documents open without a fresh sign-in check.');
    expect(text).toContain('Documents in Medical (2)');
    expect(text).toContain('1 with a sign-in check');
    expect(text).toContain('Follows Medical.');
    expect(text).toContain('On for this document by standard setting.');
    // Plain language: no internal keys, switch kinds or role codes on screen.
    for (const internal of [
      'UNKNOWN_TYPE',
      'DOCUMENT_TYPE',
      'CATEGORY',
      'SECURITY_ADMIN',
      'OTHER_MEDICAL_DOCUMENT',
      'step-up',
    ]) {
      expect(text).not.toContain(internal);
    }
    expect(text).not.toContain(String.fromCodePoint(0x2014));
  });

  it('shows who changed a switch, when, why, and the standard setting', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Changed by security@example.com on');
    expect(text).toContain('Standard setting: On.');
    expect(text).toContain('Reason: Agencies said vaccination cards are routine');
    expect(text).toContain('Standard setting, never changed.');
  });

  it('gives every category, document and the unsorted rule its own switch', async () => {
    const html = await renderServer(Page());
    const switches = stubProps<{ scope: string; switchKey: string; offWarning?: string }>(
      html,
      'ProtectionSwitch',
    );
    expect(switches.map((s) => `${s.scope}:${s.switchKey}`)).toEqual([
      'UNKNOWN_TYPE:unknown',
      'CATEGORY:medical',
      'DOCUMENT_TYPE:VACCINATION_CERTIFICATE',
      'DOCUMENT_TYPE:OTHER_MEDICAL_DOCUMENT',
      'CATEGORY:financial',
      'DOCUMENT_TYPE:SALARY_SLIP',
      'DOCUMENT_TYPE:BANK_STATEMENT',
    ]);
    expect(switches[0]?.offWarning).toContain(
      'could be passports, bank statements or medical records',
    );
    expect(switches.slice(1).every((s) => s.offWarning === undefined)).toBe(true);
  });

  it('says when a group is on but some documents in it were switched off one by one', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain(
      'Asks for a fresh sign-in check, except 1 document switched off one by one.',
    );
  });

  it('says when a group is off but some documents in it are still protected', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain(
      'These documents open without a fresh sign-in check. 1 document in this group is still protected.',
    );
  });

  it('labels what a document switch does once reset, which depends on its group', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Changed by security@example.com on');
    expect(text).toContain('If reset: On. Reason: Agencies see these every day');
  });

  it('shows a plain notice when the settings cannot be read yet', async () => {
    mocks.getDocumentProtectionOverview.mockResolvedValue({
      ok: false,
      error: { code: 'upstream_error', message: 'x' },
    });
    const html = await renderServer(Page());
    expect(textOf(html)).toContain(
      'Document protection settings are not available yet. Until they are, every document needs a fresh sign-in check before anyone previews or downloads it.',
    );
    expect(textOf(html)).not.toContain('This area is restricted');
    expect(stubProps(html, 'ProtectionSwitch')).toEqual([]);
  });

  it('warns clearly while the unsorted-documents check is off', async () => {
    expect(textOf(await renderServer(Page()))).not.toContain('can expose them without a check');
    mocks.getDocumentProtectionOverview.mockResolvedValue({ ok: true, value: overview(false) });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain(
      'Documents that are not sorted yet could be passports, bank statements or medical records, so turning this off can expose them without a check.',
    );
    expect(text).toContain('Sign-in check Off');
  });
});
