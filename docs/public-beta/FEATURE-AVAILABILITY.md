# Current feature evidence

These are evidence classifications from the frozen baseline and the targeted changes. They are not permission switches. Readiness configuration alone is not proof of a complete user journey.

| Capability / role | Classification | Evidence and remaining proof |
| --- | --- | --- |
| Signup, confirmation, sign-in, recovery / traveller | IMPLEMENTED_UNVERIFIED | Neon forms/actions and tests exist; Auth endpoint reachable; owner reports live signup/sign-in, not independently exercised here |
| Public navigation, workspace logout, denial identity / visitor and account | PARTIALLY_CONNECTED | Three WorkOS wiring defects repaired and regression-tested locally; signed-in browser/logout acceptance still owed |
| Legacy pilot-account continuity / existing account | PARTIALLY_CONNECTED | accounts-neon.ts links verified matching email; stronger original-identity recovery required by owner directive |
| Staff assurance / administrator | SAFETY_DEPENDENCY_UNSATISFIED | Managed Neon MFA support and actual staff assurance remain unverified |
| Profile, missions, snapshots and consent / traveller | IMPLEMENTED_UNVERIFIED | Existing service/UI paths and baseline tests; no complete authenticated browser journey in this task |
| Scoped agency collaboration / agency and traveller | IMPLEMENTED_UNVERIFIED | Existing policy/grant/service paths; live cross-party acceptance not executed |
| Original/redacted downloads / permitted owner or grantee | PARTIALLY_CONNECTED | Existing registry disables complete user paths; permission distinction must remain intact |
| Real sensitive-document intake / all roles | SAFETY_DEPENDENCY_UNSATISFIED | Live scanner, key governance, independent file backup, isolated restore and external review remain requirements |
| Transactional delivery / accounts and agencies | IMPLEMENTED_UNVERIFIED | Resend adapter/key/sender configuration exists; actual SMTP, sender verification, delivery and webhooks not tested |
| AI extraction/OCR / consenting traveller | IMPLEMENTED_UNVERIFIED | Existing provider gateway and human-review paths; actual configured provider state not inspected |
| Complimentary agency/traveller entitlements | PARTIALLY_CONNECTED | Existing plans/subscriptions remain; no-plan and commercial coupling require PR-03 audit |
| Scheduled reminders and recovery workers | IMPLEMENTED_UNVERIFIED | Existing durable jobs and cron paths; timing, outage and live retry proof owed |
| Bangla translation expansion | INTENTIONALLY_DEFERRED | Owner's standing decision; preserve current i18n |

Database connectivity and migration status are verified for this cloud environment only. No capability is labeled VERIFIED_LIVE or VERIFIED_STAGING based on an unsigned-in page, a mock, or historical evidence.
