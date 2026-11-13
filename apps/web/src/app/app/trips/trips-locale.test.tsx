// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  startGroupTripAction: vi.fn(),
  addTravellersAction: vi.fn(),
  removeTravellerAction: vi.fn(),
  addTripEvidenceAction: vi.fn(),
  removeTripEvidenceAction: vi.fn(),
  tripEvidenceAllowanceAction: vi.fn(),
  removeCompanionAction: vi.fn(),
  resendCompanionAction: vi.fn(),
}));
const {
  RemoveTravellerForm,
  GroupTripStartForm,
  AddTravellersForm,
  RemoveCompanionForm,
  AddTripEvidenceForm,
} = await import('./trip-forms');
const { I18nProvider } = await import('../../../components/i18n-provider');
const { appTripsCatalog } = await import('../../../i18n/app-trips');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BENGALI = /[ঀ-৿]/;
const bn = appTripsCatalog.bn as Record<string, string>;
const en = appTripsCatalog.en as Record<string, string>;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function show(locale: 'en' | 'bn', companionsOn = false) {
  act(() =>
    root.render(
      <I18nProvider locale={locale} pageLang="en">
        <GroupTripStartForm
          countries={[]}
          purposes={[]}
          travellers={[{ applicantId: 'p1', name: 'Rahima Akter' }]}
          companionsOn={companionsOn}
        />
        <RemoveTravellerForm tripId="t1" applicantId="p1" name="Rahima Akter" />
      </I18nProvider>,
    ),
  );
}

describe('trip forms under Bengali', () => {
  it('shows Bengali labels, fills the name into the button label and leaves no placeholder', () => {
    show('bn');
    const text = container.textContent ?? '';
    expect(text).toContain(bn['appTrips.appTripsTripForms.whereAreYouGoing']);
    const remove = container.querySelector('button[aria-label*="Rahima Akter"]');
    expect(remove?.getAttribute('aria-label')).toBe('ভ্রমণ থেকে সরান: Rahima Akter');
    expect(container.innerHTML).not.toMatch(/appTrips\.|\{name\}/);
  });

  it('leaves no raw placeholder in any Bengali string', () => {
    const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [key, text] of Object.entries(bn)) {
      expect(names(text), key).toBe(names(en[key] ?? ''));
    }
  });

  it('shows the invitation and sharing statement in Bengali when Add Someone Else is open (signed off 2026-11-12)', () => {
    const key = 'appTrips.appTripsTripForms.withAnEmailTheyAreInvited';
    expect(key in en).toBe(true);
    expect(key in bn).toBe(true);
    show('bn', true);
    const toggle = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === bn['appTrips.appTripsTripForms.addSomeoneElse'],
    );
    expect(toggle).toBeTruthy();
    act(() => toggle?.click());
    expect(container.textContent).toContain(bn[key]);
    expect(container.textContent).not.toContain(en[key]);
  });
});

describe('trip forms under English', () => {
  it('render the original English text with no Bengali', () => {
    show('en');
    expect(container.textContent).not.toMatch(BENGALI);
    expect(
      container.querySelector('button[aria-label*="Rahima"]')?.getAttribute('aria-label'),
    ).toBe('Remove from Trip: Rahima Akter');
  });
});

describe('trip form states under Bengali', () => {
  const draw = (node: React.ReactNode) =>
    act(() =>
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          {node}
        </I18nProvider>,
      ),
    );
  const k = (key: string) => bn[`appTrips.appTripsTripForms.${key}`] ?? `missing ${key}`;
  const expectBengali = (keys: readonly string[]) => {
    const text = container.textContent ?? '';
    for (const key of keys) {
      expect(text, key).toContain(k(key));
      expect(text, key).not.toContain(en[`appTrips.appTripsTripForms.${key}`]);
    }
    expect(container.innerHTML).not.toMatch(/appTrips\./);
  };
  const press = (words: string) => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === words);
    if (!button) throw new Error(`button ${words}`);
    act(() => button.click());
  };

  it('adding travellers: the list, a new family member and someone else with an email', () => {
    draw(
      <AddTravellersForm
        tripId="t1"
        travellers={[{ applicantId: 'p2', name: 'Karim Akter' }]}
        companionsOn
      />,
    );
    expectBengali(['whoElseIsTravelling']);
    press(k('addAFamilyMember'));
    expectBengali([
      'nameAsOnThePassport',
      'relationship',
      'familyMember',
      'minorGuardian',
      'cancel',
    ]);
    press(k('addSomeoneElse'));
    expectBengali(['withAnEmailTheyAreInvited', 'name', 'email']);
  });

  it('adding travellers when everyone is already on the trip', () => {
    draw(<AddTravellersForm tripId="t1" travellers={[]} />);
    expectBengali(['everyoneYouManageIsAlreadyOn']);
  });

  it('removing someone else asks first; its two answers stay English together', () => {
    draw(<RemoveCompanionForm tripId="t1" companionId="c1" name="Nadia Rahman" />);
    expectBengali(['remove']);
    expect(container.querySelector('button[aria-label]')?.getAttribute('aria-label')).toBe(
      k('removeName').replace('{name}', 'Nadia Rahman'),
    );
    press(k('remove'));
    expect(container.textContent).toContain(
      k('removeNameTheyLoseAccessAt').replace('{name}', 'Nadia Rahman'),
    );
    expect(container.textContent).toContain('Keep');
  });

  it('sharing a travel document: the label, the first choice and what can be shared', () => {
    draw(
      <AddTripEvidenceForm
        tripId="t1"
        documents={[{ documentId: 'd1', label: 'Hotel booking.pdf' } as never]}
      />,
    );
    expectBengali([
      'travelDocument',
      'chooseADocument',
      'onlyBookingsItinerariesInvitationsAndAccommodati',
    ]);
  });
});
