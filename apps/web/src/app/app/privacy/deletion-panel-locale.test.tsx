// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  requestDeletionAction: async () => ({ ok: true, message: '' }),
  cancelDeletionAction: async () => ({ ok: true, message: '' }),
  requestLargeExportAction: async () => ({ ok: true, message: '' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

import { I18nProvider } from '../../../components/i18n-provider';
import { appPrivacyCatalog } from '../../../i18n/app-privacy';
import { DeletionPanel } from './deletion-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bn = appPrivacyCatalog.bn as Record<string, string>;
const impact = {
  applicants: [],
  missionCount: 0,
  documentCount: 0,
  activePlatformRoleCount: 0,
  authoredMissionNoteCount: 0,
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the deletion panel under Bengali (signed off 2026-11-12)', () => {
  it('shows the Bengali reason hint, then the Bengali confirmation after the request button', () => {
    act(() =>
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          <DeletionPanel scheduledFor={null} impact={impact} holds={[]} />
        </I18nProvider>,
      ),
    );
    expect(host.querySelector('input[name="reason"]')?.getAttribute('placeholder')).toBe(
      bn['appPrivacy.appPrivacyDeletionPanel.helpsUsImproveNotRequired'],
    );
    expect(host.querySelector('label[for="del-reason"]')?.textContent).toBe(
      bn['appPrivacy.appPrivacyDeletionPanel.reasonOptional'],
    );
    const request = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === bn['appPrivacy.appPrivacyDeletionPanel.requestAccountDeletion'],
    );
    expect(request).toBeTruthy();
    act(() => request?.click());
    expect(host.textContent).toContain(
      bn['appPrivacy.appPrivacyDeletionPanel.schedulePermanentDeletionOfYourAccount'],
    );
    // Left English at review: both choices of the confirmation stay in one language.
    expect(host.textContent).toContain('Keep My Account');
    expect(host.textContent).not.toMatch(/appPrivacy\./);
  });

  it('keeps the English wording under English', () => {
    act(() =>
      root.render(
        <I18nProvider locale="en" pageLang="en">
          <DeletionPanel scheduledFor={null} impact={impact} holds={[]} />
        </I18nProvider>,
      ),
    );
    expect(host.textContent).toContain('Request Account Deletion');
    expect(host.textContent).not.toMatch(/[ঀ-৿]/);
  });
});
