// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return [...new FormData(form).entries()].map(([k, v]) => [k, String(v)]);
};
const radio = (label: string) =>
  [...container.querySelectorAll('label')]
    .find((l) => l.textContent?.includes(label))
    ?.querySelector('input');

describe('first-run "Who is this record for?"', () => {
  it('starts with Me and sends the choice with the radio itself', () => {
    act(() => root.render(<AddApplicantForm firstRun />));
    expect(container.textContent).toContain('Who is this record for?');
    expect(container.textContent).toContain('Name as on the Passport');
    expect(posted()).toEqual([
      ['whoFor', 'SELF'],
      ['displayName', ''],
    ]);
    expect(container.querySelector('input[name="relationship"]')).toBeNull();
    const authority = container.querySelector<HTMLInputElement>('input[name="authorityConfirmed"]');
    expect(authority?.required).toBe(false);
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Continue');
  });

  it('Someone I Manage sends Family Member or Minor and requires the authority confirmation', () => {
    act(() => root.render(<AddApplicantForm firstRun />));
    act(() => radio('Someone I Manage')?.click());
    expect(container.textContent).toContain('Family Member');
    expect(container.textContent).toContain('Minor (Guardian)');
    expect(
      container.querySelector<HTMLInputElement>('input[name="authorityConfirmed"]')?.required,
    ).toBe(true);
    expect(posted().slice(0, 2)).toEqual([
      ['whoFor', 'MANAGED'],
      ['managedKind', 'FAMILY_MEMBER'],
    ]);
    act(() => radio('Minor (Guardian)')?.click());
    expect(posted()[1]).toEqual(['managedKind', 'MINOR_GUARDIAN']);
    act(() => radio('Me')?.click());
    expect(posted()[0]).toEqual(['whoFor', 'SELF']);
  });

  it('works before the page has loaded its scripts: the markup alone carries the choice', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(<AddApplicantForm firstRun />);
    // A real radio named whoFor, already on Me, and a submit button that is not held back.
    const markup = document.createElement('div');
    markup.innerHTML = html;
    expect(
      markup.querySelector('input[name="whoFor"][value="SELF"]')?.hasAttribute('checked'),
    ).toBe(true);
    expect(markup.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
    // The second question is in the page and shown by style, not by script.
    expect(
      markup.querySelector('input[name="managedKind"][value="MINOR_GUARDIAN"]'),
    ).not.toBeNull();
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
    expect(css).toMatch(
      /\.first-run-form:not\(:has\(input\[name="whoFor"\]\[value="MANAGED"\]:checked\)\) \.first-run-managed \{\s*display: none;/,
    );
  });

  it('the existing form is unchanged without firstRun, and needs no router', () => {
    act(() => root.render(<AddApplicantForm />));
    expect(container.querySelector('select[name="relationship"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Add Traveller');
    expect(container.textContent).not.toContain('Who is this record for?');
  });
});
