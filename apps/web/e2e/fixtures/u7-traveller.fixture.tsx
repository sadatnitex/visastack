import { AddApplicantForm } from '../../src/app/app/add-applicant-form';
import {
  AcceptTripInvitationForm,
  DeclineTripInvitationForm,
} from '../../src/app/app/trip-invitations/accept/accept-form';
import {
  AcceptFold,
  AreaPicture,
  FocusFirstFieldOnOpen,
  PersonPicture,
  TravellerRow,
  TravellerRows,
} from '../../src/app/app/u7-rows';
import u7 from '../../src/app/app/u7.css?inline';
import { ExpandableSection } from '../../src/components/ui-lift/expandable-section';

/**
 * U7: the signed-in traveller screens on the Wallet foundation, on the real stylesheet. Rows for
 * notifications, people and trips, the folded Add a Traveller form (the real form, its server end a
 * stand-in that changes nothing) and an accept screen's facts fold. Every name is made up.
 * Used by e2e/wallet/u7-traveller.spec.ts.
 */
export interface U7FixtureProps {
  readonly part?: 'rows' | 'forms' | 'accept' | 'answer';
}

const LONG = 'Averyveryveryverylongunbrokenpersonnamewithoutanyspacesatalltostretchtheline';

export default function U7Fixture({ part = 'rows' }: U7FixtureProps) {
  return (
    <section className="section container">
      <style>{u7}</style>
      {part === 'rows' ? (
        <>
          <TravellerRows id="notes" ariaLabel="Notifications">
            <TravellerRow
              headingLevel={2}
              title="Your Passport Was Read"
              picture={<AreaPicture mark={{ icon: 'bell', tone: 'amber' }} />}
              chip={{ label: 'New', tone: 'warning' }}
              meta="18 Nov 2026"
            >
              <p className="u7-body-text">Check the details it found.</p>
              <div className="u7-body-actions">
                <a className="btn btn-secondary u-btn-sm" href="#open">
                  Open
                </a>
                <button type="button" className="btn btn-secondary u-btn-sm">
                  Mark Read
                </button>
              </div>
            </TravellerRow>
            <TravellerRow
              headingLevel={2}
              title="Your Case Moved"
              picture={<AreaPicture mark={{ icon: 'bell', tone: 'neutral' }} />}
              meta="17 Nov 2026"
            >
              <p className="u7-body-text">Your Japan case is ready for review.</p>
            </TravellerRow>
          </TravellerRows>
          <TravellerRows id="people" ariaLabel="People">
            <TravellerRow
              headingLevel={3}
              href="#me"
              title="Rumana Test Traveller"
              picture={<PersonPicture name="Rumana Test Traveller" />}
              chip={{ label: 'Myself', tone: 'neutral' }}
            />
            <TravellerRow
              headingLevel={3}
              href="#long"
              title={LONG}
              picture={<PersonPicture name={LONG} />}
              chip={{ label: 'Family Member', tone: 'neutral' }}
            />
          </TravellerRows>
        </>
      ) : null}
      {part === 'forms' ? (
        <ExpandableSection
          id="add-traveller"
          className="u7-fold"
          headingLevel={2}
          title="Add a Traveller"
          summary="Yourself, a family member or a child you look after."
          picture={<AreaPicture mark={{ icon: 'plus', tone: 'blue' }} />}
          remember
        >
          <FocusFirstFieldOnOpen />
          <AddApplicantForm selfAdded={false} />
        </ExpandableSection>
      ) : null}
      {part === 'answer' ? (
        <article className="card">
          <div className="u7-answer u7-answer-pair">
            <AcceptTripInvitationForm
              token="t"
              defaultName="Nadia Rahman"
              first={{ value: 'NAME_ONLY', label: 'Name Only', line: 'Your name shows.' }}
              more={[{ value: 'PLAN_STATUS', label: 'Plan Status', line: 'And your plan.' }]}
            />
            <DeclineTripInvitationForm token="t" />
          </div>
        </article>
      ) : null}
      {part === 'accept' ? (
        <article className="card">
          <TravellerRow
            headingLevel={2}
            title="Northwind Visa Services"
            picture={<AreaPicture mark={{ icon: 'building', tone: 'blue' }} />}
            chip={{ label: 'Case Manager', tone: 'info' }}
          />
          <AcceptFold title="What You Agree To">
            <dl className="rows">
              <div className="row">
                <dt>Purpose</dt>
                <dd>Help with a Japan visa case.</dd>
              </div>
              <div className="row">
                <dt>Access Ends</dt>
                <dd>18 Dec 2026</dd>
              </div>
            </dl>
          </AcceptFold>
          <button type="button" className="btn btn-primary">
            Accept
          </button>
        </article>
      ) : null}
    </section>
  );
}
