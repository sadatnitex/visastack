# Interaction and state matrix

| Experience | Existing states and controls | Verification |
| --- | --- | --- |
| Identity | Sign-up, notices, verification, sign-in, recovery, reauthentication; server validation and error messages | Existing identity and public-browser suites; no auth architecture change |
| Navigation | Current route, role-filtered sections, small-screen More panel, Escape and focus return | Existing navigation unit/browser checks plus actual React fixture interaction |
| Profile | Search, blank/declared/confirmed/stale/conflicted values; repeated records, saving, field failures, assurance | Existing profile/service tests; actual component fixture rendering |
| Documents | Upload, checking, review, ready, rejected/failed, expiry, retries and consent limits | Existing document/service tests; unsafe-preview regression and actual selection interaction |
| Sharing | None, pending acceptance, active, paused, expired, revoked; scope review and confirmation | Existing grant/service tests; actual grant-form fixture |
| Case | Empty/manual/source-backed; missing, unknown, not applicable, awaiting review; acknowledgement and snapshot | Existing case/service tests; visual fixture is not live case acceptance |
| Agency | No membership, member/admin, unavailable collaboration; clients/cases/team/plan/settings | Existing authorized page tests and layouts |
| Platform | Role denial, unavailable provider, retry backlog, privacy/legal hold, audit and rules governance | Existing platform page/service tests and layouts |
| System | Loading, error, unknown route, session expiry, offline/interrupted operation | Existing loading, error, resilience and public browser tests |

Hover, pressed, selected, disabled and explicit outline focus states are shared. Disabled controls retain readable opaque text. Existing live regions, field-level errors, retry and submission feedback remain. No simulated server persistence is used in production. Test fixture action stubs report no saved data or granted access.

Document search: matching authorized names update the selectable metadata, no matches explain how to clear/retry, and no preview form or document bytes appear for an empty result. Clearing restores the original authorized selection list. Quarantine retains its existing danger tone. Public registration-open copy is driven by the existing flag in every affected home section, with the real-applicant restriction retained.
