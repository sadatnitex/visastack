import {
  RESPONSE_CONSENT_TEXT,
  accountPrincipal,
  listApplicants,
  openCollectionResponseDesk,
  proposeCollectionResponse,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { agencyBrand } from '../../../lib/agency-brand';
import { formatTimestampDate } from '../../../lib/format-date';
import { createKeyManagementPort } from '../../../lib/providers';
import { withSession } from '../../../lib/session';
import { destinationName } from '../../app/agency/[orgId]/collection/terms';
import { AgencyBrandScope, AgencyMark } from '../../app/agency/[orgId]/org-branding-header';
import { collectSwitchOn } from '../load';
import { heldCollectionLink } from './link';
import { ResponseForm } from './response-form';
import { type ItemView, answerHref, itemViews } from './terms';

export const metadata: Metadata = {
  title: 'Answer a Document Request',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

type Loaded =
  | { readonly state: 'closed' }
  | {
      readonly state: 'choose';
      readonly heading: Heading;
      readonly people: readonly { readonly id: string; readonly displayName: string }[];
    }
  | {
      readonly state: 'answer';
      readonly heading: Heading;
      readonly person: { readonly id: string; readonly displayName: string };
      readonly items: readonly ItemView[];
      readonly otherPeople: boolean;
    };

interface Heading {
  readonly agency: { readonly name: string; readonly accentColor: string | null } | null;
  readonly destination: string;
  readonly purpose: string | null;
  readonly dueAt: Date | null;
}

/**
 * Answer an agency's document request from your own record (UMPE P7, contract section 6, branches
 * 1 and 2). The request filter has already sent anyone signed out to sign in or create an account
 * and back here. The page reads the link this browser holds (opening it granted nothing), checks
 * the account is the one the agency addressed, lets the person choose one of their own people,
 * and shows the exact issued checklist with matching copies from that record proposed. Nothing is
 * shared until they submit. A refused link looks exactly like a closed one.
 */
export default async function CollectAccountPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly person?: string | string[] }>;
}) {
  if (!collectSwitchOn()) notFound();
  const chosen = (await searchParams)?.person;
  const personParam = typeof chosen === 'string' ? chosen : null;
  const link = await heldCollectionLink();
  if (!link) return <ClosedLink />;

  const loaded: Loaded = await withSession(async ({ db, accountId, self }) => {
    const desk = await openCollectionResponseDesk(db, link, self);
    if (!desk.ok) return { state: 'closed' } as const;
    const heading: Heading = {
      agency: desk.value.agency,
      destination: desk.value.destination,
      purpose: desk.value.purpose,
      dueAt: desk.value.dueAt,
    };
    const people = (await listApplicants(db, accountId)).map((p) => ({
      id: p.id,
      displayName: p.displayName,
    }));
    const personId = personParam ?? (people.length === 1 ? (people[0]?.id ?? null) : null);
    if (!personId) return { state: 'choose', heading, people } as const;
    const person = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: personId },
      { purpose: 'collection_response' },
    );
    if (!person.ok || person.value.actor.kind !== 'applicant_owner') {
      return { state: 'choose', heading, people } as const;
    }
    const encryption = createKeyManagementPort();
    const proposal = await proposeCollectionResponse(db, link, person.value, {
      ...(encryption ? { encryption } : {}),
    });
    if (!proposal.ok) return { state: 'closed' } as const;
    return {
      state: 'answer',
      heading,
      person: proposal.value.person,
      items: itemViews(proposal.value.proposals, desk.value.agency?.name ?? null),
      otherPeople: people.length > 1,
    } as const;
  });

  if (loaded.state === 'closed') return <ClosedLink />;
  return (
    <section className="section container collect-page stack">
      <RequestHeading heading={loaded.heading} />
      {loaded.state === 'choose' ? (
        <ChoosePerson people={loaded.people} />
      ) : (
        <>
          <div className="card">
            <div className="card-body">
              <p>
                Answering for <strong>{loaded.person.displayName}</strong>. Matching copies from
                this record are ticked for you; untick anything you do not want to share. Nothing is
                shared until you submit.
              </p>
              {loaded.otherPeople ? (
                <p className="u-fs-085">
                  <Link href={answerHref()}>Answer for Someone Else</Link>
                </p>
              ) : null}
            </div>
          </div>
          <ResponseForm
            personId={loaded.person.id}
            items={loaded.items}
            consentText={RESPONSE_CONSENT_TEXT}
          />
          <p className="muted u-fs-085">
            Something missing from your record? <Link href="/app">Add It to Your Record</Link>, then
            come back to this page. See <Link href="/collect/account/answers">Your Answers</Link> to
            withdraw one at any time.
          </p>
        </>
      )}
      <p className="muted u-fs-085">Powered by VisaStack.</p>
    </section>
  );
}

function RequestHeading({ heading }: { readonly heading: Heading }) {
  const brand = heading.agency
    ? agencyBrand({
        name: heading.agency.name,
        accentColor: heading.agency.accentColor,
        logoUrl: null,
      })
    : null;
  const facts = [
    `For ${destinationName(heading.destination)}`,
    ...(heading.purpose ? [heading.purpose] : []),
    ...(heading.dueAt ? [`Due ${formatTimestampDate(heading.dueAt)}`] : []),
  ].join(' · ');
  return (
    <header className="collect-response-head">
      {brand ? (
        <AgencyBrandScope brand={brand} className="collect-agency">
          <AgencyMark brand={brand} size="lg" />
          <h1 className="page-title">Answer {brand.name}</h1>
        </AgencyBrandScope>
      ) : (
        <h1 className="page-title">Answer an Agency Request</h1>
      )}
      <p className="muted">{facts}</p>
    </header>
  );
}

function ChoosePerson({
  people,
}: {
  readonly people: readonly { readonly id: string; readonly displayName: string }[];
}) {
  if (people.length === 0) {
    return (
      <div className="card">
        <div className="card-body stack">
          <h2>Set Up Your Record First</h2>
          <p>
            Your answer comes from your own VisaStack record, and you have no one in it yet. Add
            yourself and your documents, then open this page again.
          </p>
          <p>
            <Link className="btn btn-primary" href="/app">
              Set Up Your Record
            </Link>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-body stack">
        <h2 id="collect-choose-person">Who Is This For?</h2>
        <p>Choose whose record to answer from. Only you can see this list.</p>
        <ul className="collect-response-people" aria-labelledby="collect-choose-person">
          {people.map((person) => (
            <li key={person.id}>
              <Link className="btn btn-secondary" href={answerHref(person.id)}>
                {person.displayName}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ClosedLink() {
  return (
    <section className="section container collect-page">
      <article className="card collect-card">
        <div className="card-body">
          <h1 className="page-title">This Link Is Not Open</h1>
          <p>
            The link may have expired or been replaced, the request may have ended, or it was sent
            to a different email address. Open it again from the message you received, signed in
            with the address it was sent to, or ask the agency for a new link.
          </p>
          <p className="u-fs-085">
            <Link href="/collect/account/answers">See Your Answers</Link>
          </p>
        </div>
      </article>
    </section>
  );
}
