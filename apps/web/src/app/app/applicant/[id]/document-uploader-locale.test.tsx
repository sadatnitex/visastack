// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
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
    expect(`${K}notSureYet` in bn).toBe(false);
    expect(text).toContain(en[`${K}notSureYet`]);
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
    // Held back: the promise about an identical copy stays in English.
    expect(`${K}youAlreadyKeepAnIdenticalCopy` in bn).toBe(false);
    expect(text).toContain('You already keep an identical copy of this file.');
  });

  it('is the same English as before under English', async () => {
    const { text } = await upload('en', { kind: 'added', message: 'Passport added.', title: null });
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Drop Files Here');
    expect(text).toContain('Document Saved');
  });
});
