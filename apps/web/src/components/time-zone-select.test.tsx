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

  it('passes the automated accessibility rules', async () => {
    deviceZone('Asia/Dhaka');
    mount();
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
