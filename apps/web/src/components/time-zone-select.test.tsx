// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { TimeZoneSelect } from './time-zone-select';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  vi.restoreAllMocks();
});

/** Make this device report a zone, the way a person's browser does. */
function deviceZone(zone: string | 'throw') {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    if (zone === 'throw') throw new Error('no zone');
    return { ...original.call(this), timeZone: zone };
  });
}

function mount(props: Partial<Parameters<typeof TimeZoneSelect>[0]> = {}) {
  act(() =>
    root.render(
      <form>
        <TimeZoneSelect name="timezone" {...props} />
      </form>,
    ),
  );
  return container.querySelector('select') as HTMLSelectElement;
}

/** The person reaches for the list: with no screen watcher in jsdom, that is what builds it. */
function reach(select: HTMLSelectElement) {
  act(() => {
    select.dispatchEvent(new Event('focus'));
  });
}

describe('TimeZoneSelect', () => {
  it('is a list to choose from, named for screen readers, that posts the zone name', () => {
    deviceZone('Asia/Dhaka');
    const select = mount();
    expect(select.tagName).toBe('SELECT');
    expect(select.getAttribute('aria-label')).toBe('Time Zone');
    expect(select.name).toBe('timezone');
    expect(select.required).toBe(true);
    expect(select.value).toBe('Asia/Dhaka');
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('timezone')).toBe('Asia/Dhaka');
  });

  it('offers every zone, grouped, each once, labelled with its offset and a readable city', () => {
    deviceZone('Asia/Dhaka');
    const select = mount();
    reach(select);
    expect(select.querySelectorAll('option').length).toBeGreaterThan(100);
    const groups = [...select.querySelectorAll('optgroup')].map((group) => group.label);
    expect(groups[0]).toBe('Common');
    expect(groups).toContain('Asia');
    expect(groups).toContain('Europe');
    const ids = [...select.querySelectorAll('option')].map((o) => o.value).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    const dhaka = [...select.querySelectorAll('option')].find((o) => o.value === 'Asia/Dhaka');
    expect(dhaka?.textContent).toBe('(UTC+06:00) Dhaka');
  });

  it('offers the modern city names, not the old spellings', () => {
    deviceZone('UTC');
    const select = mount();
    reach(select);
    const ids = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(ids).toContain('Asia/Kolkata');
    expect(ids).not.toContain('Asia/Calcutta');
    expect(ids).toContain('Asia/Kathmandu');
  });

  it('does not overwrite a zone it was given or one the person chose', () => {
    deviceZone('Asia/Dhaka');
    const select = mount({ defaultValue: 'Europe/Paris' });
    expect(select.value).toBe('Europe/Paris');
    act(() => {
      select.value = 'Asia/Singapore';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('Asia/Singapore');
  });

  it('stays empty and required when the device cannot say, so the form asks for a choice', () => {
    deviceZone('throw');
    const select = mount();
    expect(select.value).toBe('');
    expect(select.required).toBe(true);
    expect(select.querySelector('option')?.textContent).toBe('Choose a Time Zone');
  });

  it('can be named for its place on a page', () => {
    deviceZone('UTC');
    const select = mount({ label: 'Appointment Time Zone' });
    expect(select.getAttribute('aria-label')).toBe('Appointment Time Zone');
  });

  it('takes its name from a visible label when one points at it', () => {
    deviceZone('UTC');
    const select = mount({ id: 'appt-zone' });
    expect(select.id).toBe('appt-zone');
    expect(select.hasAttribute('aria-label')).toBe(false);
  });

  it('shows its starting zone again when the form is reset after a save', async () => {
    deviceZone('Asia/Dhaka');
    const select = mount();
    act(() => {
      select.value = 'Europe/Paris';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('Europe/Paris');
    await act(async () => {
      select.form?.reset();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(select.value).toBe('Asia/Dhaka');
  });

  it('builds nothing until the select is reached, and builds the zone list once for every select', () => {
    // A device zone no other test uses, so the shared list is built here and not by an earlier test.
    deviceZone('Pacific/Auckland');
    // Listing the runtime's zones happens once per build of the full list.
    const listings = vi.spyOn(
      Intl as unknown as { supportedValuesOf: () => string[] },
      'supportedValuesOf',
    );
    act(() =>
      root.render(
        <form>
          <TimeZoneSelect name="a" label="First Zone" />
          <TimeZoneSelect name="b" label="Second Zone" />
        </form>,
      ),
    );
    const [first, second] = [...container.querySelectorAll('select')] as HTMLSelectElement[];
    // Just the short list: the usual places, the device's own zone and the blank choice.
    expect(first?.querySelectorAll('option').length).toBe(16);
    expect(listings).not.toHaveBeenCalled();
    reach(first as HTMLSelectElement);
    expect(listings).toHaveBeenCalledTimes(1);
    // The second select reuses what the first built.
    reach(second as HTMLSelectElement);
    expect(listings).toHaveBeenCalledTimes(1);
    expect(second?.querySelectorAll('option').length).toBeGreaterThan(100);
  });

  it('builds the list when a screen watcher says the select is near the screen', () => {
    deviceZone('Asia/Dhaka');
    let report: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    class Watcher {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Watcher);
    try {
      const select = mount();
      expect(select.querySelectorAll('option').length).toBe(15);
      act(() => report?.([{ isIntersecting: false }]));
      expect(select.querySelectorAll('option').length).toBe(15);
      act(() => report?.([{ isIntersecting: true }]));
      expect(select.querySelectorAll('option').length).toBeGreaterThan(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows a device zone outside the usual places at once, as one extra option', () => {
    deviceZone('Africa/Nairobi');
    const select = mount();
    expect(select.value).toBe('Africa/Nairobi');
    expect(select.querySelectorAll('option').length).toBe(16);
    expect(select.selectedOptions[0]?.textContent).toBe('(UTC+03:00) Nairobi');
  });

  it('saves the latest name of a zone the device reports by an old one', () => {
    deviceZone('Asia/Calcutta');
    const select = mount();
    expect(select.value).toBe('Asia/Kolkata');
  });

  it('passes the automated accessibility rules', async () => {
    deviceZone('Asia/Dhaka');
    mount();
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
