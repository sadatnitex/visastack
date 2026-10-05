import { withAuth } from '@workos-inc/authkit-nextjs';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PilotBanner } from '../components/pilot-banner';
import { getDeploymentMode } from '../lib/deployment-mode';
import { getLocale } from '../lib/locale';
import { setLocaleAction } from './actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'VisaStack - one profile, every visa',
  description:
    'Keep your passport, documents and visa details in one private profile and reuse them for every application. Invite-only pilot.',
};

// Match the browser chrome to the theme in both light and dark (Apple-style).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Read-only auth check so the nav reflects the real session (middleware owns
  // the refresh, so this never writes cookies during render). Defaults to
  // signed-out if the read fails, so a hiccup never breaks the whole shell.
  let signedIn = false;
  try {
    const { user } = await withAuth();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }
  const locale = await getLocale();
  const deploymentMode = getDeploymentMode();

  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <PilotBanner mode={deploymentMode} />
        <header className="nav">
          <Link className="brand" href="/">
            VisaStack
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/#capabilities">Features</Link>
            <Link href="/trust">Public trust</Link>
            <Link href="/status">Status</Link>
            <form action={setLocaleAction} aria-label="Language">
              <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
              <button type="submit" className="lang-switch">
                {locale === 'en' ? 'বাংলা' : 'English'}
              </button>
            </form>
            <a className="btn btn-secondary nav-cta" href="/app">
              {signedIn ? 'Workspace' : 'Sign in'}
            </a>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>© {new Date().getFullYear()} VisaStack. Proprietary and confidential.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
