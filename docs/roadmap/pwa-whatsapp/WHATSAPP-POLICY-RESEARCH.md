# WhatsApp Business Platform (Cloud API) - official-source research for VisaStack

Reviewed: 2026-10-27

## READ FIRST - how these facts were obtained (verification status)

The brief required every fact to come from a page fetched this session. That was NOT possible:

- WebFetch failed for every host with `getaddrinfo ENOTFOUND` (developers.facebook.com, business.whatsapp.com, www.whatsapp.com, and even example.com). The fetch tool itself had no working network path.
- Direct HTTPS (curl) through the session's egress proxy was refused with `403` on CONNECT to developers.facebook.com:443 ("connect_rejected", host not allowed for this session). Per the proxy rules this was not retried or routed around.
- The only working channel was WebSearch. All searches were restricted (`allowed_domains`) to developers.facebook.com, business.whatsapp.com and whatsapp.com. Each fact below therefore comes from a **search-index excerpt of an official Meta page**, not from reading the page. Search excerpts are machine-summarised and may be stale, truncated or paraphrased even where shown in quotes.

Status labels used below:
- **[SX]** Search excerpt of the named official URL. Short quoted text is the search tool's quote of that page; treat as "very likely verbatim, not proven verbatim".
- **[SX-conflict]** Excerpts disagree with each other or show signs of staleness.
- **[NOT FOUND]** No official excerpt surfaced; nothing is asserted.

Nothing here is filled from memory. Before implementation, an engineer with normal web access must open each URL and confirm every [SX] item, and copy the fixtures in the appendix by hand.

Note on URLs: Meta has moved WhatsApp docs from `developers.facebook.com/docs/whatsapp/...` to `developers.facebook.com/documentation/business-messaging/whatsapp/...`. Both forms appear in search results; the `documentation/business-messaging` form is the current one.

---

## 1. Cloud API overview, Graph API version, On-Premises retirement

URLs:
- https://developers.facebook.com/docs/whatsapp/on-premises/sunset
- https://developers.facebook.com/docs/graph-api/changelog/versions/
- https://developers.facebook.com/docs/graph-api/changelog/version26.0/
- https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25/

Reviewed: 2026-10-27

Facts:
- [SX] On-Premises API is retired: "The final supported version of the On-Premise API client expired on October 23, 2025. On-Premises API can't be used to send messages to WhatsApp users anymore." Final version was v2.63; messages to or from numbers still registered on it are not delivered.
- [SX] The sunset page names Cloud API as the migration target and cites throughput "up to 1,000 messages per second".
- [SX] Graph API versions page: "The latest version is: v26.0". v26.0 "Released July 29, 2026 | Available until TBD".
- [SX] Deprecation schedule: v20.0 removed September 24, 2026; v21.0 removed January 21, 2027 (v19 was removed May 21, 2026 per the v25 blog post).
- [SX] Cloud API reference examples still use a v23.0 path; that is an example, not the current version.

Architectural consequence for VisaStack: Build only on Cloud API, pin the Graph version in one config value (start on v26.0) and add a calendar reminder for the roughly two-year version expiry.

## 2. Authentication: tokens, permissions, app secret

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/

Reviewed: 2026-10-27

Facts:
- [SX] Three token types: System user access tokens ("represent you, your business, organization, or people within your business or organization"; long-lived; for direct developers accessing their own business data), Business Integration System User tokens (Tech Providers / Solution Partners, scoped per onboarded customer, require Embedded Signup), and User access tokens (short-lived, for initial testing, "expire quickly").
- [SX] Permissions to assign to the app: `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`.
- [SX] Webhook fields map to permissions: `whatsapp_business_messaging` for messages and calls webhooks; `whatsapp_business_management` for all other webhooks.
- [SX] The system user also needs Partial or Full business asset access to the WhatsApp Business Account (WABA); without it endpoints return error code 200.
- [SX] App secret: used as the HMAC key for webhook signatures (see section 3).
- [NOT FOUND] Whether system user tokens can be set to "never expire" vs 60-day expiry in the current UI was not confirmed.

Architectural consequence for VisaStack: One system user token (direct developer, own WABA) stored as a server-only secret with the three permissions, plus the app secret as a separate secret for signature checks; plan a rotation runbook since the expiry setting is unconfirmed.

## 3. Webhook verification handshake and payload signature

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/set-up-whatsapp-echo-bot.md
- https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint
- https://developers.facebook.com/community/threads/937289794026555/ (community forum, not authoritative)

Reviewed: 2026-10-27

Facts:
- [SX] Handshake: Meta sends GET with `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. If mode is `subscribe` and the token matches your configured verify token, respond 200 with the `hub.challenge` value as the body; otherwise respond 403 (official echo-bot sample).
- [SX] Signature: Meta signs requests with SHA256 and puts it in the `X-Hub-Signature-256` header, prefixed `sha256=`. Verify by computing HMAC-SHA256 of the payload with the app secret and comparing to the value after the prefix. (Quoted from the Flows endpoint guide; the webhooks overview excerpt did not show the signature text itself.)
- [SX] The Flows guide describes app-secret rotation where the old secret continues to sign "for X hours" (exact hours not captured).
- [SX] A Meta community thread reports WhatsApp signatures failing where Facebook/Instagram ones pass; no official fix shown. Common cause is hashing a re-serialised body rather than raw bytes (forum context, not an official statement).
- [NOT FOUND] An official sentence stating "raw request body bytes" explicitly was not captured.

Architectural consequence for VisaStack: The webhook route must read the raw body bytes before any JSON parsing, compute HMAC-SHA256 with the app secret, compare in constant time against `X-Hub-Signature-256`, reject unsigned or mismatched requests, and support two app secrets during rotation.

## 4. Webhook delivery and retry behaviour

URLs:
- https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/
- https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks (Messenger, adjacent)

Reviewed: 2026-10-27

Facts:
- [SX] If the endpoint returns anything other than HTTP 200, or delivery fails, Meta retries "with decreasing frequency until the request succeeds, for up to 7 days".
- [SX] Retries "can result in duplicate webhook notifications". (Messenger docs add that your server should deduplicate.)
- [SX] Some webhooks are not sent while the app is in Dev mode; app must be Live.
- [SX] Group delivered/read updates may be aggregated into one webhook with several status objects.
- [NOT FOUND] Ordering guarantees: no official statement found. Required response time (seconds): not found.

Architectural consequence for VisaStack: Verify signature, persist the raw event to a durable inbox table keyed by message id plus status, return 200 immediately, process asynchronously, make every handler idempotent, and order by the payload `timestamp` rather than arrival; a 7-day outage window means a backlog replay must be safe.

## 5. Webhook payload shape (messages and statuses)

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/contacts/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/
- https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages

Reviewed: 2026-10-27

Facts:
- [SX] Envelope: `object`, `entry[]`, `entry[].changes[]`, `changes[].value`; `value.metadata` holds `display_phone_number` and `phone_number_id`; `value.messages[]` holds `from`, `id` (wamid), `timestamp`, `type`, and for text a `text` object with `body`; `value.contacts[]` holds the sender profile name.
- [SX] BSUID-era identifiers (business-scoped user IDs page): `contacts[]` contains `profile.username`, `wa_id`, `user_id`, `parent_user_id`; `messages[]` contains `from`, `from_user_id`, `from_parent_user_id`.
- [SX] `user_id` is always included; `wa_id` is always included when the user has no username; `parent_user_id` only when parent BSUIDs are enabled; if the user has a username, `wa_id` is included only when a phone number is available under the phone-number conditions (section 6).
- [SX] Statuses go under `value.statuses[]` with message `id`, recipient id, `status` (sent / delivered / read / failed), `timestamp`; failed statuses add an `errors[]` array.
- [SX] New status property `recipient_user_id`: "Will always be set to the user's BSUID, regardless of whether the message was sent to the user's phone number or BSUID"; for failed status messages it "will be omitted if the message was sent to the user's phone number".
- [SX] Username appears "in all incoming messages webhooks, and all delivered and read status messages webhooks" once enabled.
- [SX] Message id: the WAMID "can be up to 128 characters", prefix `wamid.`, and the same id appears in sent, delivered and read webhooks.
- [SX] The older Contacts reference example shows only `profile.name` and `wa_id` (predates BSUID).
- [SX] List reply arrives with `"type": "list_reply"`; `button_reply` shape not captured.

Architectural consequence for VisaStack: Parse with a tolerant schema in which `wa_id`/`from` are optional and `user_id`/`from_user_id` are the primary key; store wamid as text up to 128 characters (unique index) and never assume a phone number is present.

## 6. Usernames and business-scoped user IDs (BSUID) - identifier change

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- https://developers.facebook.com/videos/2026/whatsapp-usernames/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-settings/

Reviewed: 2026-10-27

Facts:
- [SX] BSUID format: two-letter country code, a period, then up to 128 alphanumeric characters; unique per business portfolio and user pair. A business phone number in one portfolio can message a BSUID from that portfolio; messaging from a number in a different portfolio fails.
- [SX] "BSUID will be assigned to the user_id parameter and appear in all messages webhooks, regardless of whether or not the user has enabled the username feature."
- [SX] If a user enables usernames, "their phone number will not be included in webhooks, unless you have interacted with the user before". The phone number is still included if the business messaged/called the user, or the user messaged/called the business, within the last 30 days, or the user is in the business contact book; the 30-day lookback is evaluated per business phone number (third-party restatement of Meta's rule; the official page confirms the conditions exist).
- [SX] Timeline on the official page: "BSUIDs began appearing in webhooks in early April 2026. However, our APIs will not support sending messages targeted to the BSUIDs until July 2026." Whether the July 2026 send support shipped was NOT confirmed.
- [SX-conflict] Third-party sources (not official) give March 31, 2026 for webhook appearance and end of June 2026 for phone numbers disappearing. Official dates must be read on the live changelog.
- [SX] `user_id` changes when the user changes phone number. A `user_id_update` system webhook reports `system.type` = `user_changed_number` (new number can be shared) or `user_changed_user_id` (only the BSUID change can be reported).
- [SX] Changelog May 28, 2026: BSUID and username fields added to calling webhooks (including `recipient_user_id`).
- [SX] Block Users API accepts phone number or BSUID; parent BSUIDs are not supported for block/unblock (doc update May 4, 2026).
- [SX] June 18, 2026 Meta developer video describes BSUID as "a new backend identifier that will replace phone numbers for users who adopt usernames".

What integrators must do (from the above): key users on `user_id` (BSUID) with phone as an optional attribute; handle `user_id_update`; keep BSUIDs scoped to one business portfolio; never require the phone number to link a WhatsApp sender to an account.

Architectural consequence for VisaStack: Account linking cannot rely on matching the WhatsApp number to the profile phone; use an explicit in-app linking flow (one-time code sent from the signed-in web session) that binds a BSUID to a VisaStack account, and store BSUID per business portfolio.

## 7. Inbound media

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
- https://developers.facebook.com/docs/whatsapp/cloud-api/messages/image-messages/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/video-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security

Reviewed: 2026-10-27

Facts:
- [SX] Retrieval: webhook gives a media id; GET the media id on the Graph API (bearer token) to obtain a URL; then download the URL (bearer token). "Media URLs expire after 5 minutes, after which you must query the ID again to get a new URL."
- [SX] "Media IDs in webhooks expire after 7 days." IDs from upload / Media API expire after 30 days.
- [SX] Size limits: images 5 MB (JPEG, PNG); documents up to 100 MB; animated stickers 500 KB, static stickers 100 KB; audio and video limits smaller (exact MB not captured). The excerpt notes Meta's own table is inconsistent.
- [SX] Types: audio AAC, AMR, MP3, M4A, OGG (OPUS only); video 3GP and MP4 (H.264 + AAC); documents PDF, Word, Excel, PowerPoint, plain text.
- [SX] Oversized inbound file produces webhook error 131052 "Media file size too big".
- [SX] Retention: "Messages have a maximum retention period of 30 days" on Cloud API (see section 19).
- [NOT FOUND] Whether Meta malware-scans media: no official statement found.

Architectural consequence for VisaStack: If any media is accepted, a worker must fetch it within minutes of the webhook (URL lives 5 minutes, id 7 days), stream it straight into the existing private R2 vault with VisaStack's own malware and type checks, and never store the Meta URL.

## 8. Interactive messages

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-cta-url-messages/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button/

Reviewed: 2026-10-27

Facts:
- [SX] Reply buttons: up to 3 buttons; button title max 20 characters; button `id` max 256 characters.
- [SX] List messages: top-level button label max 20 characters; up to 10 sections; up to 10 rows across all sections combined; row title max 24 characters; row description max 72 characters.
- [SX] CTA URL: button label max 20 characters; opens the URL in the device's default browser. Button-count limit not captured.
- [SX] Body max 1024 characters; footer max 60 characters.
- [SX] List selection webhook: `"type": "list_reply"`. `button_reply` payload not captured.

Architectural consequence for VisaStack: Use CTA URL buttons to deep-link into the signed-in web app for anything sensitive, keep reply/list ids as opaque short tokens mapped server-side, and design copy within 20/24/72-character limits.

## 9. WhatsApp Flows

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/flows
- https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint
- https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi

Reviewed: 2026-10-27

Facts:
- [SX] Endpoint encryption: request carries an RSA-encrypted AES key (RSA OAEP, SHA-256), an `initial_vector`, and an AES-GCM encrypted payload with the 128-bit tag appended. Response is AES-GCM encrypted with the same key and the IV with every bit inverted (each byte XOR 0xFF), empty AAD. Meta's Node sample uses aes-128-gcm.
- [SX] Business public key must be "a valid 2048-bit RSA public key in PEM format".
- [SX] Requests are signed with `X-Hub-Signature-256` (app secret). Data API v4.0 added platform-side signature verification and an optional flow-token signature. "flow_token should always be verified on your server".
- [SX] Flow JSON can mark fields "sensitive" so their values are hidden in the response summary shown to the user; this is a display control, not permission to collect restricted data.
- [SX] Flows docs: businesses must "conform to relevant local regulations when handling user data, and ensure that your use case adheres to our Business Messaging Policy".
- [NOT FOUND] Any Flows-specific list of forbidden data types.

Architectural consequence for VisaStack: Flows are acceptable for low-risk structured input (preferences, appointment slots, consent) via an encrypted endpoint, but the Business Policy identifier ban (section 15) still applies, so passport numbers, bank details and national ID numbers must not be collected through Flows.

## 10. Message templates

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates/

Reviewed: 2026-10-27

Facts:
- [SX] Categories: authentication, marketing, utility.
- [SX] Utility must be non-promotional and either user-requested or essential/critical to the user; mixed or unclear content defaults to marketing. Authentication is the only category allowed for one-time passcodes.
- [SX] WhatsApp may recategorise utility templates as marketing; repeated misuse can cap utility volume in a 24-hour rolling window.
- [SX] Review can take up to 24 hours. Statuses include Active - Quality pending, Active - Low Quality ("in danger of being paused or disabled soon"), Paused (cannot be sent), Disabled.
- [SX] Quality rating is based on usage, customer feedback and engagement; pausing temporarily stops poorly rated templates; sending a paused template returns error 2061.
- [SX] Template review rejects templates requesting full payment card numbers, financial account numbers, National Identification numbers, and "requesting documents from users that might contain sensitive identifiers"; "Requesting partial identifiers (ex: last 4 digits of their Social Security number) is OK."
- [NOT FOUND] Variable/parameter limits and full button-type list were not captured.

Architectural consequence for VisaStack: Keep a small versioned catalogue of utility templates (case status, document expiring, action needed) that never ask for documents in chat, handle template status/quality webhooks, and fall back to email when a template is paused.

## 11. Customer service window and free entry points

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- https://business.whatsapp.com/policy

Reviewed: 2026-10-27

Facts:
- [SX] "When a WhatsApp user messages or calls, a 24-hour timer called a customer service window starts", reset by each new user message. Inside it, non-template messages may be sent.
- [SX] Business Policy: "outside the 24-hour customer service window, you may only send messages via approved Message Templates."
- [SX] Free entry point: a user arriving from a Click to WhatsApp ad or Facebook call-to-action opens a window of "3 days (72 hours)" in which messages are not charged; the business must respond within 24 hours or the window does not open (older conversation-based page).

Architectural consequence for VisaStack: Track `last_inbound_at` per BSUID and gate every outbound send through a policy check that picks free-form vs template.

## 12. Business-initiated messaging rules

URLs: https://business.whatsapp.com/policy ; https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits

Reviewed: 2026-10-27

Facts:
- [SX] Business-initiated contact only via approved templates; non-template messages "can respond to users but cannot be used to reach out to users".
- [SX] Requires prior opt-in (section 13) and counts against portfolio messaging limits (section 18).

Architectural consequence for VisaStack: All proactive notifications must be template sends tied to a stored opt-in record.

## 13. Opt-in

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
- https://business.whatsapp.com/policy
- https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform

Reviewed: 2026-10-27

Facts:
- [SX] Opt-in must identify the business and that the person agrees to receive its messages: "Opt-in must clarify your business name and intent."
- [SX] Since the November 2024 policy update opt-in may be general (not WhatsApp-specific) provided local law is followed; may be collected on or off WhatsApp.
- [NOT FOUND] Exact verbatim Business Policy opt-in paragraph.

Architectural consequence for VisaStack: Collect a WhatsApp opt-in inside the signed-in app naming "VisaStack" and the message purposes, store it as an auditable consent event (timestamp, wording version, BSUID/phone) in the existing audit trail.

## 14. Opt-out

URLs:
- https://business.whatsapp.com/policy
- https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/ (Block Users API)

Reviewed: 2026-10-27

Facts:
- [SX] Businesses must respect all requests, on or off WhatsApp, to block, discontinue or otherwise opt out, including removing the person from the contact list.
- [SX] Users can stop marketing messages from a business, or block or report it; blocks, reports, mutes and archives feed the quality score.
- [SX] Block Users API exists (`block_users` on the business phone number); sending to a blocked user returns 130403 ("do not retry").
- [SX] Enforcement ladder: 1 or 3 day template blocks, then 5, 7 or 30 day blocks on all messages, then indefinite lock, then permanent disablement.
- [NOT FOUND] An official "marketing opt-out button" specification or per-user marketing opt-out webhook.

Architectural consequence for VisaStack: Recognise STOP-style keywords and an in-app toggle, store opt-out per category, suppress sends immediately, and treat 130403 as a permanent suppression signal.

## 15. Sensitive information policy (decides document-in-chat)

URLs:
- https://business.whatsapp.com/policy (section "Protect Data and Comply with Law")
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review/
- https://www.whatsapp.com/legal/business-solution-terms (not read beyond the AI clause)
- https://www.whatsapp.com/legal/commerce-policy (NOT reached; nothing asserted)

Reviewed: 2026-10-27

Facts (quotes are search-tool quotes of the official pages):
- [SX] Business Policy: "Don't share or ask people to share full length individual payment card numbers, financial account numbers, personal ID card numbers, or other sensitive identifiers."
- [SX] Business Policy: "Don't use WhatsApp for telemedicine or to send or request any health related information, if applicable regulations prohibit distribution of such information to systems that do not meet heightened requirements to handle health related information."
- [SX] Template review: templates are rejected for requesting full-length payment card numbers, financial account numbers, National Identification numbers, and this "also covers requesting documents from users that might contain sensitive identifiers". "Requesting partial identifiers (ex: last 4 digits of their Social Security number) is OK."
- [NOT FOUND] Word "passport" in the policy. A passport number is reasonably within "personal ID card numbers, or other sensitive identifiers"; that is an interpretation, not a quote.
- [NOT FOUND] Commerce Policy text (could not be reached).

Architectural consequence for VisaStack: Do not ask users to send passport scans, bank statements or national ID numbers in WhatsApp; WhatsApp is a notification and navigation channel only, and every document upload goes through a CTA URL into the authenticated web vault (and inbound unsolicited documents should be declined, not stored, with a link to upload properly).

## 16. Human escalation and AI/chatbot rules

URLs:
- https://business.whatsapp.com/policy
- https://www.whatsapp.com/legal/business-solution-terms
- https://www.whatsapp.com/legal/meta-terms-whatsapp-business
- https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- https://faq.whatsapp.com/2112106596314330 (Meta Business Agent help, adjacent)

Reviewed: 2026-10-27

Facts:
- [SX] Business Policy: "You may reply to a user message without use of a Message Template as long as it's within the 24-hour customer service window, and you may use automation when responding during the 24-hour window, but must also have available prompt, clear, and direct escalation paths." The list of acceptable escalation paths was truncated in the excerpt.
- [SX] Business Solution Terms, "Last Modified: January 15, 2026": AI model developers ("AI Providers") are barred from using the platform to offer general-purpose assistants when such AI is the primary functionality, as determined by Meta in its sole discretion. Meta Terms excerpt: AI Providers are "strictly prohibited from accessing or using the WhatsApp Business Platform" when the AI is "the primary functionality being offered".
- [SX] Exception: "Notwithstanding the foregoing, you may retain an AI Provider as your Third Party Service Provider", but that provider may not use Business Solution Data to train its models; fine-tuning for the business's exclusive use is allowed.
- [SX] Changelog: effective February 16, 2026, in countries where Meta is legally required to support AI Providers, Meta charges AI Providers for non-template messages.
- [SX] Messenger policy (adjacent, not WhatsApp): disclose automation where law requires.

Architectural consequence for VisaStack: A task-bound assistant for VisaStack's own service is allowed (VisaStack is not offering a general-purpose AI), but the model vendor must be contractually barred from training on the chat data, replies must stay on visa-case topics, and every conversation needs a visible "talk to a person" path into the staff queue.

## 17. Pricing

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing (deprecated)
- https://business.whatsapp.com/products/platform-pricing
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/authentication-international-rates/

Reviewed: 2026-10-27

Facts:
- [SX] Per-message pricing since July 1, 2025 (replaced conversation-based pricing); charged per delivered message; rate depends on category and recipient country calling code.
- [SX] Template categories charged: marketing, utility, authentication.
- [SX] Utility templates sent inside an open customer service window were free from July 1, 2025; the pricing page lists this as reversed effective October 1, 2026 ("Charging for messages that were previously free").
- [SX] Non-template (service) messages charged from October 1, 2026: as a Meta Business Agent message if powered by Meta Business Agent, otherwise as a service message; one category only, no extra marketing charge.
- [SX] Free tier: 1,000 service messages per business phone number per month, no rollover. Without a payment method on file by September 30, 2026, service messages stop being delivered after the free tier.
- [SX] Service messages in an open free entry point window are not charged.
- [SX] Government and eligible non-profits keep free service messages "through December 31, 2027".
- [SX] Rate cards: downloadable CSV/PDF per currency; Bangladesh (880) is a standalone market; effective October 1, 2026 Bangladesh utility/authentication rates decreased after leaving "Rest of Asia Pacific", and an authentication-international rate for Bangladesh was added.
- [SX-conflict] The non-template pricing page is titled "Upcoming" and some excerpts were months old; the October 1, 2026 changes are stated as effective by the analytics page.
- [NOT FOUND] Actual Bangladesh USD figures.

Architectural consequence for VisaStack: Every message now costs money outside the 1,000/month free tier, so add a per-message cost ledger (category, country, wamid, pricing webhook field), keep a payment method on the WABA, and prefer email or in-app notices for non-urgent updates.

## 18. Rate limits and throughput

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
- https://developers.facebook.com/docs/whatsapp/api/rate-limits (older)

Reviewed: 2026-10-27

Facts:
- [SX] Throughput: 80 messages per second per business phone number by default, inbound and outbound combined; automatic upgrade to 1,000 mps requires unlimited messaging limit, 100K+ unique users outside the window in 24 hours, and quality YELLOW or higher. Numbers shared with the WhatsApp Business app are fixed at 20 mps.
- [SX] Error 130429 "Rate limit hit" when throughput exceeded.
- [SX] Pair rate limit: "1 message every 6 seconds to the same WhatsApp user (0.17 messages/second)", about 10/minute or 600/hour; error 131056.
- [SX] Messaging limits are per business portfolio (shared by all numbers), count unique recipients outside the customer service window in a moving 24 hours. New portfolios start at 250; 2,000 reached by business verification, partner verification, or 2,000 delivered messages to unique numbers in 30 days with high-quality templates; then automatic scaling to 10,000, 100,000, unlimited (one level within about 6 hours if quality is high and at least half the current limit was used in 7 days). Read via `whatsapp_business_manager_messaging_limit`; `messaging_limit_tier` deprecated. Change came with v24.0.
- [SX] Graph management endpoints: 200 requests per hour per app per WABA by default, 5,000 per hour for active accounts with a registered number (endpoint list truncated).

Architectural consequence for VisaStack: At 100 to 1,000 users throughput is irrelevant, but the 250 starting limit and the 6-second pair limit matter: queue outbound sends per recipient with backoff on 130429/131056, and complete business verification before launch.

## 19. Data retention and provider considerations

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security
- https://developers.facebook.com/documentation/business-messaging/whatsapp/local-storage/
- https://www.whatsapp.com/legal/business-data-processing-terms
- https://www.whatsapp.com/legal/business-data-transfer-addendum
- https://www.whatsapp.com/legal/meta-terms-whatsapp-business

Reviewed: 2026-10-27

Facts:
- [SX] "Messages have a maximum retention period of 30 days in order to provide the base features and functionality of the Cloud API service; for example, retransmissions." User identifiers deleted within 30 days of the last status update, "unless otherwise directed".
- [SX] Encrypted in transit between user and Cloud API (Signal-based protocol); "industry standard encryption techniques to protect data in transit and at rest"; Meta manages the keys on behalf of the business (not end-to-end to the business).
- [SX] Processor role: "Meta, in providing Cloud API service, acts as a data processor/service provider on behalf of the business"; customers keep their own data-protection obligations.
- [SX] Local storage: opt-in; after a data-in-use period (up to 60 minutes) content is kept only in the selected region, but may be processed internationally during that period; contact book is not covered; can only be enabled while the number is unregistered. Supported regions not captured (Bangladesh availability unknown).
- [SX] Business Data Processing Terms apply where the Business Terms make WhatsApp a processor; sub-processors are Meta companies and third parties with advance notice; remedy for objection is to stop using the service; WhatsApp Ireland contracts incorporate the Data Transfer Addendum. Meta Terms reference the Meta Global Processor Terms.
- [SX] Compliance claims: GDPR, LGPD, SOC 2, SOC 3; pursuing ISO 27001.

Architectural consequence for VisaStack: Treat Meta as a sub-processor in the privacy notice and records of processing, keep the minimum content in WhatsApp (no case details, no documents), and decide local storage before registering the number because it cannot be enabled afterwards.

## 20. Phone number registration, display name, two-step PIN, business verification

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers

Reviewed: 2026-10-27

Facts:
- [SX] Registration endpoint limited to 10 requests per number per 72-hour moving window; error 133016 blocks registration for 72 hours.
- [SX] New portfolios capped at 2 registered numbers; raised to 20 once verified or at a 2,000 messaging limit.
- [SX] Registration takes a 6-digit two-step verification PIN; the PIN "is being deprecated for eligible Cloud API phone numbers" with gradual rollout. Errors 133005 (wrong PIN), 133008 (too many guesses).
- [SX] Display name `name_status`: APPROVED, AVAILABLE_WITHOUT_REVIEW, DECLINED, EXPIRED, PENDING_REVIEW, NONE (endpoint in beta). Re-registering before approval has no effect.
- [SX] Business verification is one route to the 2,000 messaging limit (section 18).

Architectural consequence for VisaStack: Owner actions before build completes: Meta business verification, a dedicated number not used on the consumer app, display name "VisaStack" approval, PIN stored as a secret; registration is a one-off scripted operation with care for the 10-per-72-hours limit.

## 21. Test / sandbox options

URLs:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform
- https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- https://developers.facebook.com/documentation/business-messaging/whatsapp/calling

Reviewed: 2026-10-27

Facts:
- [SX] A test WABA, test Messaging account and test business phone number are created automatically; test numbers have relaxed messaging limits and do not need a payment method to send templates.
- [SX] Test business numbers issued by WhatsApp cannot be migrated.
- [SX] Sandbox accounts are only available to Tech Partners (Calling docs).
- [NOT FOUND] Official recipient-count limit for the test number (commonly believed to be about five; NOT verified and not asserted).

Architectural consequence for VisaStack: Use the free test number plus recorded fixture webhooks in CI (PGlite, no network) and keep a separate staging WABA so production quality ratings are never affected by tests.

---

## Appendix - official example payloads (NOT captured verbatim)

The brief asked for one inbound text message payload and one status payload copied verbatim. Because no official page could be fetched (see "READ FIRST"), and search excerpts are paraphrased, **no payload is reproduced here**. Writing one from memory would violate the brief and could silently become a wrong test fixture.

Where to copy them by hand:
- Inbound text message: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/ and the BSUID-era template on https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/ (prefer the BSUID one: it includes `user_id`, `from_user_id`, `username`).
- Status update (sent/delivered/read/failed): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status/ (path inferred from the reference layout, not confirmed) and the group example on https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/.

Fixture guidance confirmed by excerpts: include a variant with `wa_id` absent and only `user_id` present; a status with `recipient_user_id`; a failed status with `errors[]`; a duplicate delivery of the same wamid.

## Open questions / could not verify

1. Every item is search-excerpt level; no page was fetched (WebFetch DNS failure; egress proxy 403 for developers.facebook.com). Re-verify all [SX] items with direct access.
2. Verbatim example payloads for inbound text and status webhooks (appendix empty by design).
3. Whether sending to BSUIDs (planned "July 2026") is live now, and the official date phone numbers began being omitted for username adopters.
4. Webhook ordering guarantees and the required response time in seconds.
5. Explicit official wording that the signature is over raw body bytes (only the HMAC-SHA256 / app secret / `sha256=` prefix was captured).
6. Whether "passport" is named anywhere in the Business Policy, and the full Commerce Policy text (not reached).
7. The full list of acceptable "escalation paths" in the Business Policy (truncated).
8. Bangladesh USD rates on the current rate card, and whether the October 1, 2026 service and utility charging changes are final (one page still titled "Upcoming").
9. Whether Meta scans inbound media for malware.
10. Audio/video size limits, CTA URL button count, `button_reply` payload shape, template variable limits and full button-type list.
11. Local storage regions available (and whether any suits Bangladesh users).
12. Test-number recipient limit and current system-user token expiry options.
13. Whether the 1,000 free service messages per month is per number (as excerpted) and how it interacts with the free entry point window.
