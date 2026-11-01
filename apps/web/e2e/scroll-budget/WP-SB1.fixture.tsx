import type { MemoryCase } from '@visastack/services';
import { HistoryLog } from '../../src/app/app/applicant/[id]/history/history-log';
import { MemoryCaseList } from '../../src/app/app/applicant/[id]/memory/memory-case-list';
import {
  NotificationList,
  type NotificationRow,
} from '../../src/app/app/notifications/notification-list';
import type { ActivityLogEntry } from '../../src/components/activity-log';
import { ActivityLog } from '../../src/components/activity-log';

/**
 * WP-SB1 scroll budget fixture: the traveller record pages' own parts with worst-case, made-up
 * data, each under a page title as the real page shows it. The data matches what one server load
 * returns for a person with 500 saved versions, 40 cases of 50 records each, 500 consent changes
 * or 200 notifications.
 */
export interface Sb1FixtureProps {
  readonly view: 'history' | 'memory' | 'consent' | 'notifications';
}

const START = Date.UTC(2026, 9, 31, 12, 0, 0);

function timeAt(n: number): string {
  return new Date(START - n * 37 * 60 * 1000).toISOString();
}

function historyEntries(): ActivityLogEntry[] {
  const fields = ['Given Name', 'Passport Number', 'Employer Name', 'Home Address'];
  return Array.from({ length: 50 }, (_, n) => ({
    id: `version-${n}`,
    what: fields[n % fields.length] ?? 'Given Name',
    detail: `Made-up value ${n + 1} · Confirmed · Manual · a longer reason that wraps on a phone`,
    who: n % 3 === 0 ? 'Someone Else' : 'You',
    outcome:
      n < 4
        ? { label: 'Current', tone: 'success' as const }
        : { label: 'Superseded', tone: 'neutral' as const },
    at: timeAt(n),
    when: timeAt(n).slice(0, 16).replace('T', ' '),
  }));
}

function consentEntries(): ActivityLogEntry[] {
  const kinds = ['Marketing', 'Sharing', 'AI Extraction', 'Core Processing'];
  return Array.from({ length: 50 }, (_, n) => ({
    id: `consent-${n}`,
    what: kinds[n % kinds.length] ?? 'Marketing',
    outcome:
      n % 2 === 0
        ? { label: 'Granted', tone: 'success' as const }
        : { label: 'Revoked', tone: 'neutral' as const },
    at: timeAt(n),
    when: timeAt(n).slice(0, 16).replace('T', ' '),
  }));
}

function memoryCases(): MemoryCase[] {
  return Array.from({ length: 10 }, (_, c) => ({
    missionId: `case-${c}`,
    title: `Made-up Case ${c + 1}`,
    destination: 'Japan',
    purpose: 'Tourism',
    agencyName: c % 2 === 0 ? 'Harbor Visas' : null,
    state: 'DRAFT',
    createdAt: timeAt(c * 60),
    removed: false,
    notSharedWith: [],
    events: Array.from({ length: 50 }, (_, e) => ({
      kind: 'prepared' as const,
      id: `snap-${c}-${e}`,
      at: timeAt(c * 60 + e),
      snapshotId: `00000000-0000-4000-8000-${String(c * 100 + e).padStart(12, '0')}`,
      snapshotVersion: 50 - e,
    })),
  }));
}

function notifications(): NotificationRow[] {
  return Array.from({ length: 10 }, (_, n) => ({
    id: `notice-${n}`,
    subject: `Made-up notice ${n + 1}`,
    summary: 'A document is close to expiring. Open it to see what to do next.',
    deepLinkPath: '/app',
    read: n >= 6,
    createdAt: new Date(timeAt(n)),
    level: null,
  }));
}

const noAction = () => undefined;

export default function Sb1Fixture({ view }: Sb1FixtureProps) {
  if (view === 'history') {
    return (
      <>
        <h1>History</h1>
        <HistoryLog
          pathname="/app/applicant/person/history"
          parts={[
            { key: 'universal', label: 'Universal' },
            { key: 'professional', label: 'Professional / employment' },
          ]}
          section={undefined}
          partLabel={undefined}
          entries={historyEntries()}
          total={500}
          olderHref="/app/applicant/person/history?before=eyJ2IjoxfQ#profile-history-log"
        />
      </>
    );
  }
  if (view === 'memory') {
    return (
      <>
        <h1>Case History</h1>
        <MemoryCaseList
          applicantId="person"
          cases={memoryCases()}
          totalCases={40}
          searchParams={{}}
        />
      </>
    );
  }
  if (view === 'consent') {
    return (
      <>
        <h1>Privacy &amp; Consent</h1>
        <article className="card">
          <h2 className="card-title">Consent History</h2>
          <ActivityLog
            id="consent-history-log"
            label="Consent History Entries"
            entries={consentEntries()}
            olderHref="/app/privacy?consentBefore=eyJ2IjoxfQ#consent-history-log"
          />
        </article>
      </>
    );
  }
  return (
    <>
      <h1>Notifications</h1>
      <article className="card">
        <NotificationList
          notifications={notifications()}
          next={20}
          searchParams={{}}
          markReadAction={noAction}
          markAllReadAction={noAction}
        />
      </article>
    </>
  );
}
