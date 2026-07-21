import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'VisaStack — one profile, every visa',
  description:
    'A universal, pack-composable visa and immigration platform. Turn documents into structured, permission-aware profiles through a governed, AI-assisted (or fully manual) workflow.',
};

// Match the browser chrome to the theme in both light and dark (Apple-style).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="nav">
          <Link className="brand" href="/">
            VisaStack
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/#capabilities">Platform</Link>
            <Link href="/status">Status</Link>
            <a href="https://github.com/sadatnitex/visastack" rel="noreferrer noopener">
              Source
            </a>
            <Link href="/app">Sign in</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>© {new Date().getFullYear()} VisaStack. Proprietary and confidential.</span>
            <span>Built remote-first on Vercel + Neon.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
