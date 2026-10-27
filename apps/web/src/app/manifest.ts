import type { MetadataRoute } from 'next';
import { deepLinkPath } from '../lib/deep-links';

// Install and home-screen details. The icons come from the VisaStack brand pack (the maskable one
// keeps the mark inside the centre safe zone). Colours are Harbor brand-primary (theme, the
// installed app's title bar before a page loads) and the light page ground (background, the
// splash screen); each page then sets its own light theme colour in the root layout.
//
// `id` and `scope` are the installed app's identity: changing either makes devices treat it as a
// different app, so keep them stable. The start page and shortcuts use the same HTTPS routes as the
// website (`lib/deep-links.ts`), which a later Android or iOS app can claim without new links.
export default function manifest(): MetadataRoute.Manifest {
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
  };
}
