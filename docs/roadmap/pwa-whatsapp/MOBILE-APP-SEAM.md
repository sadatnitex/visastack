# Future mobile app seam (architectural note)

Decision now: no native app, no Capacitor, Trusted Web Activity or native dependency. The PWA covers installation, a standalone window, the phone's camera and file picker, and deep links today.

What keeps a later Android or iOS app cheap:

1. Stable HTTPS routes. `apps/web/src/lib/deep-links.ts` lists the entry points, and a guard test fails if one moves. A native app claims these same paths (Android App Links, Apple Universal Links), so WhatsApp messages, emails and notifications sent today keep working when an app exists.
2. One identity. The installed app uses the same Neon Auth session through the same-origin `/api/auth` proxy. A wrapper keeps that; a fully native app would add a token flow against the same accounts, never a second account system.
3. Channel-independent services. Business rules live in `packages/services`. The web app, the PWA, the WhatsApp channel and a future native shell are all callers.
4. Stable installed identity. The manifest `id` (`/`) and `scope` (`/`) must not change, or installed copies would be treated as a different app.

Options, each needing its own owner decision:

| Option | What it adds | Cost |
| --- | --- | --- |
| Android Trusted Web Activity | Play Store listing around the same PWA; full-screen Chrome; App Links | Digital Asset Links file at `/.well-known/assetlinks.json`, signing key custody, store account |
| Capacitor or equivalent shell | Both stores; native push, biometrics, secure storage, native camera | A native build pipeline, store reviews, plugin upkeep |
| Apple Universal Links | iOS opens VisaStack links in the app | `/.well-known/apple-app-site-association`, Apple developer account |
| Native notifications | Reliable push on iOS without installation steps | Push keys, a consent purpose, overlap with WhatsApp and email notices to be settled |
| Biometric unlock | Faster return to the app | Must sit in front of, never replace, the server session and step-up checks |

Rules that carry over unchanged: no sensitive data cached on the device (the service-worker cache law in `apps/web/src/lib/pwa/service-worker.ts` becomes the native app's storage rule too), no raw personal values or bearer credentials in links, and high-risk actions still finish behind the server's own checks.
