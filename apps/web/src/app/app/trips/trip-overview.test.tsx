import type { OrganiserCompanionView } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderServer } from '../../../lib/next-mocks.test-support';
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

describe('TripOverview: Travelling with You', () => {
  const people: OrganiserCompanionView[] = [
    {
      id: 'c1',
      name: 'Jamal Hossain',
      status: 'NAME_ONLY',
      shareLevel: null,
      planStatus: null,
      papers: [],
    },
    {
      id: 'c2',
      name: 'Nadia Rahman',
      status: 'INVITED',
      shareLevel: null,
      planStatus: null,
      papers: [],
    },
    {
      id: 'c3',
      name: 'Old Invite',
      status: 'EXPIRED',
      shareLevel: null,
      planStatus: null,
      papers: [],
    },
    {
      id: 'c4',
      name: 'Sam Joined',
      status: 'JOINED',
      shareLevel: 'NAME_ONLY',
      planStatus: null,
      papers: [],
    },
    {
      id: 'c5',
      name: 'Lena Planner',
      status: 'JOINED',
      shareLevel: 'PLAN_STATUS',
      planStatus: 'Getting Ready',
      papers: [],
    },
    {
      id: 'c6',
      name: 'Tariq Books',
      status: 'JOINED',
      shareLevel: 'TRAVEL_BOOKINGS',
      planStatus: null,
      papers: [
        { name: 'Tokyo hotel.pdf', kind: 'Hotel or Stay Booking' },
        { name: 'Flight to Tokyo.pdf', kind: 'Flight Ticket' },
      ],
    },
  ];
  const render = (props: { companionsOn?: boolean; companions?: OrganiserCompanionView[] }) =>
    renderServer(
      <TripOverview
        tripId="t1"
        travellers={[card({})]}
        sharedDocuments={[]}
        addable={[]}
        documentOptions={[]}
        {...props}
      />,
    );
  const section = (html: string) =>
    html.slice(html.indexOf('trip-companions-title'), html.indexOf('trip-add-title'));

  it('lists each person with their name and one state word', async () => {
    const html = section(await render({ companionsOn: true, companions: people }));
    expect(html).toContain('Travelling with You');
    for (const person of people) expect(html).toContain(person.name);
    expect(html).toContain('>Not on VisaStack Yet<');
    expect(html).toContain('>Invited<');
    expect(html).toContain('>Invitation Expired<');
    expect(html.match(/>Joined</g)).toHaveLength(3);
  });

  it('says what a joined person shares, in a quiet word, and the one plain phrase for Plan Status', async () => {
    const html = section(await render({ companionsOn: true, companions: people }));
    expect(html).toContain('Shares Name Only');
    expect(html).toContain('Shares Plan Status: Getting Ready');
    expect(html).toContain('Shares Travel Bookings');
    // Someone who has not joined shares nothing, so nothing is said about it.
    expect(html.match(/Shares /g)).toHaveLength(3);
  });

  it('names the papers a Travel Bookings person chose, by name and kind, on a quiet line', async () => {
    const html = section(await render({ companionsOn: true, companions: people }));
    expect(html).toContain(
      'Papers: Tokyo hotel.pdf (Hotel or Stay Booking), Flight to Tokyo.pdf (Flight Ticket)',
    );
    // One line for the one person who chose papers; nobody else has one.
    expect(html.match(/Papers: /g)).toHaveLength(1);
  });

  it('never shows papers for someone who has not joined, whatever the list says', async () => {
    const odd: OrganiserCompanionView[] = [
      {
        id: 'x1',
        name: 'Not Joined',
        status: 'INVITED',
        shareLevel: null,
        planStatus: null,
        papers: [{ name: 'Secret.pdf', kind: 'Flight Ticket' }],
      },
    ];
    const html = await render({ companionsOn: true, companions: odd });
    expect(html).not.toContain('Secret.pdf');
  });

  it('offers Send Again only for an invitation that has not been taken up, and Remove for everyone', async () => {
    const html = section(await render({ companionsOn: true, companions: people }));
    expect(html).toContain('aria-label="Send Again: Nadia Rahman"');
    expect(html).toContain('aria-label="Send Again: Old Invite"');
    expect(html.match(/>Send Again</g)).toHaveLength(2);
    expect(html).not.toContain('Send Again: Jamal Hossain');
    expect(html).not.toContain('Send Again: Sam Joined');
    expect(html.match(/>Remove</g)).toHaveLength(people.length);
    for (const person of people) {
      expect(html).toContain(`aria-label="Remove: ${person.name}"`);
    }
  });

  it('shows no email, link, token or account detail anywhere on the page, and no link in a row', async () => {
    const html = await render({ companionsOn: true, companions: people });
    expect(html).not.toContain('@');
    expect(html).not.toMatch(/mailto:|token|invitation\/|accept/i);
    expect(section(html)).not.toContain('<a ');
    expect(section(html)).not.toContain('<a>');
  });

  it('states state in words, not colour alone, and keeps every action quiet', async () => {
    const html = section(await render({ companionsOn: true, companions: people }));
    expect(html.match(/class="badge badge-neutral"/g)).toHaveLength(people.length);
    expect(html).not.toContain('btn-primary');
    expect(html).not.toContain('style=');
  });

  it('shows nothing new while the feature is off, even with people in the list', async () => {
    const html = await render({ companionsOn: false, companions: people });
    expect(html).not.toContain('Travelling with You');
    expect(html).not.toContain('Someone Else');
    for (const person of people) expect(html).not.toContain(person.name);
  });

  it('shows no empty section when the feature is on and nobody has been added, and offers Add Someone Else', async () => {
    const html = await render({ companionsOn: true, companions: [] });
    expect(html).not.toContain('Travelling with You');
    expect(html).toContain('Add Someone Else');
  });

  it('looks exactly as before when told nothing about the feature', async () => {
    const plain = await render({});
    const off = await render({ companionsOn: false, companions: [] });
    expect(plain).toBe(off);
    expect(plain).not.toContain('Someone Else');
  });
});
