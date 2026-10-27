# Lane D contract: PWA and mobile continuity, WhatsApp channel

Status: Stage D1 complete on branch `ccr-df45ada2-3dcwmd`. Stage D2 (WhatsApp implementation) is blocked on S5/S6 and S8/S9 reaching `main`.

Prepared in parallel with Lanes A (S5/S6), B (S8/S9) and C (S10). Must be updated against post-S5/S6/S8/S9/S10 main before merge. This file is Lane D's interim record. Shared programme records (STATUS.md, the Small Commercial V1 handoff, ledgers, known-issues) are left for the lead session to reconcile after the lanes converge.

Governing rules: work around the active lanes, never through them. No second VisaStack beside VisaStack: the PWA is the same app, and WhatsApp is a channel adapter onto existing services.

## 1. Base and collision map

- Base: `main` at `65fdc9890bcd37049c143209657149698c4dcc86` (S26 merged as #286; migration 0093 applied).
- Worktrees: only this session's checkout exists in this container. Lanes A, B and C run in other containers. At the time of the check (27 Oct 2026, morning, Dhaka time) none of them had pushed work: `origin/ccr-97cb7cfc-xo98x2` differs from main by zero files and there were no open pull requests from them. Their footprint therefore comes from their package contracts (handoff sections F, G, H) and the WP-V5 allowlist.

| File or area | Owner | Lane D action |
| --- | --- | --- |
| `packages/services/src/{intake,ai,ocr,mrz,jobs}.ts`, `access/principal.ts` | Lane A (S5) | Not touched. WhatsApp needs new `SystemJob` names here later. |
| `apps/web/src/app/api/jobs/**`, `apps/web/src/lib/jobs.ts`, `apps/web/vercel.json` | Lane A (S5) | Not touched. WhatsApp job routes and crons come after convergence. |
| `apps/web/src/app/app/applicant/[id]/documents/page.tsx`, `ai-review.tsx`, `packages/i18n/src/messages.ts` | Lane A (S6) | Not touched. Any PWA polish of reading screens waits. |
| `packages/services/src/selected-output.ts`, `export-csv.ts`, `packages/services/src/index.ts` | Lane B (S8) | Not touched. |
| `apps/web/src/app/app/applicant/[id]/outputs/**`, `selected-scope-summary.tsx`, `first-run.tsx` | Lane B (S9) | Not touched. |
| `apps/web/src/app/globals.css` | Lane B (WP-V5 allowlist) | Not touched. PWA styles live in a CSS module. |
| The WhatsApp prepared message (generic text plus a secure link, sent by the person) | Lane B (S9) | Not built here. D2 reuses S9's message builder. |
| Invoice and payment services, the next migration number | Lane C (S10) | Not touched. No Lane D migration exists. |
| `docs/upgrades/programme/**`, `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md`, `docs/commercial-v1/known-issues.md`, ledgers | Shared | Not touched. |

Files Lane D changed (none overlaps the rows above):

- New: `apps/web/src/app/sw.js/route.ts`, `apps/web/src/lib/pwa/{service-worker,runtime,install-prompt,build-version}.ts` with tests, `apps/web/src/components/pwa/{pwa-runtime,install-app-card}.tsx`, `pwa-runtime.module.css` and test, `apps/web/src/lib/deep-links.ts` with test, `apps/web/e2e/pwa.spec.ts`, `docs/roadmap/pwa-whatsapp/**`.
- Edited: `apps/web/src/app/manifest.ts`, `apps/web/src/app/layout.tsx` (metadata and one component), `apps/web/src/app/app/help/page.tsx` (one card), `apps/web/src/lib/csp.ts` and `csp.test.ts` (`worker-src`, `manifest-src`), `apps/web/next.config.mjs` (`env` build version), `.github/workflows/pr-browser-checks.yml` and `playwright-smoke.yml` (add `pwa.spec.ts`).

## 2. PWA: what was built

Target: VisaStack Web and VisaStack PWA are one application. Same routes, same Neon Auth session (sign-in goes through the same-origin `/api/auth` proxy, so it works in standalone mode), no offline database, no new domain.

| Capability | Implementation |
| --- | --- |
| Installable manifest | `manifest.ts`: `id: '/'`, `scope: '/'`, `start_url: '/app'`, `display: 'standalone'`, 192 and 512 icons (`any`) plus the maskable 512, two shortcuts (Workspace, Notifications), `prefer_related_applications: false`. `id` and `scope` are the installed identity and must not change. |
| iOS home screen | `metadata.appleWebApp` (capable, title, default status bar), the existing `apple-icon.png`, and `formatDetection` off so phones never turn passport, reference or account numbers into call or map links. |
| Service worker | `/sw.js`, generated per build by a route. Hand-written, no dependency, so the whole cache policy is about 150 lines anyone can audit. |
| Cache law | Only `/_next/static/**` (content-hashed build output), `/icons/**`, `/favicon.ico`, `/icon.svg`, `/apple-icon.png` may be stored, and only when the answer is same-origin, 200-class, and not marked `no-store` or `private`. At most 200 entries. Pages (`mode: navigate`) are always fetched from the network and never stored. Everything else is not intercepted at all: API calls, page data (`RSC` header, `_rsc`), `/api/blob` signed links, profile photos, `/_next/image`, downloads, posts and server actions, other origins, range requests. |
| Offline screen | Built into the worker, so showing it never needs a stored page. It says the person is offline, that their records are not stored on this device, that anything typed or uploaded may not have been sent, and offers Try Again. It reloads by itself when the connection returns. Served with its own strict policy (`default-src 'none'`, hash-pinned inline style and script, `no-store`). |
| Network notices | Every page carries one polite live region (`<output>`): "You are offline. Reconnect to continue securely. Anything not yet sent has not been saved." and "You are back online." Nothing claims a save the server did not confirm. |
| Update safety | Each build bakes a version (`VERCEL_DEPLOYMENT_ID`, else the commit, else build time) into the worker, so every deployment ships a different worker. A new worker installs, then waits. The person sees "A new version of VisaStack is ready. Finish anything you are typing or uploading, then reload." with Reload Now and Later. It never reloads on its own. Open pages check for updates when shown again and every 30 minutes. Activation removes older builds' caches only. |
| Kill switch | `PWA_SERVICE_WORKER=off`: pages stop registering and remove existing workers, and `/sw.js` serves a retirement worker that deletes VisaStack caches and unregisters itself. Switching off is a clean exit, never a stranded worker. Default is on. No rebuild is needed. |
| Install experience | The browser's install offer is kept (not shown as a bar mid-task) and offered on the Help page card "Use VisaStack on Your Phone", with written steps for iPhone, iPad and Android, and the line "Installing does not download your records." |
| Security policy | `worker-src 'self'` and `manifest-src 'self'` added. Needed because a browser honouring `'strict-dynamic'` ignores `'self'` in `script-src` and would refuse the worker. |
| Deep links | `lib/deep-links.ts`: typed stable routes (workspace, notifications, case, traveller, documents, requested evidence, profile review, expiry, sharing review, shared with me). Ids must be UUIDs. A guard test fails if a route's page file moves. Single-use tokens stay with their existing services and accept pages: this module cannot mint a bearer link. |
| Camera and files | Upload inputs are standard file inputs (`accept` lists images and PDFs), which open the phone's own picker with camera, photos and files. `Permissions-Policy: camera=()` does not affect that picker; it only blocks a live in-page camera, which VisaStack does not use. |

Evidence (local, production build, controlled_pilot, placeholder Neon Auth):

- Unit and component: 66 new tests (worker executed in a Node sandbox: every private route, API call, signed link and page-data request is shown not to be stored; cache cap, opaque and `no-store` answers refused; offline response and its policy; lifecycle and update; kill switch; runtime registration and prompted update; install card; deep links). The full web suite passed: 216 files, 2,208 tests.
- Guard proven to fail: with the worker temporarily changed to store pages and to intercept API and page-data requests, 8 tests went red; restored, 40/40 passed.
- Browser (`e2e/pwa.spec.ts`, Chromium): manifest and icon sizes, home-screen meta, worker served fresh, registration under the live policy with no violation, cache inspected after visiting public, sign-in and protected pages plus API and page-data fetches holds only allowed files, pages still come from the network (fresh policy nonce per load), offline screen with axe clean and no sideways scroll at 320px, Try Again, automatic recovery, connection notices, deep links returning to the same place after sign-in. All 11 passed. With the three required specs alongside it, 213 of 213 browser checks passed, and the smoke check passed 11/11. Lint, typecheck, build and `pnpm audit --prod --audit-level high` passed.
- Reviews: `/code-review` (high) raised 10 points (multi-tab update, live region hidden from screen readers, switch-off leaving caches, navigation preload sending a second request for single-use links, caching delaying responses, the offline icon being trimmed, the install offer caught too late, an unhandled install error, a duplicated allowlist, two on/off rules); all were fixed with tests. `/security-review` found nothing at confidence 8 or above.

## 3. PWA: deferred or not verifiable here

| Item | Why | When |
| --- | --- | --- |
| `viewport-fit=cover` and safe-area padding on the site header and footer | Needs `globals.css` (Lane B) | After S9 merges |
| PWA-specific polish of reading screens | Owned by S6 | After S6 merges, only if a real-device check shows a need |
| Payment deep link | No payment route exists yet (S11, S12) | Add a `payment` kind to `lib/deep-links.ts` when the route lands |
| Web push notifications | Needs keys, a consent purpose, and iOS 16.4+ installed apps only; overlaps the WhatsApp notification channel | Separate owner decision |
| Real-device acceptance | No iPhone or Android device here | Owner or tester checklist in section 13 |
| Manifest theme colour | Kept brand blue `#1D4C98` (an existing brand test pins it); pages use the light `#f7f9fe`, so Android's title bar may flash blue then light on launch | Owner question in section 14 |
| Email links open the default browser, not the installed app | iOS keeps an installed app's storage separate from Safari | Documented; the person signs in once inside the app |

## 4. WhatsApp: official policy findings

Full evidence: `WHATSAPP-POLICY-RESEARCH.md` (topics 1 to 21, each with official URL, date reviewed 27 Oct 2026, facts and architectural consequence).

Verification status: this environment's network policy refused `developers.facebook.com` and page fetches, so each fact comes from a search-index excerpt of the named official Meta page, not from a full page read. Every item marked `[SX]` must be confirmed on the live page before D2 code relies on it, and the official example payloads must be copied by hand into test fixtures. This is why no WhatsApp code was written in D1 (section 31 of the owner instruction allows early code only on verified documentation).

Findings that shape the design:

| Topic | Finding | Consequence |
| --- | --- | --- |
| Sensitive data | Business Policy: do not ask people to share full payment card numbers, financial account numbers, personal ID card numbers or other sensitive identifiers. Template review also rejects requesting documents that might contain sensitive identifiers. | Passports, national IDs, bank statements and account numbers are never requested in chat. They always go through secure handoff (section 9). Unsolicited documents are declined, not stored. |
| Identity | Since April 2026 every message webhook carries a business-scoped user id (`user_id`). The phone number can be absent for people who use usernames. A `user_id_update` webhook reports number or id changes. | Key identities on the business-scoped id. Phone is optional display data. Never link by matching phone numbers. |
| Automation and people | Automation is allowed inside the 24-hour service window, but there must be prompt, clear and direct escalation paths. | A visible Talk to a Person path on every conversation (section 10). |
| AI | Business Solution Terms (15 Jan 2026): AI providers may not offer general-purpose assistants as the main product; a business may use an AI provider as its service provider if that provider does not train on the chat data. | VisaStack's task-bound assistant is allowed. The bot stays on VisaStack topics, and the AI vendor's no-training term is recorded with the existing `ai-data-terms` mechanism. |
| Webhooks | Signed with HMAC-SHA256 of the payload using the app secret, in `X-Hub-Signature-256` as `sha256=<hex>`. Anything but HTTP 200 is retried for up to 7 days, and duplicates happen. Ordering is not documented. | Verify, store, answer 200 at once, process later, idempotently, ordered by provider timestamp. |
| Media | Media download links expire after 5 minutes; media ids after 7 days. Meta stores messages up to 30 days as a processor. Local storage region is chosen before number registration. | No media download in the first release. Later, only permitted kinds, downloaded promptly by a job into existing intake. |
| Templates and window | Business-initiated messages need approved templates (marketing, utility, authentication). Free-form replies only inside 24 hours of the person's last message. | Reminders use utility templates with a URL button whose suffix is a deep-link path. |
| Opt-in and opt-out | Opt-in must name the business and intent. Every opt-out request must be honoured. Sending to a person who blocked the business returns error 130403. | In-app opt-in recorded as consent. STOP keyword and an in-app switch. 130403 permanently suppresses. |
| Pricing | Per delivered message by category and country since 1 Jul 2025. From 1 Oct 2026 utility templates inside the window and ordinary replies are charged too, with 1,000 free service messages per number per month. Bangladesh is a separate market with lower utility and authentication rates. A payment method was needed on the account by 30 Sep 2026. | Every message has a cost. Prefer in-app and email for non-urgent updates. Record each message's pricing data from status webhooks. |
| Limits | New accounts can message 250 unique people a day before verification, 2,000 after. One message per person every 6 seconds (error 131056). Throughput error 130429. | The outbox throttles per recipient and backs off on throttling errors. |

## 5. WhatsApp architecture

```
Meta Cloud API
  -> POST /api/channels/whatsapp/webhook   verify signature, store raw event, answer 200
  -> channel_webhook_events (inbox)        deduplicated by event hash
  -> job process-whatsapp-inbox            SystemScope, per-identity ordering, idempotent by message id
  -> channel orchestration                 identity resolution, conversation state machine
       -> existing VisaStack services      authorization, selected output (S8), facts, intake (S5),
                                           notifications, audit
  -> channel_outbox via notifications      WHATSAPP channel in the existing notification worker
  -> WhatsApp adapter (packages/adapters)  send, throttle, record pricing from status webhooks
```

Rules:

- The webhook route never touches domain tables. It verifies, stores and returns.
- No WhatsApp-specific OCR, case model, profile model, permission system or document pipeline.
- The adapter is a port (`WhatsAppPort`) with a real implementation and a fake, like the existing storage and email adapters, so every test runs without Meta.
- Kill switch `WHATSAPP_CHANNEL_ENABLED` (default off): when off, the webhook answers 200 and drops events, and nothing is sent.

## 6. Identity contract

States of a channel identity:

| State | Meaning | Allowed |
| --- | --- | --- |
| `PROVISIONAL` | A WhatsApp sender VisaStack has not linked. No account, no record access. | General help from public content only (what VisaStack is, public country checklists, how to sign up or connect). Rate-limited. Messages kept 7 days. |
| `LINKED` | Bound to exactly one VisaStack account by the link flow below. | Reads and confirmed low-risk writes for that account (sections 7 and 8). |
| `REVOKED` | The person disconnected, account recovery ran, the account closed, or Meta reported a changed id. | Treated as provisional. Never re-links by itself. |
| `BLOCKED` | The person blocked VisaStack (130403) or said STOP to everything. | Nothing is sent. Inbound gets no automated reply except confirming how to restart. |

Link flow (the only way to reach `LINKED`):

1. Signed in on the web or PWA, the person opens Account, then WhatsApp, then Connect WhatsApp. They tick the opt-in that names VisaStack and the message purposes (recorded as consent with its wording version).
2. VisaStack shows a one-time code (8 digits, hashed at rest, 10 minutes, 5 attempts) and a `wa.me` link with the code prefilled as "LINK 1234-5678".
3. The person sends it from WhatsApp. The inbox job matches the code hash, checks it belongs to the account that created it, is unexpired and unconsumed, and binds the sender's business-scoped id to that account in one transaction, with an audit event.
4. WhatsApp replies "Connected to VisaStack" and the web page updates from server state.

A sender who writes first is never linked from chat. The bot replies with how to connect and a plain link to the Connect page (no token). Linking always starts from a signed-in session, so the person proves both the account and the WhatsApp they hold.

Threats:

| Threat | Control |
| --- | --- |
| Recycled phone number | Identities are keyed on the business-scoped id, which belongs to the WhatsApp account, not the number. A new owner of the number has a different id and is provisional. |
| Lost phone | Disconnect from any signed-in device. Account recovery revokes every channel binding. Chat can never do high-risk actions (section 9), so a found phone cannot export, share, delete or recover. |
| Changed phone | `user_changed_number` keeps the binding and updates the masked number. `user_changed_user_id` revokes it; the person reconnects. |
| Wrong number | Nothing links without a code created in that person's signed-in session. |
| Duplicate accounts | One identity binds at most one account and one account at most one identity (unique constraints). Linking a second account first requires disconnecting. |
| Existing account | Same link flow; there is no separate claim path. |
| Linking to someone else's record | The code is bound to the account that created it, short-lived, single-use, attempt-limited and hashed. The bot never accepts an account id, email or phone typed in chat. |
| Revoked connection | Revocation is checked on every inbound message before any read or write. |
| Account recovery | Recovery and account closure revoke bindings in the same transaction. |
| Unknown sender learning about an account | Provisional replies never confirm whether an email, number or record exists. |

Smallest data model (schema contract only; the migration waits, section 12):

```
channel_identities
  id uuid pk
  channel text ('WHATSAPP')
  provider_portfolio_id text            -- the business portfolio the scoped id belongs to
  external_user_id text                 -- business-scoped user id
  phone_hmac text null                  -- keyed hash, for matching Meta number-change events only
  phone_last4 text null                 -- for the masked display "ends in 4321"
  status text (PROVISIONAL|LINKED|REVOKED|BLOCKED)
  account_id uuid null -> accounts
  linked_at, revoked_at timestamptz null; revoked_reason text null
  created_at, last_inbound_at timestamptz
  unique (channel, provider_portfolio_id, external_user_id)
  unique (account_id, channel) where status = 'LINKED'

channel_link_codes
  id uuid pk; account_id uuid -> accounts; code_hash text; expires_at; consumed_at null; attempts int

channel_webhook_events                  -- raw inbox
  id uuid pk; event_hash text unique; received_at; payload_ciphertext bytea;
  processed_at null; attempts int; last_error_code text null

channel_messages                        -- minimal log, one row per provider message
  id uuid pk; identity_id -> channel_identities; direction (IN|OUT); provider_message_id text unique;
  kind text; provider_timestamp; state text; body_ciphertext bytea null; purge_after timestamptz;
  pricing_category text null; pricing_billable bool null

channel_conversations
  id uuid pk; identity_id unique -> channel_identities; state text
  (IDLE|AWAITING_CONFIRMATION|ESCALATED); pending_proposal_ciphertext bytea null;
  proposal_id uuid null; proposal_expires_at null; service_window_until null; version int; updated_at
```

Message text and proposals are encrypted with the existing envelope encryption (S26 key service). Retention: linked 30 days, provisional 7 days, raw inbox 7 days after processing, purged by a system job.

Enum and catalogue additions in the same migration: notification channel `WHATSAPP`, consent type `WHATSAPP_MESSAGING` (opt-in), optional consent type `AI_CHANNEL_ASSIST` (AI may interpret chat text; without it the bot runs on buttons and lists only), and system jobs `process-whatsapp-inbox`, `process-whatsapp-outbox`, `purge-whatsapp-messages`.

## 7. Read contract

- Each inbound message from a `LINKED` identity resolves to that account's existing principal, marked with `channel: 'WHATSAPP'`. Authorization is the existing `require-access` path. The channel adds a ceiling (a deny list of high-risk actions, section 9) and can never exceed the account's own rights.
- Reads go through S8's selected-output engine with fixed channel selections, never a broad loader. Proposed presets: case status (readiness and what needs attention), expiring items (kind and date, identifiers masked), agency review status, and requested evidence (labels only). S8 already masks identifiers and returns no storage keys or URLs. Links are added with `lib/deep-links.ts`.
- If S8's output cannot serve runtime reads as is, extend it or reuse its projection primitives. No `loadEverythingForWhatsApp()`.
- Missing and forbidden records give the same reply ("I could not find that in your VisaStack account").
- AI never decides access. Intent ("what is missing?", "what is expiring?", "did my agency review this?", "show my current case") maps to one of the fixed selections by deterministic code; the AI may only suggest which one.

## 8. Write contract

Conversation, then a structured proposal, then explicit confirmation, then the existing service, then canonical version and audit.

1. "I joined ABC in March 2024 and earn 85,000." The AI (with `AI_CHANNEL_ASSIST`) or a guided list extracts candidate values. Nothing is saved.
2. The bot replies with the values and three reply buttons: Save, Change, Cancel. "Employer: ABC. Started: March 2024. Monthly salary: BDT 85,000. Save these details?" The proposal is stored encrypted on the conversation with an id, a version and a 30-minute expiry. Button ids carry the proposal id and version.
3. Only a Save press whose ids match the live proposal calls the same profile write service the web uses for a person's own confirmed answers, under the linked account's principal, with audit `channel: 'WHATSAPP'`.
4. New text while a proposal is open replaces it (new version) and the old buttons stop working. Typed "yes" never confirms.

Allowed through chat: low-sensitivity profile facts and answers (employment, dates, travel plans, preferences). Refused with a secure link instead: passport, national ID and other identity numbers, bank or card details, and anything the catalogue marks restricted.

## 9. High-risk actions and secure handoff

WhatsApp guides and links; the app finishes these, behind the existing session and step-up checks:

account linking (the code is shown in the app), sensitive uploads (passport, national ID, bank statements, money evidence), broad sharing permission, Applicant Truth acknowledgement, fresh or step-up authentication, account recovery, deletion, export, viewing original documents, consequential payment confirmation, and high-risk identity changes.

Default sensitive-upload journey: WhatsApp, then a secure task link (a deep link to the documents or requested-evidence route, no token), then the PWA or site after sign-in, then upload, then automatic reading (S5), then the person's review and confirmation (S6), then VisaStack state changes, then the channel reports it.

## 10. Conversation engine

- State lives in Postgres (`channel_conversations`), so it survives restarts. No in-memory sessions and no separate conversation platform.
- Duplicates: the raw event hash and the provider message id are unique; a repeated event is a no-op.
- Retries: the job retries with backoff; the webhook never depends on processing.
- Out-of-order events: processed per identity in provider-timestamp order. A status for an unknown outgoing message is kept and matched later.
- Two quick messages: the conversation row is locked (`for update`) and its version checked; the second message sees the first one's result.
- Expired interaction: proposals expire after 30 minutes; pressing an old button gets "That has expired. Here is where we are now."
- Resumable: the next message picks up the stored state.
- AI classifies intent and extracts candidates. Deterministic code owns every state change.
- Human escalation: a Talk to a Person option on every menu. For a person with an agency case it raises a case task for that agency (existing tasks); otherwise it goes to VisaStack support with the case reference and no message content. While escalated, automatic replies pause until a person resolves it or 24 hours pass.

## 11. Return continuation, payment, user control, audit

- Return continuation: truth comes from VisaStack state, never a link click. The domain change and its notification are written in the same transaction (the existing `enqueueNotification(tx, ...)` outbox), and the WhatsApp channel sends "Your passport has been added." only from that committed state.
- Payment (no implementation until S10, S11 and S12 settle): WhatsApp sends an invoice or reminder utility template with a link to the secure payment route. The gateway or manual fallback records money through the cash ledger (S10). Only a confirmed ledger state may be reported back. A message saying "I paid" never changes money state; at most it opens the existing "I Paid Another Way" path (S12) in the app.
- User control (Account, then WhatsApp): connected or not, masked number ("ends in 4321"), connection date, a notifications switch per category, Disconnect. VisaStack never depends on WhatsApp: sign-in, recovery and every feature work without it.
- Audit: `appendAuditEvent` with actions such as `channel.whatsapp.linked`, `.revoked`, `.fact_confirmed`, `.read_denied`, `.escalated`, and metadata limited to account, channel, operation, related resource id, allowed or denied, time and the provider message id when needed. Never message text, document content, AI context, identity numbers, bank data or tokens. The same rule applies to ordinary logs.

## 12. Dependencies, migration and likely files

| Dependency | Why | Gate |
| --- | --- | --- |
| S5 and S6 | Media or document input must use the same automatic reading; reading states are the review screens the handoff lands on | Both on `main` before any media or document work |
| S8 and S9 | Reads must use the selected-output engine; S9 owns the prepared WhatsApp message | Both on `main` before reads, writes or context |
| S10 | Payment reporting needs the cash ledger | Not a blocker for the foundation; blocks payment messages only |
| Migration order | Lane C's S10 (and S11 if built together) produce the next migrations | The WhatsApp migration is generated from fresh `main` with `pnpm --filter @visastack/db db:generate` after every earlier migration-producing package has merged, reviewed against the journal, and run only with the owner's word |

Likely files (D2): `packages/adapters/src/whatsapp/{signature,codec,client,fake}.ts`; `packages/services/src/channels/{identity,link,inbox,conversation,proposals,read-selections,outbox}.ts`; `packages/db/src/schema.ts` plus the generated migration; `packages/core/src/domain.ts` (consent types); `packages/services/src/access/principal.ts` (system jobs, channel ceiling); `packages/services/src/notifications.ts` (`WHATSAPP` channel); `apps/web/src/app/api/channels/whatsapp/webhook/route.ts`; `apps/web/src/app/api/jobs/process-whatsapp-*/route.ts`; `apps/web/src/app/app/account/whatsapp/page.tsx`; `apps/web/vercel.json` (daily backstop).

Webhook details for D2 (confirm against the live docs first): `GET` compares `hub.verify_token` with `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in constant time and echoes `hub.challenge`, else 403. `POST` reads the raw body (limit 1 MB), computes HMAC-SHA256 with `WHATSAPP_APP_SECRET`, compares with `X-Hub-Signature-256` in constant time, answers 401 on mismatch and stores nothing, else stores and answers 200.

## 13. Acceptance tests

PWA real-device checklist (owner or tester):

1. Android Chrome: Help page shows Install VisaStack; installing opens the workspace in its own window.
2. iPhone Safari: Share, then Add to Home Screen; the icon and name are right; it opens standalone.
3. In the installed app: sign in, move between pages, sign out, sign in again.
4. Upload a made-up document from the camera and from files.
5. Airplane mode: the offline screen appears; turn it off and the page returns by itself.
6. After a deployment: the update notice appears; Reload Now loads the new version.
7. Device storage settings show no VisaStack pages or documents stored.

WhatsApp D2 tests (all with the fake adapter and official fixtures):

- Signature: valid accepted, altered body refused, missing header refused, wrong secret refused, verify handshake right and wrong token.
- Idempotency: the same event twice is processed once; the same message id in two events is processed once.
- Ordering: two messages out of order are applied in provider-timestamp order; two quick messages serialize through the conversation lock.
- Identity: unknown sender gets no account data; link with a valid code binds; expired, consumed, other account's or brute-forced codes are refused; disconnect, recovery and `user_changed_user_id` revoke; a recycled number is a new provisional identity.
- Reads: each preset returns only its selection; a forbidden or missing case gives the identical reply; identifiers are masked.
- Writes: nothing saves without Save; an old proposal's button is refused; restricted fields are refused with a secure link; the saved fact carries channel audit.
- Media: an unsolicited passport image is not stored and gets the secure upload link.
- Opt-out: STOP suppresses; 130403 blocks; the notifications switch suppresses that category.
- Escalation: Talk to a Person creates the agency task or support item and pauses automation.
- Audit and logs: no message text, numbers or tokens in audit metadata or logs (scan in tests).
- Kill switch: off means no processing and no sends.

## 14. Owner and provider actions (none done by this session)

1. Network: allow `developers.facebook.com` (and `business.whatsapp.com`, `www.whatsapp.com`) in this cloud environment's network settings so a session can verify the Meta pages and copy the example payloads.
2. Meta: business portfolio and business verification; a WhatsApp Business Account; a dedicated number (not a personal one); display name approval; two-step PIN; choose the local storage region before registering the number; a payment method on the account; a system user token; the app secret; the webhook URL subscription.
3. Templates to submit (utility): document expiring, evidence requested, case update, connection confirmation, and later invoice reminder. Generic wording, no personal values, a URL button with a deep-link path.
4. Decide: who answers Talk to a Person outside agency cases; whether AI may interpret chat text (`AI_CHANNEL_ASSIST`) and its wording; the AI vendor's no-training term; privacy notice update (Meta as processor, retention).
5. Environment variables, added only at go-live: `WHATSAPP_CHANNEL_ENABLED`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_GRAPH_API_VERSION`.
6. PWA: optional `PWA_SERVICE_WORKER=off` is the emergency switch (no rebuild). Question: keep the installed app's title-bar colour brand blue (`#1D4C98`, current) or match the light page (`#F7F9FE`) to avoid a colour change on launch.
7. Cost: read the Bangladesh rate card and set a monthly message budget.

## 15. Next trigger

Resume from fresh `main` after S5/S6 and S8/S9 are merged: verify the merge commits, create a fresh WhatsApp branch from that `main`, re-read the actual S5, S6, S8 and S9 interfaces, update this contract, confirm the `[SX]` facts on the live Meta pages, then build the D2 foundation in bounded steps (adapter and signature, inbox and identity, link flow, reads, proposals, notifications channel). The PWA branch is updated against the converged `main`, re-tested and reviewed before the normal merge rule.
