import type { DeadlineEntry } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateOnly } from '../../lib/format-date';

const gate = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: gate.requireAccess,
  listDeadlineClock: gate.listDeadlineClock,
}));

const { deadlineLabel, deadlineLines, loadDeadlineEntries, readDeadlineEntries } = await import(
  './deadline-clock-data'
);

const NOW = new Date('2026-10-26T12:00:00Z');

function entry(overrides: Partial<DeadlineEntry> & Pick<DeadlineEntry, 'key'>): DeadlineEntry {
  return {
    kind: 'document_expires',
    applicantId: 'p1',
    applicantName: 'Synthetic Traveller',
    date: '2026-11-07',
    daysUntil: 12,
    urgency: 'month',
    docType: 'PASSPORT',
    subject: null,
    label: null,
    doubt: null,
    caseId: null,
    href: '/app/applicant/p1/expiry',
    ...overrides,
  };
}

beforeEach(() => {
  gate.requireAccess.mockReset();
  gate.listDeadlineClock.mockReset();
});

describe('loadDeadlineEntries goes through the access gate as the owner', () => {
  it('asks the gate for the person, as themselves, and reads the clock with the proof', async () => {
    const proof = { actor: { kind: 'applicant_owner' }, applicantId: 'p1' };
    gate.requireAccess.mockResolvedValue({ ok: true, value: proof });
    gate.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: { applicantId: 'p1', entries: [entry({ key: 'a' })] },
    });
    const entries = await loadDeadlineEntries({} as never, 'acct-1', 'p1', NOW, 3);
    expect(entries).toHaveLength(1);
    expect(gate.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-1' },
      'VIEW_METADATA',
      { applicantId: 'p1' },
      { purpose: 'self' },
    );
    expect(gate.listDeadlineClock).toHaveBeenCalledWith(proof, { now: NOW, limit: 3 });
  });

  it('gives null, never an empty list, when the gate refuses', async () => {
    gate.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await loadDeadlineEntries({} as never, 'acct-1', 'p1', NOW, 3)).toBeNull();
    expect(gate.listDeadlineClock).not.toHaveBeenCalled();
  });

  it('gives null for a proof that is not the owner, such as a shared viewer', async () => {
    gate.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'grant_recipient' }, applicantId: 'p1' },
    });
    expect(await loadDeadlineEntries({} as never, 'acct-1', 'p1', NOW, 3)).toBeNull();
    expect(gate.listDeadlineClock).not.toHaveBeenCalled();
  });

  it('gives null, and does not take the page down, when a read throws', async () => {
    const proof = { actor: { kind: 'applicant_owner' }, applicantId: 'p1' };
    gate.requireAccess.mockResolvedValue({ ok: true, value: proof });
    gate.listDeadlineClock.mockRejectedValue(new Error('connection reset'));
    expect(await loadDeadlineEntries({} as never, 'acct-1', 'p1', NOW, 3)).toBeNull();
    expect(await readDeadlineEntries(proof as never, NOW, 3)).toBeNull();
    gate.requireAccess.mockRejectedValue(new Error('connection reset'));
    expect(await loadDeadlineEntries({} as never, 'acct-1', 'p1', NOW, 3)).toBeNull();
  });

  it('gives null when the read itself fails', async () => {
    gate.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' }, applicantId: 'p1' },
    });
    gate.listDeadlineClock.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } });
    expect(await loadDeadlineEntries({} as never, 'acct-1', 'p1', NOW, 3)).toBeNull();
  });
});

describe('deadlineLabel names a date by its label only', () => {
  it('names a document by its type, or plainly "Document" while the kind is not accepted', () => {
    expect(deadlineLabel(entry({ key: 'a', docType: 'PASSPORT' }))).toBe('Passport');
    expect(deadlineLabel(entry({ key: 'a', docType: null }))).toBe('Document');
  });

  it("uses a task's own words, or plainly Task", () => {
    expect(
      deadlineLabel(
        entry({ key: 'a', kind: 'task_due', docType: null, label: 'Pay the visa fee' }),
      ),
    ).toBe('Pay the visa fee');
    expect(deadlineLabel(entry({ key: 'a', kind: 'task_due', docType: null }))).toBe('Task');
  });

  it('names what a request asks for', () => {
    expect(
      deadlineLabel(
        entry({
          key: 'a',
          kind: 'request_due',
          docType: null,
          subject: {
            kind: 'request',
            requestKind: 'DOCUMENT',
            docType: 'BANK_STATEMENT',
            fieldKey: null,
          },
        }),
      ),
    ).toBe('Bank Statement');
    expect(deadlineLabel(entry({ key: 'a', kind: 'request_due', docType: null }))).toBe('Request');
  });

  it('calls an appointment an appointment, with no title or place', () => {
    expect(deadlineLabel(entry({ key: 'a', kind: 'appointment', docType: null }))).toBe(
      'Appointment',
    );
  });
});

describe('deadlineLines', () => {
  it('turns entries into worded lines, in the order given, with the tone word and the exact date', () => {
    const lines = deadlineLines(
      [
        entry({ key: 'a', daysUntil: -3, date: '2026-10-23', urgency: 'overdue' }),
        entry({ key: 'b', daysUntil: 0, date: '2026-10-26', urgency: 'soon' }),
        entry({ key: 'c', daysUntil: 1, date: '2026-10-27', urgency: 'soon' }),
        entry({ key: 'd', daysUntil: 30, date: '2026-11-25', urgency: 'month' }),
        entry({ key: 'e', daysUntil: 31, date: '2026-11-26', urgency: 'later' }),
      ],
      { showPerson: false },
    );
    expect(lines.map((l) => [l.phrase, l.toneWord, l.dateText])).toEqual([
      ['Expired 3 days ago', 'Overdue', formatDateOnly('2026-10-23')],
      ['Expires today', 'Within a Week', formatDateOnly('2026-10-26')],
      ['Expires tomorrow', 'Within a Week', formatDateOnly('2026-10-27')],
      ['Expires in 30 days', 'Within a Month', formatDateOnly('2026-11-25')],
      ['Expires in 31 days', 'Later', formatDateOnly('2026-11-26')],
    ]);
    expect(lines.every((l) => l.person === null && l.check === null)).toBe(true);
  });

  it('adds whose date it is only when asked', () => {
    const [line] = deadlineLines([entry({ key: 'a' })], { showPerson: true });
    expect(line?.person).toBe('Synthetic Traveller');
  });

  it('words an unsure date as conditional and carries the reason', () => {
    const [line] = deadlineLines([entry({ key: 'a', doubt: 'kind_not_accepted', docType: null })], {
      showPerson: false,
    });
    expect(line?.phrase).toBe('Expires in 12 days, if the date is right');
    expect(line?.check).toContain('Check the date');
    expect(line?.label).toBe('Document');
  });

  it('carries no value, number or file name, only the label, wording and date', () => {
    const lines = deadlineLines(
      [
        entry({ key: 'a' }),
        entry({ key: 'b', kind: 'task_due', docType: null, label: 'Pay the visa fee' }),
      ],
      { showPerson: true },
    );
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(
      [
        'check',
        'dateText',
        'href',
        'isoDate',
        'key',
        'label',
        'person',
        'phrase',
        'toneWord',
        'urgency',
      ].sort(),
    );
  });
});
