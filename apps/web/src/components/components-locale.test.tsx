import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { componentsCatalog } from '../i18n/components';
import { componentsProfilePhotoCatalog } from '../i18n/components-profile-photo';
import { componentsPwaCatalog } from '../i18n/components-pwa';
import { componentsShareCatalog } from '../i18n/components-share';
import { componentsUiLiftCatalog } from '../i18n/components-ui-lift';
import { I18nProvider } from './i18n-provider';
import { ProfilePhotoControl } from './profile-photo/profile-photo-control';
import { InstallAppCard } from './pwa/install-app-card';
import { ReferenceCode } from './reference-code';
import { CopyMessageOnly } from './share/whatsapp-share';
import { ProgressMeter } from './ui-lift';

const BENGALI = /[ঀ-৿]/;

function render(locale: 'en' | 'bn', node: ReactElement): Document {
  const html = renderToStaticMarkup(
    <I18nProvider locale={locale} pageLang="en">
      {node}
    </I18nProvider>,
  );
  return new JSDOM(`<body>${html}</body>`).window.document;
}

describe('shared client components under Bengali', () => {
  it('ReferenceCode: the Copy button shows its Bengali draft and is marked bn', () => {
    const bn = render('bn', <ReferenceCode code="C-7K2Q9M" />);
    const button = bn.querySelector('button');
    expect(button?.textContent).toBe(componentsCatalog.bn['components.referenceCode.copy']);
    expect(button?.querySelector('[lang="bn"]')).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toContain('C-7K2Q9M');
    // Nothing renders for a missing code, in either language.
    expect(render('bn', <ReferenceCode code={null} />).body.textContent).toBe('');
  });

  it('ReferenceCode: English is byte-identical and carries no lang marks', () => {
    const en = render('en', <ReferenceCode code="C-7K2Q9M" />);
    expect(en.querySelector('button')?.innerHTML).toBe('Copy');
    expect(en.querySelector('[lang]')).toBeNull();
  });

  it('ProfilePhotoControl idle state: Bengali where a draft exists, and no raw key anywhere', () => {
    const doc = render(
      'bn',
      <ProfilePhotoControl
        applicantId="a"
        initials="AB"
        photoUrl={null}
        avatarClassName="avatar"
      />,
    );
    expect(doc.body.textContent).toContain(
      componentsProfilePhotoCatalog.bn[
        'componentsProfilePhoto.profilePhotoProfilePhotoControl.addPhoto'
      ],
    );
    expect(doc.body.textContent).not.toMatch(/componentsProfilePhoto\./);
  });

  it('ProfilePhotoControl with a saved photo shows the Remove draft', () => {
    const doc = render(
      'bn',
      <ProfilePhotoControl
        applicantId="a"
        initials="AB"
        photoUrl="/photo.jpg"
        avatarClassName="avatar"
      />,
    );
    expect(doc.body.textContent).toContain(
      componentsProfilePhotoCatalog.bn[
        'componentsProfilePhoto.profilePhotoProfilePhotoControl.removePhoto'
      ],
    );
  });

  it('InstallAppCard (not installed): the Bengali draft shows, the held lines stay English', () => {
    const doc = render('bn', <InstallAppCard />);
    const key = 'componentsPwa.pwaInstallAppCard.addVisastackToYourHomeScreen';
    expect(doc.body.textContent).toContain(componentsPwaCatalog.bn[key]);
    expect(doc.body.textContent).toMatch(BENGALI);
    expect(doc.body.textContent).toContain(
      componentsPwaCatalog.en[
        'componentsPwa.pwaInstallAppCard.installingDoesNotDownloadYourRecords'
      ],
    );
  });

  it('CopyMessageOnly keeps English where the share catalogue has no Bengali', () => {
    expect(Object.keys(componentsShareCatalog.bn)).toEqual([]);
    const doc = render('bn', <CopyMessageOnly text="Hello" />);
    expect(doc.body.textContent).not.toMatch(/componentsShare\./);
    expect(doc.body.textContent).toContain('Copy');
  });

  it('ProgressMeter: raw numbers reach the message, and the name keeps Latin digits on its English fallback', () => {
    expect(Object.keys(componentsUiLiftCatalog.bn)).toEqual([]);
    // The component hands raw numbers to the message and builds no English text of its own: the
    // runtime formats the numbers in the language the message resolves to.
    const source = readFileSync(join(__dirname, 'progress-meter-parts.tsx'), 'utf8');
    expect(source).toContain(
      "t('componentsUiLift.progressMeter.meterName', { value, max, label })",
    );
    expect(source).not.toMatch(/`\$\{value\} of \$\{max\}/);
    for (const locale of ['en', 'bn'] as const) {
      const doc = render(
        locale,
        <ProgressMeter value={6} max={12} label="required items on file" />,
      );
      expect(doc.querySelector('svg')?.getAttribute('aria-label')).toBe(
        '6 of 12 required items on file',
      );
      expect(doc.querySelector('.lift-meter-text')?.textContent).toBe('6 of 12');
    }
    // A passed valueText replaces the default words.
    const own = render(
      'bn',
      <ProgressMeter value={1} max={4} label="steps" valueText="One so far" />,
    );
    expect(own.querySelector('.lift-meter-text')?.textContent).toBe('One so far');
  });
});
