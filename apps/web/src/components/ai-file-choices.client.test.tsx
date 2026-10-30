// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAiFileChoices } from '../lib/ai-consent-choices';
import { AiFileChoices } from './ai-file-choices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** "Original Files" once the page runs in the browser (S20 round 3). Made-up documents only. */
const VISA = '44444444-4444-4444-8444-444444444444';
const CANDIDATES = [
  {
    documentId: VISA,
    referenceCode: 'D-7K2Q9M',
    kind: 'Visa',
    group: 'Travel and Immigration',
    safeCopyReady: true,
  },
];

let root: Root;
let form: HTMLFormElement;
beforeEach(() => {
  form = document.createElement('form');
  document.body.append(form);
  root = createRoot(form);
});
afterEach(() => {
  act(() => root.unmount());
  form.remove();
});

const box = () => form.querySelector<HTMLInputElement>(`input[name="file"][value="${VISA}"]`);
const way = (value: string) =>
  form.querySelector<HTMLInputElement>(`input[name="file_variant_${VISA}"][value="${value}"]`);

describe('Original Files in the browser', () => {
  it('closes both ways until Share This File is ticked, says why, and opens them on tick', () => {
    act(() => root.render(<AiFileChoices candidates={CANDIDATES} initial={[]} available={true} />));
    expect(way('SAFE_COPY')?.disabled).toBe(true);
    expect(way('ORIGINAL')?.disabled).toBe(true);
    const hint = way('ORIGINAL')?.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(
      hint.some((id) => document.getElementById(id)?.textContent?.startsWith('Tick Share')),
    ).toBe(true);
    act(() => box()?.click());
    expect(way('ORIGINAL')?.disabled).toBe(false);
    act(() => way('ORIGINAL')?.click());
    expect(parseAiFileChoices(new FormData(form))).toEqual([
      { documentId: VISA, variant: 'ORIGINAL' },
    ]);
  });

  it('starts again from the boxes as the form shows them after a reset', async () => {
    act(() =>
      root.render(
        <AiFileChoices
          candidates={CANDIDATES}
          initial={[{ documentId: VISA, variant: 'SAFE_COPY' }]}
          available={true}
        />,
      ),
    );
    act(() => box()?.click());
    expect(way('SAFE_COPY')?.disabled).toBe(true);
    await act(async () => {
      form.reset();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(box()?.checked).toBe(true);
    expect(way('SAFE_COPY')?.disabled).toBe(false);
  });
});
