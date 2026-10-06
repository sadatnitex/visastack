# An AI provider fails, misbehaves or costs too much

Read [README.md](./README.md) first. Directive Part 9 section 8: when AI is out, the manual core
must keep working. It does: every profile field, document and case workflow can be done by hand, and
AI only ever proposes values that a person approves.

## What AI does here, and what it touches

- AI reads a document (text from an image, a suggested document type, suggested field values, a
  consistency check, a short explanation of a readiness gap) and writes **proposals**. Nothing
  changes a profile until a person accepts it.
- To do that, the provider receives document content (page images or extracted text). That is
  personal data leaving the product, so a provider-side incident can be a data incident
  ([data-exposure.md](./data-exposure.md)). A person must have given the matching consent
  (`AI_EXTRACTION`, `AI_OCR`) first.
- Three providers are implemented (OpenAI, Anthropic, Google Gemini). One configuration is active at
  a time and may name a fallback configuration that is tried when the primary fails in a way worth
  retrying (a timeout, a rate limit).
- Admins control it on `/app/admin/ai-settings`: **Save draft**, **Test connection**,
  **Run evaluation (13 cases)**, **Activate**, **Roll back**, **Emergency disable** and
  **Revoke key**. Activating, rolling back and disabling need a fresh sign-in (step-up) and are
  audited (`AI_PROVIDER_CONFIG_*` events).
- Limits that already exist: a monthly spend warning and a hard ceiling, a per-document ceiling, an
  attempt cap per document, a page cap, and at most five model calls at once across the platform
  (the `AI_PILOT_*`, `AI_PER_DOCUMENT_LIMIT_USD`, `AI_MAX_*` variables). They are set conservatively
  and are never unlimited.
- **Not built:** an automatic circuit breaker that stops calling a failing provider. The signal
  "AI circuit breaker" on the Operations page shows the failure rate and is labelled "Not built". The
  controls that exist are the kill switch, the spend ceiling, the attempt cap and the fallback.

## How you might find out

- `/app/admin` Operations, "Operational signals": "AI spend" nears the warning point or the ceiling;
  "AI circuit breaker" warns when at least half of at least five runs in the last hour failed.
- The "AI Gateway spend" card on the same page.
- Audit events `AI_EXTRACTION_FAILED`, `AI_OCR_FAILED`, `AI_CLASSIFICATION_FAILED`,
  `AI_INCONSISTENCY_FAILED` and `AI_EXPLANATION_FAILED` in a cluster.
- Users: AI buttons returning an error, or suggestions that look wrong.
- The provider's status page, an email from the provider, or a spend alert in the provider's console.

## Contain

1. Declare and open the log. A provider outage is SEV3 (the manual path still works). Runaway spend,
   a key that may be exposed, a provider-side data incident, or wrong values being approved are SEV2
   or SEV1.
2. **Stop the spending or the calls at once if in doubt.** On `/app/admin/ai-settings` use
   **Emergency disable**. It takes the active configuration out of service and promotes nothing in its
   place, so the platform runs no AI at all until an administrator activates or rolls back to a
   configuration on purpose. The AI buttons then stop being offered on the documents page (they appear
   only when AI is set up and the person has consented), and the manual path is untouched. (The environment switch `AI_ENABLED` is the second lever, but it needs a redeploy.)
3. **If a key may be exposed,** cancel it in the provider's own console first, then use
   **Revoke key** on the configuration, then follow [secret-compromise.md](./secret-compromise.md).
   The app can only forget a key; it cannot cancel it with the provider.
4. Tell people plainly if the outage lasts: "AI suggestions are paused. You can still enter and
   confirm everything by hand."

## Preserve evidence

Follow the README. For this scenario also keep:

- The audit rows for AI events in the window (`event_type like 'AI_%'`), exported with a SHA-256.
- The "AI Gateway spend" figures and the provider console's usage and billing pages for the same
  period, as screenshots or exports.
- The configuration history on `/app/admin/ai-settings` (which configuration was active, from when,
  who activated or rolled back).

## Assess

Questions to answer in the log:

1. **Is it the provider or us?** Use **Test connection** on the configuration (it makes a harmless
   call). A provider outage fails there too. A rejected key or a changed model name points at us.
2. **How much did it cost, and was that expected?** Compare the in-product spend with the provider's
   bill. A gap means calls the product did not account for, which is a key-exposure signal.
3. **Were any wrong values approved?** Look at `AI_PROPOSAL_ACCEPTED` and `AI_PROPOSAL_CORRECTED`
   events in the window for the affected configuration and decide whether a person should re-check
   those fields. Because people approve every value, the damage is bounded to what people accepted.
4. **Did personal data go somewhere it should not?** If the provider reports an incident on its side,
   find which applicants' documents were sent in the window (the `AI_*_RUN` events list the document
   and applicant) and go to [data-exposure.md](./data-exposure.md).

## Recover

1. If the cause was the provider: after it recovers, **Test connection**, then
   **Run evaluation (13 cases)** to confirm the answers are still sensible, then **Activate** (or
   **Roll back** to the last configuration that passed). Both need a fresh sign-in.
2. If the cause was us (a bad key, a changed model name, a bad prompt): fix it in a **new draft**,
   test it, evaluate it, activate it. Do not edit a live configuration.
3. If a key was revoked: create the replacement draft with the new key first, then activate it.
4. Confirm the "AI spend" and "AI circuit breaker" signals are calm again for an hour before
   closing.

## Notify and escalate

An outage or a spend problem is an operational matter. A provider-side data incident or any use of a
leaked key that touched documents goes through the legal reviewer. If the provider's terms say they
will notify you of incidents, the contact on that account is the person who receives it; make sure it
is someone on the roster.

## After

Postmortem as in the README. Questions: would a circuit breaker have saved money or time (it is not
built)? Is the spend ceiling right for this month? Should the fallback configuration be set, tested
and kept current?
