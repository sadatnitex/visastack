# Phone and Desktop Alerts (Web Push)

Owner decision D7 (17 Nov 2026): Web Push behind an off switch. Work package WP-PIC18, migration 0136.

## What a person sees

On Account, a card "Phone and Desktop Alerts" with one line of explanation and a "Turn On Notifications" button. The browser asks for permission only after that button is pressed, never when a page loads. Once on, the button reads "Turn Off".

When one of the notices that already appear in VisaStack's notices list is sent to that person, each browser they turned alerts on for shows:

- title "VisaStack"
- line "Something in VisaStack needs you"
- a click opens the page the notice is about (a VisaStack page only; anything else opens the notices page)

No name, document, country or case detail is ever in an alert. The details appear on the page after sign-in. No new kind of notice was added: alerts follow the in-app notices only, not emails.

The card is hidden in browsers that cannot show alerts. On iPhone and iPad, alerts work only from VisaStack added to the Home Screen (iOS 16.4 or later).

## When a browser is forgotten

- the person presses Turn Off on it;
- the person signs out on it (the server forgets the browsers that sign-in turned on, and the browser unsubscribes itself);
- the account is deleted (the rows go with the account);
- the push service says the browser is gone (404 or 410), or three sends in a row fail;
- the same browser is turned on by another account (one browser, one account);
- more than five browsers on one account (the oldest is forgotten).

## How it is kept safe

- The push address and the browser's keys are sealed with the same field protection as other sensitive values, tied to the account and the row. Only a hash of the address is stored in the clear.
- The server sends only to the real push services (Google, Mozilla, Apple, Microsoft) over https; any other address is refused, so the server can never be made to call an address of someone else's choosing. Redirects are not followed, each send is limited to five seconds.
- Messages are encrypted for the browser (RFC 8291) and signed with the VisaStack server key (VAPID, RFC 8292), built from Node's own crypto with no extra package.
- The private key is read only from the environment and never logged or shown.
- Audit records "alerts turned on" and "alerts turned off" with a device count only.

## Switching it on (owner actions)

1. Make a key pair once, on any computer with Node 22:

   ```
   node -e "const e=require('crypto').createECDH('prime256v1');e.generateKeys();console.log('WEB_PUSH_VAPID_PUBLIC_KEY='+e.getPublicKey('base64url'));console.log('WEB_PUSH_VAPID_PRIVATE_KEY='+Buffer.from(e.getPrivateKey('hex').padStart(64,'0'),'hex').toString('base64url'))"
   ```

   Keep the private key secret. It never goes in chat, a ticket or the repository.
2. In Vercel, Production environment, add:
   - `WEB_PUSH_VAPID_PUBLIC_KEY` (from step 1)
   - `WEB_PUSH_VAPID_PRIVATE_KEY` (from step 1, marked Sensitive)
   - `WEB_PUSH_SUBJECT` = `mailto:` followed by an address the push services may write to about problems, or an https address of the site
   - `WEB_PUSH` = `true`
3. Say "migrate 0136" so the subscriptions table is added.
4. Redeploy production.

Field protection (`KMS_PROVIDER` or `KMS_LOCAL_MASTER_KEY_BASE64`) must already be configured; it is in production.

Changing the key pair later makes every existing browser subscription stop working; people turn alerts on again.

## Switching it off

Set `WEB_PUSH` to anything but `true` (or remove it) and redeploy. The card disappears, the actions refuse, the worker sends no alerts and the service worker no longer carries the alert handlers. The table can stay; it is additive.

## Known limits

- Only the known push services are accepted (Google `fcm.googleapis.com` and `android.googleapis.com`, Mozilla, Apple `*.push.apple.com`, Microsoft `*.notify.windows.com`). A browser using any other push service sees "That did not work" on Turn On.
- A sign-in that ends by expiring (not by signing out) keeps its browsers until the push service reports them gone or the person turns alerts off.

## Code

- Encryption and sending: `packages/adapters/src/web-push.ts`
- Storage, owner-only access, message: `packages/services/src/web-push.ts` (import `@visastack/services/web-push`)
- Hook after an in-app notice is sent: `dispatchOne` in `packages/services/src/notifications.ts`
- Switch and keys: `apps/web/src/lib/web-push.ts`
- Account card and actions: `apps/web/src/app/app/account/push-card.tsx`, `push-actions.ts`
- Service worker handlers: `apps/web/src/lib/pwa/push-worker.ts`, added to the worker by `buildServiceWorkerScript` in `service-worker.ts` only while `WEB_PUSH` is `true`
- Sign-out: `apps/web/src/lib/sign-out.ts`
