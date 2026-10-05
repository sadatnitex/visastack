import { beforeEach, describe, expect, it, vi } from 'vitest';
import { latinWords, localeState, renderServer, textOf } from '../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ withAuth: vi.fn(), getDeploymentMode: vi.fn() }));

vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth: mocks.withAuth }));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: mocks.getDeploymentMode }));
vi.mock('./actions', () => ({ setLocaleAction: vi.fn() }));
vi.mock('./globals.css', () => ({}));

const { default: RootLayout, generateMetadata } = await import('./layout');

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.withAuth.mockResolvedValue({ user: null });
  mocks.getDeploymentMode.mockReturnValue('controlled_pilot');
});

const render = async () => renderServer(await RootLayout({ children: <p id="page">পাতা</p> }));

const bengaliYear = new Intl.NumberFormat('bn-BD', { useGrouping: false }).format(
  new Date().getFullYear(),
);

describe('the site frame in English', () => {
  it('reads exactly as it did', async () => {
    const html = await render();
    expect(html).toContain('<html lang="en">');
    const text = textOf(html);
    expect(text).toContain('Skip to content');
    expect(text).toContain('VisaStack Controlled Pilot');
    expect(text).toContain(
      'Internal controlled pilot. Use synthetic or irreversibly redacted information only.',
    );
    expect(text).toContain("What's live");
    expect(text).toContain('Platform');
    expect(text).toContain('Public trust');
    expect(text).toContain('Status');
    expect(text).toContain('Sign in');
    expect(text).toContain(
      `© ${new Date().getFullYear()} VisaStack. Proprietary and confidential.`,
    );
    expect(html).toContain('aria-label="Primary"');
  });

  it('offers Bangla, named in Bangla and marked as Bangla for a screen reader', async () => {
    const html = await render();
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('<button type="submit" class="lang-switch" lang="bn">বাংলা</button>');
    expect(html).toContain('name="locale" value="bn"');
  });

  it('shows Workspace instead of Sign in once signed in', async () => {
    mocks.withAuth.mockResolvedValue({ user: { id: 'u1' } });
    const text = textOf(await render());
    expect(text).toContain('Workspace');
    expect(text).not.toContain('Sign in');
  });
});

describe('the site frame in Bangla', () => {
  beforeEach(() => {
    localeState.value = 'bn';
  });

  it('sets the page language so a screen reader and the Bangla typography rules apply', async () => {
    expect(await render()).toContain('<html lang="bn">');
  });

  it('is in Bangla from the skip link to the footer, with no English interface words left', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('মূল বিষয়বস্তুতে যান');
    expect(text).toContain('VisaStack নিয়ন্ত্রিত পাইলট');
    expect(text).toContain('কী চালু আছে');
    expect(text).toContain('প্ল্যাটফর্ম');
    expect(text).toContain('সাইন ইন');
    expect(text).toContain(`© ${bengaliYear} VisaStack। মালিকানাধীন ও গোপনীয়।`);
    expect(html).toContain('aria-label="ভাষা"');
    expect(html).toContain('aria-label="প্রধান"');
    // Left in Latin script: the brand, the hosting names, and the language's own name.
    expect([...new Set(latinWords(text))].sort()).toEqual([
      'English',
      'Neon',
      'Vercel',
      'VisaStack',
    ]);
  });

  it('offers English, named in English and marked as English', async () => {
    const html = await render();
    expect(html).toContain('<button type="submit" class="lang-switch" lang="en">English</button>');
    expect(html).toContain('name="locale" value="en"');
  });

  it('wraps the page so browser components know the language', async () => {
    expect(await render()).toContain('<p id="page">পাতা</p>');
  });
});

describe('the page title', () => {
  it('is in English by default', async () => {
    expect((await generateMetadata()).title).toBe('VisaStack - one profile, every visa');
  });

  it('is in Bangla for a Bangla reader, so the tab and the screen reader announce it in their language', async () => {
    localeState.value = 'bn';
    expect((await generateMetadata()).title).toBe('VisaStack - একটি প্রোফাইল, সব ভিসা');
    localeState.value = 'en';
  });

  it('keeps the site description in English until its content review is done', async () => {
    localeState.value = 'bn';
    expect((await generateMetadata()).description).toContain('pack-composable');
    localeState.value = 'en';
  });
});
