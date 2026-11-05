// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const keep = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ keepCopyAction: keep }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { KeepCopyAction } = await import('./keep-copy-action');

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  keep.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = async () => {
  await act(async () =>
    root.render(
      <KeepCopyAction
        applicantId="a1"
        documentId="d1"
        documentName="Marriage Certificate"
        copyPeople={[{ id: 'a2', name: 'Salma Sadat' }]}
        onClose={() => undefined}
      />,
    ),
  );
};
const submit = async () => {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Keep a Copy');
  await act(async () => button?.click());
};

describe('after the copy is kept', () => {
  it('replaces the form with the answer, moves focus to Close, and keeps the message where it was announced', async () => {
    keep.mockResolvedValue({
      ok: true,
      message: 'A copy is kept for Salma Sadat. It is checked for safety first, like any new file.',
      targetId: 'a2',
    });
    await mount();
    const live = host.querySelector('output');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe('');
    await submit();
    expect(host.querySelector('form')).toBeNull();
    // The very same element now holds the words, so a screen reader announces them.
    expect(host.querySelector('output')).toBe(live);
    expect(live?.textContent).toContain('A copy is kept for Salma Sadat.');
    expect(document.activeElement?.textContent).toBe('Close');
    expect(host.querySelector('a[href="/app/applicant/a2/documents"]')?.textContent).toBe(
      'Open Their Documents',
    );
  });

  it('keeps the form and shows the plain reason when it is refused', async () => {
    keep.mockResolvedValue({ ok: false, message: 'Salma Sadat already has this document.' });
    await mount();
    await submit();
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).toContain('Salma Sadat already has this document.');
    expect(host.textContent).not.toContain('Open Their Documents');
  });
});
