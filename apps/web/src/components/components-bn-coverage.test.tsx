// @vitest-environment jsdom
import { type ReactElement, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A logger around the lookup: which Bengali messages did a render really use?
const used = vi.hoisted(() => new Set<string>());
vi.mock('../lib/language-parts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/language-parts')>();
  return {
    ...real,
    partsTranslator: (catalog: { bn: Record<string, string> }, locale: string, pageLang: never) => {
      const inner = real.partsTranslator(
        catalog as never,
        locale as never,
        pageLang,
      ) as unknown as {
        (key: string, params?: never): string;
        node(key: string, params?: never): unknown;
        lang(key: string): unknown;
      };
      const seen = (key: string) => {
        if (locale === 'bn' && key in catalog.bn) used.add(key);
      };
      return Object.assign(
        (key: string, params?: never) => {
          seen(key);
          return inner(key, params);
        },
        {
          node: (key: string, params?: never) => {
            seen(key);
            return inner.node(key, params);
          },
          lang: (key: string) => inner.lang(key),
        },
      );
    },
  };
});
vi.mock('./profile-photo/photo-canvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./profile-photo/photo-canvas')>()),
  decodePhoto: async () => ({ width: 800, height: 600, close: () => undefined }),
  drawPreview: () => undefined,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/start',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { componentsCatalog } from '../i18n/components';
import { componentsProfilePhotoCatalog } from '../i18n/components-profile-photo';
import { componentsPwaCatalog } from '../i18n/components-pwa';
import { ActivityLog, type ActivityLogEntry } from './activity-log';
import { CapturePreview } from './capture-preview';
import { ChecklistCorrectionForm } from './checklist-correction-form';
import { CountryBrowser, type CountryBrowserItem } from './country-browser';
import { DocumentReviewPanel } from './document-review-panel';
import { DocumentWalletBrowser, type WalletBrowserDocument } from './document-wallet-browser';
import { I18nProvider } from './i18n-provider';
import { ProfilePhotoControl } from './profile-photo/profile-photo-control';
import { PurposeChoice } from './purpose-choice';
import { InstallAppCard } from './pwa/install-app-card';
import { ReceiptCard } from './receipt-card';
import { ReferenceCode } from './reference-code';
import { SiteNavigation } from './site-navigation';
import { TimeZoneSelect } from './time-zone-select';
import { VersionNotice } from './version-notice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const noMedia = (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});
beforeEach(() => {
  vi.stubGlobal('matchMedia', noMedia);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function show(node: ReactElement) {
  act(() =>
    root.render(
      <I18nProvider locale="bn" pageLang="en">
        {node}
      </I18nProvider>,
    ),
  );
}
const phone = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error('Missing control');
  act(() => (element as HTMLElement).click());
};
const byText = (selector: string, text: string) =>
  [...host.querySelectorAll(selector)].find((node) => node.textContent?.includes(text));
const noRawKey = () => expect(host.textContent).not.toMatch(/\bcomponents[A-Za-z]*\.[a-z]/i);

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const logEntries: ActivityLogEntry[] = Array.from({ length: 30 }, (_, index) => ({
  id: String(index),
  what: `Entry ${index}`,
  who: index % 2 ? 'agent@example.test' : 'System',
  outcome: { label: index % 3 ? 'Allowed' : 'Blocked', tone: index % 3 ? 'success' : 'danger' },
  at: hoursAgo(index * 5),
  when: `Day ${index}`,
}));
const countries: CountryBrowserItem[] = Array.from({ length: 14 }, (_, index) => ({
  iso2: `C${index}`,
  href: `/c/${index}`,
  name: `Country ${index}`,
  status: index % 2 ? 'E_VISA' : 'VISA_REQUIRED',
  stay: null,
  fee: null,
  unconfirmed: index === 0,
}));
const wallet = (count: number): WalletBrowserDocument[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `doc-${index}`,
    name: `Document ${index}`,
    kind: index === 0 ? null : 'Bank Statement',
    category: index === 0 ? null : 'Finance',
    version: index + 1,
    updatedAt: '2026-10-11T00:00:00Z',
    ready: index > 0,
    needsReview: index === 0,
    expiring: index === 1,
    safetyLabel: 'Clean',
    processingLabel: 'Approved',
    previewAllowed: index > 0,
    details: <span>Details {index}</span>,
  }));

describe('every live Bengali message of the shared components is shown under bn', () => {
  it('activity log', () => {
    show(
      <ActivityLog
        entries={logEntries}
        label="Access Log Entries"
        olderHref="/log?page=2"
        newestHref="/log"
      />,
    );
    noRawKey();
  });

  it('country browser', () => {
    show(
      <CountryBrowser
        items={countries}
        filters={[
          { status: 'VISA_REQUIRED', label: 'Visa Needed', statusLabel: 'Visa Needed' },
          { status: 'E_VISA', label: 'E-Visa', statusLabel: 'E-Visa' },
        ]}
      />,
    );
    noRawKey();
  });

  it('wallet browser: a long list, an empty list, and the phone sheet', () => {
    show(<DocumentWalletBrowser applicantId="p" documents={wallet(15)} />);
    click(byText('button', componentsCatalog.bn['components.documentWalletBrowser.next']));
    show(<DocumentWalletBrowser applicantId="p" documents={[]} />);
    phone();
    show(<DocumentWalletBrowser applicantId="p" documents={wallet(3)} initialSelection="doc-1" />);
    noRawKey();
  });

  it('document review panel, capture preview, correction form, purpose choice, receipt', () => {
    show(
      <DocumentReviewPanel
        applicantId="p"
        documents={wallet(3).map((d) => ({
          id: d.id,
          name: d.name,
          safetyLabel: 'Clean',
          processingLabel: 'Approved',
          previewAllowed: true,
        }))}
        previewAction={async () => undefined}
      />,
    );
    show(
      <CapturePreview
        file={new File(['x'], 'a.jpg', { type: 'image/jpeg' })}
        onUse={() => undefined}
        onRetake={() => undefined}
      />,
    );
    show(
      <ChecklistCorrectionForm
        action={async (prev) => prev}
        hidden={{ a: 'b' }}
        categories={[{ value: 'x', label: 'X' }]}
        items={[{ value: 'y', label: 'Y' }]}
      />,
    );
    show(
      <PurposeChoice
        id="p"
        purposes={[
          {
            family: 'visit',
            label: 'Visit',
            options: [
              { key: 'tourism', label: 'Tourism' },
              { key: 'other', label: 'Other' },
            ],
          },
        ]}
        value=""
        onChange={() => undefined}
      />,
    );
    show(
      <ReceiptCard
        title="Document Saved"
        what="Saved."
        at="2026-11-10T08:05:00Z"
        reference={{ code: 'C-7K2Q9M' }}
        next={{ label: 'Next', href: '/x' }}
        onDone={() => undefined}
      />,
    );
    show(<ReferenceCode code="C-7K2Q9M" />);
    noRawKey();
  });

  it('navigation, notice, time zone, photo, install card', async () => {
    show(
      <SiteNavigation>
        <a href="/x">X</a>
      </SiteNavigation>,
    );
    show(<VersionNotice copy={{ label: 'L', detail: 'D', short: 'S' } as never} />);
    show(<TimeZoneSelect name="zone" label="Zone" defaultValue="" />);
    show(<ProfilePhotoControl applicantId="a" initials="AB" photoUrl={null} avatarClassName="a" />);
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    show(
      <ProfilePhotoControl
        key="saved"
        applicantId="a"
        initials="AB"
        photoUrl="/p.jpg"
        avatarClassName="a"
      />,
    );
    show(<InstallAppCard />);
    noRawKey();
  });

  afterAll(() => {
    const live = [
      ...Object.keys(componentsCatalog.bn),
      ...Object.keys(componentsProfilePhotoCatalog.bn),
      ...Object.keys(componentsPwaCatalog.bn),
    ];
    const missing = live.filter((key) => !used.has(key));
    expect(
      missing,
      `bn keys live: ${live.length}, rendered in tests: ${live.length - missing.length}`,
    ).toEqual([]);
  });
});
