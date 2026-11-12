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
const { RemoveTravellerForm, GroupTripStartForm } = await import('./trip-forms');
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

function show(locale: 'en' | 'bn') {
  act(() =>
    root.render(
      <I18nProvider locale={locale} pageLang="en">
        <GroupTripStartForm
          countries={[]}
          purposes={[]}
          travellers={[{ applicantId: 'p1', name: 'Rahima Akter' }]}
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

  it('keeps the invitation and sharing statement in English, held back', () => {
    const key = 'appTrips.appTripsTripForms.withAnEmailTheyAreInvited';
    expect(key in en).toBe(true);
    expect(key in bn).toBe(false);
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
