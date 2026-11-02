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
});
