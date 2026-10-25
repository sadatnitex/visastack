// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('./actions', () => ({
  createApplicantAction: vi.fn(),
  setConsentAction: vi.fn(),
}));
const { AddApplicantForm } = await import('./add-applicant-form');
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
});

const posted = () => {
  const form = container.querySelector('form');
  if (!form) throw new Error('form');
  return [...new FormData(form).entries()].filter(([k]) => k !== 'whoFor' && k !== 'managedKind');
};
const radio = (label: string) =>
  [...container.querySelectorAll('label')]
    .find((l) => l.textContent?.includes(label))
    ?.querySelector('input');

describe('first-run "Who is this record for?"', () => {
  it('starts with Me and sends the same value as the existing form (SELF)', () => {
    act(() => root.render(<AddApplicantForm firstRun={{ afterHref: '/app?welcome=1' }} />));
    expect(container.textContent).toContain('Who is this record for?');
    expect(container.textContent).toContain('Name as on the passport');
    expect(posted()).toEqual([
      ['relationship', 'SELF'],
      ['displayName', ''],
    ]);
    expect(container.querySelector('input[name="authorityConfirmed"]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Continue');
  });

  it('Someone I manage reveals Family member or Minor and the authority confirmation', () => {
    act(() => root.render(<AddApplicantForm firstRun={{ afterHref: '/app?welcome=1' }} />));
    act(() => radio('Someone I manage')?.click());
    expect(container.textContent).toContain('Family member');
    expect(container.textContent).toContain('Minor (guardian)');
    const authority = container.querySelector<HTMLInputElement>('input[name="authorityConfirmed"]');
    expect(authority?.required).toBe(true);
    expect(posted()[0]).toEqual(['relationship', 'FAMILY_MEMBER']);
    act(() => radio('Minor (guardian)')?.click());
    expect(posted()[0]).toEqual(['relationship', 'MINOR_GUARDIAN']);
    act(() => radio('Me')?.click());
    expect(posted()[0]).toEqual(['relationship', 'SELF']);
    expect(container.querySelector('input[name="authorityConfirmed"]')).toBeNull();
  });

  it('the existing form is unchanged without firstRun', () => {
    act(() => root.render(<AddApplicantForm />));
    expect(container.querySelector('select[name="relationship"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Add applicant');
    expect(container.textContent).not.toContain('Who is this record for?');
  });
});
