import type { MetadataRoute } from 'next';
import { deepLinkPath } from '../lib/deep-links';
import { isServiceWorkerEnabled } from '../lib/pwa/service-worker';
import { isShareTargetSwitchOn, shareTargetEntry } from '../lib/pwa/share-target';

// Read per request so the owner's share switch (`WEB_SHARE_TARGET`) takes effect without a rebuild,
// the same way `/sw.js` reads `PWA_SERVICE_WORKER`.
export const dynamic = 'force-dynamic';

// Install and home-screen details. The icons come from the VisaStack brand pack (the maskable one
// keeps the mark inside the centre safe zone). Every icon is a full-bleed, opaque blue square:
// a launcher that does not use the maskable pair draws a transparent corner on a white disc, which
// is what made the home-screen icon look like a tile on a white circle. Colours are Harbor brand-primary (theme, the
// installed app's title bar before a page loads) and the light page ground (background, the
// splash screen); each page then sets its own light theme colour in the root layout.
//
// `id` and `scope` are the installed app's identity: changing either makes devices treat it as a
// different app, so keep them stable. The start page and shortcuts use the same HTTPS routes as the
// website (`lib/deep-links.ts`), which a later Android or iOS app can claim without new links.
//
// `share_target` (WP-PIC11) appears only when the owner has set `WEB_SHARE_TARGET=on` AND the service
// worker is on: the worker is what keeps a shared file on the device until the person signs in and
// confirms (`lib/pwa/share-target.ts`). Without it the phone never offers VisaStack as a share target.
export default function manifest(): MetadataRoute.Manifest {
  const read = (name: string) => process.env[name];
  const share = isServiceWorkerEnabled(read) && isShareTargetSwitchOn(read);
  return {
    id: '/',
    name: 'VisaStack',
    short_name: 'VisaStack',
    description: 'A clean file you can stand behind.',
    lang: 'en',
    dir: 'ltr',
    start_url: deepLinkPath({ kind: 'workspace' }),
    scope: '/',
    display: 'standalone',
    background_color: '#F7F9FE',
    theme_color: '#1D4C98',
    categories: ['productivity', 'travel'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Your Workspace',
        short_name: 'Workspace',
        url: deepLinkPath({ kind: 'workspace' }),
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Notifications',
        short_name: 'Notifications',
        url: deepLinkPath({ kind: 'notifications' }),
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    ...(share ? { share_target: shareTargetEntry() } : {}),
  };
}
