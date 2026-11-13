// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';

/** The uploader under Bengali, before a file, after a saved file, and for a copy it can remove. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
const copy = vi.hoisted(() => ({
  send: vi.fn(),
  report: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));
vi.mock('../../../../lib/document-upload-client', () => ({
  sendDocumentFile: copy.send,
  reportUploadProblem: copy.report,
}));
vi.mock('./documents/manage/delete/actions', () => ({
  deleteDuplicateAction: copy.remove,
  restoreDeletedAction: copy.restore,
}));

const { DocumentUploader } = await import('./document-uploader');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdDocumentUploader.';
const BENGALI = /[ঀ-৿]/;

/** Every uploader a test put on the page, taken off again when that test ends. */
const mounted: { readonly root: ReturnType<typeof createRoot>; readonly host: HTMLElement }[] = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
  copy.send.mockReset();
  copy.remove.mockReset();
});

async function upload(
  locale: 'en' | 'bn',
  outcome?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  count = 1,
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(
      <I18nProvider locale={locale} pageLang={locale}>
        <DocumentUploader
          applicantId="a1"
          limitBytes={4 * 1024 * 1024}
          limitLabel="4 MB"
          {...extra}
        />
      </I18nProvider>,
    );
  });
  if (outcome) {
    copy.send.mockResolvedValue(outcome);
    const picker = host.querySelector('input[type="file"]') as HTMLInputElement;
    const files = Array.from(
      { length: count },
      (_, i) => new File(['x'], i === 0 ? 'passport.jpg' : `page-${i}.jpg`, { type: 'image/jpeg' }),
    );
    Object.defineProperty(picker, 'files', { value: files, configurable: true });
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (let turn = 0; turn < 4; turn++)
      await act(async () => {
        await Promise.resolve();
      });
  }
  return { host, text: (host.textContent ?? '').replace(/\s+/g, ' '), root };
}

describe('the uploader under Bengali', () => {
  it('shows the drop area, the buttons and the field labels in Bengali before any file', async () => {
    const { host, text } = await upload('bn');
    for (const key of ['dropFilesHere', 'chooseFiles', 'takeAPhoto'])
      expect(text, key).toContain(bn[`${K}${key}`]);
    const labels = host.innerHTML;
    expect(labels).toContain(`aria-label="${bn[`${K}documentFiles`]}"`);
    expect(labels).toContain(`aria-label="${bn[`${K}cameraPhoto`]}"`);
    // Where the file is kept and who can open it: Bengali since the owner sign-off of 2026-11-12.
    expect(`${K}storedPrivatelyOnlyYouAndThe` in bn).toBe(true);
    expect(text).toContain(bn[`${K}storedPrivatelyOnlyYouAndThe`]);
    expect(text).not.toContain(en[`${K}storedPrivatelyOnlyYouAndThe`]);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('shows the kind picker in Bengali, with the kind names and the Not Sure choice as they are', async () => {
    const kindGroups = [
      {
        key: 'identity',
        label: 'Identity',
        choices: [
          { key: 'PASSPORT', label: 'Passport' },
          { key: 'OTHER', label: 'Other Document' },
        ],
      },
    ];
    const { text } = await upload('bn', undefined, { kindGroups });
    expect(text).toContain(bn[`${K}kindOfDocumentOptional`]);
    expect(text).toContain('Passport');
    expect(text).toContain(bn[`${K}notSureYet`]);
    expect(text).not.toContain(en[`${K}notSureYet`]);
  });

  it('says a saved file is saved in Bengali, and keeps the file name and server message as they are', async () => {
    const { text } = await upload('bn', { kind: 'added', message: 'Passport added.', title: null });
    expect(text).toContain(bn[`${K}documentSaved`]);
    expect(text).toContain('passport.jpg');
    expect(text).toContain('Passport added.');
  });

  it('says several saved files are saved, in the plural Bengali title', async () => {
    const { text } = await upload('bn', { kind: 'added', message: 'Added.', title: null }, {}, 2);
    expect(text).toContain(bn[`${K}documentsSaved`]);
  });

  it('offers Remove This New Copy in Bengali, with the file name, for an identical copy', async () => {
    const { host, text } = await upload('bn', {
      kind: 'added',
      message: 'Passport added.',
      title: null,
      removableCopyId: '11111111-1111-4111-8111-111111111111',
    });
    expect(text).toContain(bn[`${K}removeThisNewCopy`]);
    expect(host.innerHTML).toContain(
      `aria-label="${bn[`${K}removeThisNewCopyName`]?.replace('{name}', 'passport.jpg')}"`,
    );
    expect(text).toContain(bn[`${K}youAlreadyKeepAnIdenticalCopy`]);
    expect(text).not.toContain('You already keep an identical copy of this file.');
  });

  it('words every failed removal from the catalogue: Bengali where a checked draft exists, the exact English where it is held', async () => {
    const R = 'appApplicant.appApplicantIdDocumentsManageRemoval.';
    const outcome = {
      kind: 'added',
      message: 'Passport added.',
      title: null,
      removableCopyId: '11111111-1111-4111-8111-111111111111',
    };
    const removeAndRead = async (locale: 'en' | 'bn', result: 'down' | Record<string, unknown>) => {
      if (result === 'down') copy.remove.mockReset().mockRejectedValue(new Error('offline'));
      else copy.remove.mockReset().mockResolvedValue(result);
      const { host } = await upload(locale, outcome);
      const remove = [...host.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.includes('passport.jpg'),
      );
      await act(async () => {
        remove?.click();
      });
      return host.querySelector('[role="alert"]')?.textContent;
    };
    expect(await removeAndRead('bn', 'down')).toBe(bn[`${R}couldNotRemoveIt`]);
    expect(await removeAndRead('en', 'down')).toBe(
      'We could not remove it. Check your connection and try again.',
    );
    const kept = {
      ok: false,
      message: 'This copy must be kept for a legal requirement. You can archive it instead.',
      messageKey: `${R}copyKeptLegalHold`,
    };
    // Held: new legal wording the owner has not confirmed. The exact English shows, and no Bengali
    // value exists that could ship by mistake.
    expect(bn[`${R}copyKeptLegalHold`]).toBeUndefined();
    expect(await removeAndRead('bn', kept)).toBe(kept.message);
    expect(await removeAndRead('en', kept)).toBe(kept.message);
    // Every refusal Remove This New Copy can get: Bengali where a checked draft exists, the exact
    // English where it is held (it names Recently Deleted, whose own label is still English).
    for (const name of [
      'notOwnerOfRecord',
      'documentNoLongerHere',
      'copyKeptFinishedCase',
      'copyKeptAgencyAnswer',
      'copyKeptHandover',
      'copyKeptSharedByName',
      'copyNotDuplicate',
      'copyAlreadyRecentlyDeleted',
      'copyCannotBeDeletedNow',
    ]) {
      const key = `${R}${name}`;
      const refusal = { ok: false, message: en[key], messageKey: key };
      expect(en[key], name).toBeTruthy();
      expect(await removeAndRead('en', refusal), name).toBe(en[key]);
      const shown = await removeAndRead('bn', refusal);
      if (name === 'copyAlreadyRecentlyDeleted') {
        expect(bn[key], name).toBeUndefined();
        expect(shown, name).toBe(en[key]);
      } else {
        expect(bn[key], name).toBeTruthy();
        expect(shown, name).toBe(bn[key]);
        expect(shown, name).toMatch(BENGALI);
      }
    }
  });

  it('rewords a failed removal that is already on screen when the language is switched', async () => {
    const R = 'appApplicant.appApplicantIdDocumentsManageRemoval.';
    copy.remove.mockReset().mockRejectedValue(new Error('offline'));
    const { host, root } = await upload('bn', {
      kind: 'added',
      message: 'Passport added.',
      title: null,
      removableCopyId: '11111111-1111-4111-8111-111111111111',
    });
    const remove = [...host.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.includes('passport.jpg'),
    );
    await act(async () => {
      remove?.click();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(bn[`${R}couldNotRemoveIt`]);
    await act(async () => {
      root.render(
        <I18nProvider locale="en" pageLang="en">
          <DocumentUploader applicantId="a1" limitBytes={4 * 1024 * 1024} limitLabel="4 MB" />
        </I18nProvider>,
      );
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'We could not remove it. Check your connection and try again.',
    );
  });

  /** The Try Again button of the one file in the list, found by its place, not by its wording. */
  const retryButton = (host: HTMLElement) =>
    host.querySelector('.upload-item > button.btn') as HTMLButtonElement | null;
  const REFUSED = { kind: 'refused', message: 'This file is too large.' };
  const COPY = {
    kind: 'added',
    message: 'Passport added.',
    title: null,
    removableCopyId: '11111111-1111-4111-8111-111111111111',
  };
  /** Press Remove This New Copy while the server has not answered yet: the button stays busy. */
  const startRemoval = async (locale: 'en' | 'bn') => {
    copy.remove.mockReturnValue(new Promise(() => undefined));
    const { host } = await upload(locale, COPY);
    const remove = host.querySelector('.lc-new-copy button') as HTMLButtonElement;
    await act(async () => {
      remove.click();
    });
    return remove;
  };

  it('offers Try Again in Bengali, seen and spoken, for a file that was refused', async () => {
    const { host, text } = await upload('bn', REFUSED);
    expect(host.querySelector('.upload-item')?.getAttribute('data-status')).toBe('refused');
    const retry = retryButton(host);
    expect(bn[`${K}tryAgain`]).toMatch(BENGALI);
    expect(retry?.textContent).toBe(bn[`${K}tryAgain`]);
    expect(bn[`${K}tryAgainName`]).toMatch(BENGALI);
    expect(retry?.getAttribute('aria-label')).toBe(
      bn[`${K}tryAgainName`]?.replace('{name}', 'passport.jpg'),
    );
    expect(retry?.getAttribute('aria-label')).toContain('passport.jpg');
    // Still English: the flag and the server's own reason.
    expect(host.querySelector('.upload-item-flag')?.textContent).toBe(en[`${K}notAdded`]);
    expect(text).toContain('Not added. This file is too large.');
    expect(text).not.toContain('Try Again');
    expect(text).not.toMatch(/appApplicant\./);
    expect(host.innerHTML).not.toMatch(/appApplicant\./);
  });

  it('offers Try Again in Bengali, seen and spoken, for a file whose upload was not confirmed', async () => {
    const { host, text } = await upload('bn', { kind: 'unknown' });
    expect(host.querySelector('.upload-item')?.getAttribute('data-status')).toBe('unknown');
    const retry = retryButton(host);
    expect(retry?.textContent).toBe(bn[`${K}tryAgain`]);
    expect(retry?.getAttribute('aria-label')).toBe(
      bn[`${K}tryAgainName`]?.replace('{name}', 'passport.jpg'),
    );
    // Still English: the flag.
    expect(host.querySelector('.upload-item-flag')?.textContent).toBe(en[`${K}notConfirmed`]);
    expect(text).toContain('Not confirmed.');
    expect(text).not.toContain('Try Again');
    expect(text).not.toMatch(/appApplicant\./);
    expect(host.innerHTML).not.toMatch(/appApplicant\./);
  });

  it('says Removing in Bengali while the new copy is being removed', async () => {
    const remove = await startRemoval('bn');
    expect(copy.remove).toHaveBeenCalledTimes(1);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(bn[`${K}removing`]).toMatch(BENGALI);
    expect(remove.textContent).toBe(bn[`${K}removing`]);
    expect(remove.textContent).not.toMatch(/appApplicant\./);
  });

  it('keeps Try Again and Removing as the exact English under English', async () => {
    for (const [outcome, status, flag] of [
      [REFUSED, 'refused', 'Not added. '],
      [{ kind: 'unknown' }, 'unknown', 'Not confirmed. '],
    ] as const) {
      const { host, text } = await upload('en', outcome);
      expect(host.querySelector('.upload-item')?.getAttribute('data-status')).toBe(status);
      const retry = retryButton(host);
      expect(retry?.textContent, status).toBe('Try Again');
      expect(retry?.getAttribute('aria-label'), status).toBe('Try Again: passport.jpg');
      expect(host.querySelector('.upload-item-flag')?.textContent, status).toBe(flag);
      expect(text, status).not.toMatch(BENGALI);
      expect(host.innerHTML, status).not.toMatch(BENGALI);
    }
    const remove = await startRemoval('en');
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.textContent).toBe('Removing');
    expect(remove.closest('.upload-item')?.innerHTML).not.toMatch(BENGALI);
  });

  it('is the same English as before under English', async () => {
    const { text } = await upload('en', { kind: 'added', message: 'Passport added.', title: null });
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Drop Files Here');
    expect(text).toContain('Document Saved');
  });
});
