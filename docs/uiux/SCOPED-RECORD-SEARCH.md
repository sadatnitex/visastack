# Scoped record search and truthful toolbar state

CF-02 implementation checkpoint, 2026-10-11. This additive read model preserves canonical records and existing owner, current-grant, active-membership and case-assignment boundaries. It is not a full-text document index or a new authorization authority.

## Exact supported scope

- Personal context: owned person display names, owned case titles and wallet-visible document names. A selected person narrows all three categories to that owned person. Each category returns at most six results. Case-only contributor files remain outside wallet search.
- Agency context: case titles and client names on current accepted, started, unexpired grants for an active organization. Owners/admins use the existing organization case scope; other active members see only assigned cases. Current membership and assignment predicates are included in the result query. Client results open an accessible case, never an owner-only profile. Agency document search is not implemented or advertised.
- Platform context: the administrator's own personal records only. The header labels this scope explicitly. It does not search other accounts or bypass concern permissions.
- Unknown or inaccessible contexts refuse access. Refusals and request failures are not successful empty-search states.

Queries match literal substrings. Percent and underscore characters are escaped rather than acting as wildcards. Only names/titles are read. No fact values, passport numbers, document text, storage keys, decrypted values, provider secrets or cross-tenant results are indexed or returned. Result links point to existing real destinations; wallet document results target a real document anchor.

## Request and interaction limits

The same-origin authenticated POST endpoint bounds the body to 4096 bytes and the query to 2-80 characters. Terms stay out of URLs and the response uses private, no-store caching. Its atomic account search bucket starts at 60 requests per minute, an unmeasured operational default. The client debounces requests by 250ms, aborts obsolete requests, and remounts search on context changes. Arrow keys move between input/results, Enter follows a normal link, and Escape closes search. Mobile search has a controlled panel rather than wrapped desktop controls.

## Saved toolbar state

Unread status counts all actually-sent unread in-app notifications for the current account, including notices beyond the first list page. Queued notices, email and other accounts are excluded. The existing read action revalidates the shared layout. This is saved state, not a new real-time notification service.

Plan labels use the recorded traveller plan and current subscriptions of active memberships. The Founding Access badge appears only for that actual organization plan key. Missing plan data links to plan information rather than fabricating an offer or usage figure. Help opens service status. The account menu preserves settings, workspace access and the selected-provider sign-out form.

## Acceptance boundary

Six isolated search tests, two saved-state tests and focused endpoint/shell/component tests exercise real source and synthetic local records. These are not provider-backed account journeys, real inbox tests or authenticated PDF screenshot acceptance. Full package checks, principal-screen comparisons and isolated staging journeys remain separate requirements.
