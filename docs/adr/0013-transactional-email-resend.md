# ADR-0013: Transactional email provider -- Resend

- **Status:** Accepted
- **Date:** 2026-09-22
- **Deciders:** VisaStack engineering
- **PRD/Spec link:** Commercial V1 implementation directive, Part 5 §5 "Real email adapter" (NTF-03); PRD §8.

## Context

NTF-02 built the transactional outbox (`notifications` table, `runNotificationWorker`,
`EmailPort` -- `packages/services/src/ports.ts`) against `NullEmailPort`, a pilot stub that
only logs and never actually sends. Directive §5 requires a real provider before commercial
mode may report ready, name the provider's env vars fail-closed at startup rather than
silently no-op, and choose it against seven named criteria: verified current API/docs,
pricing, region, data terms, webhook support, domain authentication, retry model. It also
requires `NullEmailPort` to remain available for local/test only, and states plainly that
live delivery verification (A18) may stay BLOCKED without real provider credentials -- which
is this sandbox's actual situation.

Direct fetches to `resend.com` and `docs.svix.com` are blocked by this environment's network
egress proxy. What follows is grounded in: the official `resend` npm package's registry
metadata (a primary source, not blocked -- confirms current version 6.28.1, Node >=20,
ESM+CJS, queried directly against `registry.npmjs.org`), and multiple independently
cross-referenced search results (not a single unverified claim) for pricing, compliance
posture, and webhook mechanics. The adapter itself calls Resend's REST API directly via
`fetch` rather than depending on the npm SDK, keeping its dependency footprint identical to
every other adapter in this codebase (see `packages/adapters/src/email.ts`'s own doc
comment).

## Decision

**Chosen: Resend**, against the directive's seven criteria:

| Criterion | Resend | Postmark (runner-up) |
|---|---|---|
| API/docs | `POST /emails` (from/to/subject/text or html), JSON, `Authorization: Bearer`. Stable, single-call REST shape -- no SDK dependency required. | Also a stable single-call REST API. |
| Pricing | Free: 3,000 emails/month, 100/day. Pro: $20-35/mo. Scale: $90 (100k) to $1,150 (2.5M). SOC 2 Type II + GDPR included on every tier, including Free. | Free: 100 emails/month only. Paid plans restructured in early 2026 to Basic ($15/mo), Pro ($16.50/mo), Platform ($18/mo), all starting at 10,000 emails, with per-1,000 overage of $1.80/$1.30/$1.20 respectively. |
| Region | A sending region is selectable (e.g. `eu-west-1`) -- controls where the outbound SMTP hop originates, not where data is stored. Account data (message content, delivery logs, webhook payloads, account records) is stored in the US regardless of sending region. No EU data-residency option exists. | US-based; no EU-residency option found either. |
| Data terms | SOC 2 Type II, GDPR (DPA + SCCs), EU-US Data Privacy Framework. | Comparable SOC2/GDPR posture at the vendor level; not independently re-verified this session. |
| Webhook support | Svix-based. Signed with HMAC-SHA256 over `{svix-id}.{svix-timestamp}.{body}`, verified via a `whsec_`-prefixed shared secret -- a real cryptographic signature the receiver can verify without trusting network-layer identity. | No HMAC signature verification. Postmark's own documented posture is HTTP Basic Auth plus allowlisting Postmark's IP ranges -- weaker: it depends on keeping an IP allowlist current and doesn't stop a party inside the allowlisted network path from forging a request the way a per-request HMAC signature does. |
| Domain auth | DKIM/SPF/DMARC domain authentication, included on every tier. | Also supports standard domain authentication (DKIM/SPF/DMARC) via sender signatures. |
| Retry model | This adapter deliberately does not depend on either provider's own internal retry behavior for transient failures -- `packages/services/src/notifications.ts`'s own 5-attempt/24-hour backoff (NTF-02) already owns that, treating any non-2xx response as a single failed attempt. What matters here is a synchronous success/failure signal at send time (both providers give one) plus an out-of-band delivery/bounce confirmation via webhook (Resend's HMAC-verified webhook is the stronger of the two, per the row above). | Comparable synchronous signal; weaker webhook verification as above. |

Resend wins primarily on the webhook-signing criterion (the one place the two providers
genuinely diverge on security posture, not just price) plus a materially more usable free
tier for a pre-revenue pilot (3,000/month vs. 100/month). Neither offers EU data residency,
so that criterion does not distinguish them; this is recorded as an accepted trade-off below,
not a reason to prefer one over the other.

Implementation: `packages/adapters/src/email.ts`'s `ResendEmailPort` (calls
`POST https://api.resend.com/emails` directly), `packages/adapters/src/resend-webhook.ts`'s
`verifyResendWebhookSignature` (the Svix HMAC algorithm), and
`apps/web/src/app/api/webhooks/resend/route.ts` (the webhook receiver). Selected only when
`EMAIL_PROVIDER=resend` is explicitly set (`apps/web/src/lib/providers.ts`'s
`createEmailPort`); unset keeps `NullEmailPort` active, matching directive §5's "may remain
available only for local/test where explicit." `NullEmailPort` itself now refuses to
construct at all once `DEPLOYMENT_MODE=commercial` (`assertNotCommercialMode`, the same
pattern `LocalEnvelopeKeyProvider`/`ClamAvScanner` already use), and
`commercial-readiness.ts`'s new `realEmailProvider` gate checks the same env vars
`createEmailPort` reads -- the two can never disagree about whether a real provider is
actually configured.

## Consequences

- **Positive:** commercial mode can no longer silently ship with an email port that never
  sends -- it refuses to construct (`NullEmailPort`) and refuses readiness
  (`realEmailProvider` gate) instead. Delivery/bounce/complaint state now updates from a
  cryptographically verified source of truth (the webhook), not merely "the provider
  accepted our POST," closing the "do not label provider acceptance as delivered/read" gap
  NTF-02 explicitly left open. Free tier (3,000/month) is enough for this pilot's realistic
  near-term volume at zero cost.
- **Negative / trade-offs (explicit, not hand-waved):**
  1. **No EU data residency.** Recipient email addresses, and the (deliberately neutral,
     minimal -- never passport/financial/medical/refusal-narrative) notification payloads
     pass through and are logged by a US-based vendor. Acceptable for this pilot given the
     payload minimization already in place (NTF-02's own design), but a genuine trade-off,
     not a non-issue -- an operator with a hard EU-residency requirement would need a
     different vendor or a self-hosted SMTP relay.
  2. **Live verification (A18) is BLOCKED in this sandbox.** No real Resend account/API
     key/webhook secret exists here. The adapter, webhook route, and signature verification
     are implemented and unit-tested against the documented protocol and against
     self-consistent signed vectors, but an actual synthetic send + real signed webhook
     round-trip against a live Resend account has not happened. This matches directive §5's
     own anticipated outcome ("implementation may be complete; live A18 remains BLOCKED;
     commercial gate remains false") exactly -- recorded honestly, not glossed over.
  3. **Postmark's IP-allowlist webhook model was rejected, not merely noted.** Choosing
     Resend means this codebase depends on Svix's HMAC scheme rather than a simpler
     Basic-Auth check -- more code (`resend-webhook.ts`) for a stronger guarantee.
- **Follow-ups:** obtain a real Resend account + verified sending domain + webhook secret to
  unblock A18. Consider a paid tier once volume approaches 100/day (the free tier's daily
  cap, tighter than its monthly one).
- **Reversible:** `EmailPort` is a provider-agnostic contract (`ports.ts`); replacing
  `ResendEmailPort` with a different adapter is a `providers.ts` change plus a new adapter
  class, no domain or schema change -- `notifications.providerMessageId` is a plain string,
  not Resend-specific.

## Alternatives considered

- **Postmark** -- rejected: no HMAC webhook signing (Basic Auth + IP allowlist instead, a
  weaker guarantee against a spoofed request), and a far smaller free tier (100/month vs.
  3,000/month) for a pilot with no revenue yet. Both were within the directive's
  "lowest-complexity appropriate provider" band; the webhook-security difference decided it.
- **AWS SES** -- not evaluated in depth: would add a new cloud vendor relationship (AWS
  account, IAM, SES sandbox-to-production request process) this codebase does not otherwise
  have, for a pilot already fully hosted on Vercel + Neon (ADR-0011's own "avoid enabling any
  additional [vendor] feature" posture). A legitimate future candidate at higher volume.
- **SendGrid** -- not evaluated in depth: broadly comparable positioning to Postmark/Resend;
  no specific criterion surfaced that would beat Resend's webhook-signing advantage, and
  evaluating a third provider in equal depth was not proportionate to a pilot-stage decision
  the directive itself frames as "lowest-complexity appropriate."
- **Continue with `NullEmailPort` in commercial mode** -- rejected outright: directive §5 is
  explicit that commercial/production mode "must refuse to start or refuse email-dependent
  readiness if NullEmailPort is active"; this is not a discretionary choice.
