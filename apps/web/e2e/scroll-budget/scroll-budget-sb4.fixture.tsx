import {
  CalendarDateGroups,
  type CalendarDateRow,
  CalendarPreviewPanel,
} from '../../src/app/app/applicant/[id]/calendar/calendar-date-groups';
import { AiAccessChoices } from '../../src/components/ai-access-choices';
import { DocumentWalletBrowser } from '../../src/components/document-wallet-browser';
import { StickyActionBar } from '../../src/components/sticky-action-bar';
import { CONSENT_DEFAULTS } from '../../src/lib/ai-consent-choices';

/**
 * WP-SB4 scroll budget fixture: the traveller task screens built from their real parts, with
 * worst-case, made-up data. Each `view` is one screen's working area on an otherwise empty page.
 * - calendar: 200 dates in their groups, a 100-row preview and the Preview bar;
 * - consent: the AI app consent choices with 20 cases and 40 files, and the Allow bar;
 * - documents: a 60-document vault with the first one selected and a long detail panel.
 */
export interface Sb4FixtureProps {
  readonly view: 'calendar' | 'consent' | 'documents';
  /** How many dates, cases or documents. */
  readonly count?: number;
}

const KINDS = ['appointment', 'task_due', 'request_due', 'document_expires'] as const;
const UPDATED = '2026-10-20T08:00:00.000Z';
const DETAIL_ROWS = Array.from({ length: 14 }, (_, n) => `Made-up Detail ${n + 1}`);

function uuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function calendarItems(count: number): CalendarDateRow[] {
  return Array.from({ length: count }, (_, n) => {
    const kind = KINDS[n % KINDS.length] ?? 'task_due';
    const day = 1 + Math.floor(n / 4);
    return {
      key: `${kind}:${uuid('0b6f1c2e', n)}`,
      kind,
      when:
        kind === 'appointment'
          ? `Tue ${day} Nov 2026, 09:30 Asia/Dhaka time`
          : `Tue ${day} Nov 2026, all day`,
      caseTitle: n % 3 === 0 ? 'Synthetic Japan Visit' : null,
    };
  });
}

function CalendarView({ count }: { readonly count: number }) {
  const items = calendarItems(count);
  const events = items
    .slice(0, 100)
    .map((item) => ({ key: item.key, title: 'Task Due', when: item.when }));
  return (
    <>
      <header>
        <p className="eyebrow">Calendar</p>
        <h2 className="page-title">Add Dates to My Calendar</h2>
        <p>
          Choose the dates you want, check the preview, then download one file to open in your
          calendar app.
        </p>
      </header>
      <div className="notice notice-stack u-mb-150">
        <p className="u-m-0">
          This is a one-time copy. If a date changes later, your calendar will not update; download
          a new file.
        </p>
        <p className="u-m-0">Dates without a time are added as all-day events.</p>
      </div>
      <section className="card u-mb-150" aria-labelledby="calendar-preview-heading">
        <h3 className="card-title" id="calendar-preview-heading">
          Preview
        </h3>
        <p className="card-body">The file will hold 100 events, as shown here.</p>
        <CalendarPreviewPanel events={events} />
        <form className="calendar-actions">
          <button type="button" className="btn btn-primary">
            Download Calendar File
          </button>
        </form>
      </section>
      <section className="card" aria-labelledby="calendar-choose-heading">
        <h3 className="card-title" id="calendar-choose-heading">
          Choose Dates
        </h3>
        <form className="calendar-form">
          <fieldset className="fieldset">
            <legend className="field-label">Dates to Add</legend>
            <CalendarDateGroups items={items} chosen={new Set()} />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="field-label">Titles</legend>
            <label className="check calendar-date" htmlFor="calendar-case-names">
              <input id="calendar-case-names" type="checkbox" name="titles" />
              <span>Add Case Names</span>
            </label>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="field-label">Remind Me</legend>
            <div className="checks">
              {['None', 'On the Day', '1 Day Before', '1 Week Before'].map((label, n) => (
                <label key={label} className="check calendar-date" htmlFor={`remind-${n}`}>
                  <input id={`remind-${n}`} type="radio" name="remind" defaultChecked={n === 0} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <StickyActionBar label="Preview Your Dates">
            <button type="button" className="btn btn-secondary">
              Preview
            </button>
          </StickyActionBar>
        </form>
      </section>
    </>
  );
}

function ConsentView({ count }: { readonly count: number }) {
  const cases = Array.from({ length: count }, (_, n) => ({
    id: uuid('11111111', n),
    title: `Synthetic Trip ${n + 1}`,
  }));
  const files = {
    available: true,
    candidates: Array.from({ length: count * 2 }, (_, n) => ({
      documentId: uuid('22222222', n),
      referenceCode: `D-${n}`,
      kind: 'Invitation Letter',
      group: ['Travel and Immigration', 'Accommodation and Host', 'Work and Study'][n % 3] ?? '',
      safeCopyReady: n % 4 !== 0,
    })),
  };
  return (
    <section className="auth-form-panel">
      <h1 className="page-title">Connect Synthetic App</h1>
      <p className="card-body">app.example.test is asking to read parts of a VisaStack record.</p>
      <p className="card-body">
        Record: <strong>Synthetic Traveller</strong>
      </p>
      <form className="field-list">
        <AiAccessChoices
          appName="Synthetic App"
          cases={cases}
          initial={CONSENT_DEFAULTS}
          durations={[{ value: '30d', label: '30 Days' }]}
          defaultDuration="30d"
          files={files}
        />
        <p className="card-body">The app can read what you allow. It cannot change anything.</p>
        <StickyActionBar label="Answer Synthetic App">
          <button type="button" className="btn btn-primary">
            Allow Access
          </button>
          <button type="button" className="btn btn-secondary">
            Do Not Allow
          </button>
        </StickyActionBar>
      </form>
    </section>
  );
}

function DocumentsView({ count }: { readonly count: number }) {
  const documents = Array.from({ length: count }, (_, n) => ({
    id: uuid('33333333', n),
    name: `Synthetic Document ${n + 1}.pdf`,
    kind: n % 2 ? 'Bank Statement' : 'Invitation Letter',
    category: n % 2 ? 'Money' : 'Accommodation and Host',
    version: 1 + (n % 3),
    updatedAt: UPDATED,
    ready: n % 3 === 0,
    needsReview: n % 3 === 1,
    expiring: n % 7 === 0,
    safetyLabel: 'Checked',
    processingLabel: n % 3 === 1 ? 'Needs Review' : 'Approved',
    previewAllowed: true,
    // The real panel holds the actions, dates, reading and versions: long on a phone.
    details: (
      <div>
        {DETAIL_ROWS.map((label) => (
          <div key={label} className="row">
            <span className="row-key">{label}</span>
            <button type="button" className="btn btn-secondary u-btn-sm">
              Change<span className="sr-only"> {label}</span>
            </button>
          </div>
        ))}
      </div>
    ),
  }));
  return (
    <>
      <header>
        <p className="eyebrow">Record</p>
        <h1 className="page-title">Documents</h1>
      </header>
      <DocumentWalletBrowser
        applicantId="44444444-4444-4444-8444-444444444444"
        documents={documents}
        initialSelection={documents[0]?.id ?? ''}
      />
    </>
  );
}

export default function Sb4Fixture({ view, count = 200 }: Sb4FixtureProps) {
  if (view === 'calendar') return <CalendarView count={count} />;
  if (view === 'consent') return <ConsentView count={count} />;
  return <DocumentsView count={count} />;
}
