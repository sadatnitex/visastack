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
import { setInstallPrompt } from '../lib/pwa/install-prompt';
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
import { PwaRuntime } from './pwa/pwa-runtime';
import { ReceiptCard } from './receipt-card';
import { ReferenceCode } from './reference-code';
import { SiteNavigation } from './site-navigation';
import { TimeZoneSelect } from './time-zone-select';
import { ToastHost, resetToastForTest, showToast } from './toast';
import { VersionNotice } from './version-notice';
import { VisaPhotoSizes } from './visa-photo-sizes';

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
    click(
      byText('button', componentsCatalog.bn['components.documentWalletBrowser.next'] ?? 'Next'),
    );
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

  it('the wallet count line is one plural message: English unchanged under en', () => {
    const many = wallet(4).map((d) => ({ ...d, kind: null, category: null, docType: null }));
    const one = wallet(2).map((d, i) => ({ ...d, kind: i === 0 ? null : 'Bank Statement' }));
    const html = (docs: WalletBrowserDocument[]) => {
      act(() =>
        root.render(
          <I18nProvider locale="en" pageLang="en">
            <DocumentWalletBrowser applicantId="p" documents={docs} />
          </I18nProvider>,
        ),
      );
      return host.textContent ?? '';
    };
    expect(html(many)).toContain('4 Need a Kind');
    expect(html(one)).toContain('1 Needs a Kind');
  });

  it('the secure preview note shows for a file whose preview is allowed (desktop, nothing stubbed)', () => {
    show(<DocumentWalletBrowser applicantId="p" documents={wallet(3)} initialSelection="doc-1" />);
    expect(host.textContent).toContain(
      componentsCatalog.bn['components.documentWalletBrowser.openTheSecurePreviewBelowPermission'],
    );
    noRawKey();
  });

  it('visa photo checks: the guide-only note is Bengali', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sourceWidth: 1200,
              sourceHeight: 1500,
              findings: [],
              preview: { width: 384, height: 480, jpegBase64: 'AQID' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    show(
      <VisaPhotoSizes
        documentId="00000000-0000-4000-8000-000000000001"
        returnTo="/app/applicant/a/documents"
      />,
    );
    const details = host.querySelector('details');
    if (!details) throw new Error('missing disclosure');
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain(
      componentsCatalog.bn['components.visaPhotoSizes.theseChecksAreAGuideOnly'],
    );
    noRawKey();
  });

  it('the offline notice is Bengali', async () => {
    show(<PwaRuntime enabled={false} />);
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(host.querySelector('output')?.textContent).toContain(
      componentsPwaCatalog.bn['componentsPwa.pwaPwaRuntime.youAreOfflineReconnectToContinue'],
    );
    await act(async () => window.dispatchEvent(new Event('online')));
  });

  // Refill 6: the states the refills deferred until a test drew them.
  const bnOf = (key: string) =>
    (componentsCatalog.bn as Record<string, string>)[key] ??
    (componentsPwaCatalog.bn as Record<string, string>)[key] ??
    (componentsProfilePhotoCatalog.bn as Record<string, string>)[key] ??
    '';
  const typeInto = (input: Element | null, value: string) => {
    if (!input) throw new Error('Missing input');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  /** Each key's Bengali is on screen (words or an attribute such as a spoken name). */
  const expectShown = (...keys: string[]) => {
    const seen = [
      host.textContent ?? '',
      ...[...host.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value)),
    ].join('\n');
    for (const key of keys) {
      expect(bnOf(key), key).not.toBe('');
      expect(seen, key).toContain(bnOf(key));
    }
    noRawKey();
  };
  /** Some element's own text is exactly this key's Bengali (not a longer line that contains it). */
  const expectExact = (key: string) =>
    expect(
      [...host.querySelectorAll('*')].some((el) => el.textContent === bnOf(key)),
      key,
    ).toBe(true);

  it('activity log: a search that matches nothing, with the way to clear it', () => {
    show(<ActivityLog entries={logEntries} label="Access Log Entries" />);
    typeInto(host.querySelector('input[type="search"]'), 'nothing like this');
    expectShown(
      'components.activityLog.nothingMatchesTheseFilters',
      'components.activityLog.clearFilters',
    );
  });

  it('country browser: a search that matches no country', () => {
    show(
      <CountryBrowser
        items={countries}
        filters={[{ status: 'VISA_REQUIRED', label: 'Visa Needed', statusLabel: 'Visa Needed' }]}
      />,
    );
    typeInto(host.querySelector('input'), 'Atlantis');
    expectShown(
      'components.countryBrowser.noCountriesMatch',
      'components.countryBrowser.clearTheSearchOrChooseAnother',
    );
    expectExact('components.countryBrowser.noCountriesMatche4ae64');
    expect(host.textContent).not.toContain('No Countries Match');
  });

  it('document review panel: no documents, no match, and a file that cannot be previewed', () => {
    show(
      <DocumentReviewPanel applicantId="p" documents={[]} previewAction={async () => undefined} />,
    );
    expectShown('components.documentReviewPanel.uploadADocumentToReviewIts');
    const docs = wallet(2).map((d) => ({
      id: d.id,
      name: d.name,
      safetyLabel: 'Clean',
      processingLabel: 'Approved',
      previewAllowed: false,
    }));
    show(
      <DocumentReviewPanel
        applicantId="p"
        documents={docs}
        previewAction={async () => undefined}
      />,
    );
    expectShown('components.documentReviewPanel.thisDocumentIsNotAvailableTo');
    typeInto(host.querySelector('input[type="search"]'), 'nothing like this');
    expectShown('components.documentReviewPanel.noDocumentsMatchTryAnotherName');
  });

  it('wallet browser: a search that matches nothing, and the chosen file outside it', () => {
    show(<DocumentWalletBrowser applicantId="p" documents={wallet(4)} initialSelection="doc-1" />);
    typeInto(host.querySelector('input[type="search"]'), 'nothing like this');
    expectShown(
      'components.documentWalletBrowser.noDocumentsMatch',
      'components.documentWalletBrowser.yourSelectedDocumentIsOutsideThe',
    );
    // It names a filter the screen calls by another word, so it stays English for now.
    expect(host.textContent).toContain('Clear the search or choose another category or status.');
  });

  it('wallet browser: the unsorted toggle stays in one language both ways', () => {
    show(<DocumentWalletBrowser applicantId="p" documents={wallet(4)} />);
    const toggle = () => host.querySelector('.u-btn-xs');
    const before = toggle()?.textContent;
    click(toggle());
    expect(toggle()?.textContent).toBe('Show All');
    expect(before).not.toMatch(/[\u0980-\u09FF]/);
  });

  it('purpose choice: back to the common purposes from the full list', () => {
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
    click(byText('button', bnOf('components.purposeChoice.morePurposes')));
    expectShown('components.purposeChoice.showCommonPurposes');
  });

  it('toast: the close button is named in Bengali', () => {
    resetToastForTest();
    show(<ToastHost />);
    act(() => showToast('Saved.'));
    expect(host.querySelector('.toast-close')?.getAttribute('aria-label')).toBe(
      bnOf('components.toast.dismiss'),
    );
    expectShown('components.toast.dismiss');
    act(() => resetToastForTest());
  });

  it('install card: the install offer, and the lines after a no and after installing', async () => {
    try {
      await installCard();
    } finally {
      setInstallPrompt(null);
    }
  });
  async function installCard() {
    const prompt = vi.fn(async () => undefined);
    setInstallPrompt(
      Object.assign(new Event('beforeinstallprompt'), {
        prompt,
        userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
      }) as never,
    );
    show(<InstallAppCard />);
    expectShown('componentsPwa.pwaInstallAppCard.installVisastack');
    await act(async () => {
      byText('button', bnOf('componentsPwa.pwaInstallAppCard.installVisastack'))?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expectShown('componentsPwa.pwaInstallAppCard.youCanInstallItAnyTime');
    setInstallPrompt(
      Object.assign(new Event('beforeinstallprompt'), {
        prompt,
        userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      }) as never,
    );
    show(<InstallAppCard key="again" />);
    await act(async () => {
      byText('button', bnOf('componentsPwa.pwaInstallAppCard.installVisastack'))?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expectShown('componentsPwa.pwaInstallAppCard.visastackIsInstalledOnThisDevice');
  }

  it('app update: the notice, Later, and Reload Now while it reloads', async () => {
    const waiting = { postMessage: vi.fn(), addEventListener: vi.fn() };
    const registration = Object.assign(new EventTarget(), {
      waiting,
      installing: null,
      update: vi.fn(async () => undefined),
      unregister: vi.fn(async () => true),
    });
    const container = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn(async () => registration),
      getRegistrations: vi.fn(async () => [registration]),
    });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    try {
      await appUpdate();
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });
  async function appUpdate() {
    show(<PwaRuntime enabled />);
    await act(async () => undefined);
    expectShown(
      'componentsPwa.pwaPwaRuntime.appUpdate',
      'componentsPwa.pwaPwaRuntime.aNewVersionOfVisastackIs',
      'componentsPwa.pwaPwaRuntime.reloadNow',
      'componentsPwa.pwaPwaRuntime.later',
    );
    const reload = byText('button', bnOf('componentsPwa.pwaPwaRuntime.reloadNow')) as
      | HTMLButtonElement
      | undefined;
    await act(async () => reload?.click());
    expectShown('componentsPwa.pwaPwaRuntime.reloading');
  }

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
