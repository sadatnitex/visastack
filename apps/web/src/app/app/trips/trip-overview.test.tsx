import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import '../../../lib/next-mocks.test-support';
import { TripOverview, type TripTravellerCard } from './trip-overview';

/** UMPE P5: the trip overview shows each traveller's own phrase and one next action. */

function card(overrides: Partial<TripTravellerCard>): TripTravellerCard {
  return {
    applicantId: 'a1',
    missionId: 'm1',
    name: 'Synthetic Anna',
    relationship: 'SELF',
    caseTitle: 'Japan - Tourism',
    phrase: 'NEEDS_ATTENTION',
    nextAction: 'ADD_MISSING',
    tripDocuments: [],
    ...overrides,
  };
}

describe('TripOverview', () => {
  it('shows each traveller with their own readiness and one next action to their case', () => {
    const html = renderToStaticMarkup(
      <TripOverview
        tripId="t1"
        travellers={[
          card({}),
          card({
            applicantId: 'a2',
            missionId: 'm2',
            name: 'Synthetic Cara',
            relationship: 'MINOR_GUARDIAN',
            phrase: 'READY_FOR_FINAL_REVIEW',
            nextAction: 'FINAL_REVIEW',
          }),
        ]}
        sharedDocuments={[]}
        addable={[]}
        documentOptions={[]}
      />,
    );
    expect(html).toContain('Who&#x27;s Travelling?');
    expect(html).toContain('Needs Attention');
    expect(html).toContain('Ready for Final Review');
    expect(html).toContain('href="/app/mission/m1#trip-package"');
    expect(html).toContain('Add the Missing Items');
    expect(html).toContain('href="/app/mission/m2#trip-package"');
    expect(html).toContain('Do the Final Review');
    expect(html).toContain('Child in Your Care');
    expect(html).toContain('Add Travellers');
    expect(html).not.toMatch(/\bmissions?\b(?!\/)/i);
  });

  it('offers a shared document only to the other travellers, never to its own', () => {
    const html = renderToStaticMarkup(
      <TripOverview
        tripId="t1"
        travellers={[card({}), card({ applicantId: 'a2', missionId: 'm2', name: 'Synthetic Ben' })]}
        sharedDocuments={[
          {
            id: 'e1',
            name: 'Hotel Booking',
            sourceApplicantId: 'a1',
            sourceName: 'Synthetic Anna',
            allowedFor: [],
          },
        ]}
        addable={[]}
        documentOptions={[]}
      />,
    );
    expect(html).toContain('Use for Synthetic Ben');
    expect(html).not.toContain('Use for Synthetic Anna');
    expect(html).toContain('Stop Sharing');
  });

  const trip = (travellers: TripTravellerCard[], sharedDocuments: never[] = []) =>
    renderToStaticMarkup(
      <TripOverview
        tripId="t1"
        travellers={travellers}
        sharedDocuments={sharedDocuments}
        addable={[]}
        documentOptions={[]}
      />,
    );

  it('puts one Next Step first: the traveller who needs attention, then the one ready for review', () => {
    const attention = trip([
      card({
        applicantId: 'a2',
        missionId: 'm2',
        name: 'Synthetic Ben',
        phrase: 'READY_FOR_FINAL_REVIEW',
        nextAction: 'FINAL_REVIEW',
      }),
      card({}),
    ]);
    expect(attention.match(/<section class="next-step"/g)).toHaveLength(1);
    expect(attention.indexOf('<section class="next-step"')).toBeLessThan(
      attention.indexOf('trip-travellers-title'),
    );
    expect(attention).toContain('Synthetic Anna: Add the Missing Items');
    expect(attention).toContain('Japan - Tourism: Needs Attention.');
    const review = trip([
      card({ phrase: 'PREPARED_FOR_HANDOFF', nextAction: 'SHARE_WHEN_READY' }),
      card({
        applicantId: 'a2',
        missionId: 'm2',
        name: 'Synthetic Ben',
        phrase: 'READY_FOR_FINAL_REVIEW',
        nextAction: 'FINAL_REVIEW',
      }),
    ]);
    expect(review).toContain('Synthetic Ben: Do the Final Review');
  });

  it('singles nobody out when every package is prepared or unreadable', () => {
    const calm = trip([
      card({ phrase: 'PREPARED_FOR_HANDOFF', nextAction: 'SHARE_WHEN_READY' }),
      card({ applicantId: 'a2', missionId: 'm2', phrase: null, nextAction: 'VIEW_CASE' }),
    ]);
    expect(calm).not.toContain('<section class="next-step"');
  });

  it('keeps the one filled button for the Next Step, so the cards offer a quieter one', () => {
    const html = trip([card({})]);
    expect(html).not.toContain('btn btn-primary trip-next-action');
    expect(html).toContain('btn btn-secondary trip-next-action');
  });

  it('shows how far each package is along three stages, in words for a screen reader', () => {
    const html = trip([
      card({}),
      card({
        applicantId: 'a2',
        missionId: 'm2',
        phrase: 'READY_FOR_FINAL_REVIEW',
        nextAction: 'FINAL_REVIEW',
      }),
      card({
        applicantId: 'a3',
        missionId: 'm3',
        phrase: 'PREPARED_FOR_HANDOFF',
        nextAction: 'SHARE_WHEN_READY',
      }),
      card({ applicantId: 'a4', missionId: 'm4', phrase: null, nextAction: 'VIEW_CASE' }),
    ]);
    expect(html).toContain('aria-label="Needs Attention, stage 1 of 3"');
    expect(html).toContain('aria-label="Ready for Final Review, stage 2 of 3"');
    expect(html).toContain('aria-label="Prepared for Handoff, stage 3 of 3"');
    expect(html.match(/class="trip-track"/g)).toHaveLength(3);
    expect(html.match(/trip-track-on/g)).toHaveLength(1 + 2 + 3);
  });

  it('says Allowed or Not Allowed in words beside each traveller, with a button that keeps the full context for a screen reader', () => {
    const html = trip(
      [
        card({}),
        card({ applicantId: 'a2', missionId: 'm2', name: 'Synthetic Ben' }),
        card({ applicantId: 'a3', missionId: 'm3', name: 'Synthetic Cara' }),
      ],
      [
        {
          id: 'e1',
          name: 'Hotel Booking',
          sourceApplicantId: 'a1',
          sourceName: 'Synthetic Anna',
          allowedFor: ['a2'],
        },
      ] as never,
    );
    expect(html.match(/trip-allow-state trip-allow-on">Allowed</g)).toHaveLength(1);
    expect(html.match(/trip-allow-state">Not Allowed</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Stop Using for Synthetic Ben: Hotel Booking"');
    expect(html).toContain('aria-label="Use for Synthetic Cara: Hotel Booking"');
    expect(html).toMatch(/>Stop Using</);
    expect(html).toMatch(/>Use</);
  });
});
