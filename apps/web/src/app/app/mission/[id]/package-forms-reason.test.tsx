// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./package-actions', () => ({
  recordPackageChoiceAction: vi.fn(),
  markPackageChangeReviewedAction: vi.fn(),
  confirmPackageHandoffAction: vi.fn(),
}));

const { PackageItemChoiceForm } = await import('./package-forms');

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

describe('the reason for leaving an item out', () => {
  it('is asked only once Leave Out is picked, and a typed reason is never lost by looking away', () => {
    act(() =>
      root.render(
        <PackageItemChoiceForm
          missionId="m"
          packRequirementId="p"
          itemName="Passport"
          options={[{ value: 'd:1', label: 'Use Passport Scan' }]}
          current="d:1"
          canExclude={true}
          hasChoice={false}
        />,
      ),
    );
    const box = container.querySelector<HTMLElement>('.package-reason');
    const select = container.querySelector('select') as HTMLSelectElement;
    const reason = container.querySelector('input[name="reason"]') as HTMLInputElement;
    // Once the script runs, the box is out of view but still in the page.
    expect(box?.hidden).toBe(true);
    act(() => {
      select.value = 'exclude';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(box?.hidden).toBe(false);
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(reason, 'Not needed for this trip');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      select.value = 'missing';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(box?.hidden).toBe(true);
    expect(reason.value).toBe('Not needed for this trip');
  });
});
