import type { MetadataRoute } from 'next';

// Install and home-screen details. Colours are Harbor brand-primary and bg-subtle; the icons come
// from the VisaStack brand pack (the maskable one keeps the mark inside the centre safe zone).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VisaStack',
    short_name: 'VisaStack',
    description: 'Your documents. Ready when you are.',
    start_url: '/',
    display: 'browser',
    background_color: '#F7F9FE',
    theme_color: '#1D4C98',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
