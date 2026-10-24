# VisaStack Route & Journey Contract — Harbor Blue v2

**Important:** These are product surfaces, **not verified production pathnames**. The code agent must map each to existing routes/components before editing. R01 is the only `FROZEN` visual page. Every other row requires a high-fidelity accepted baseline, not an agent-generated dashboard.

| ID | Surface | Audience | Visual approval | Work / content ownership |
|---|---|---|---|---|
| R01 | Public homepage | PUBLIC | FROZEN | Hero to real signup; display honest product abilities; non-PII demo fixtures |
| R02 | Product explanation | PUBLIC | PROPOSED | Explain reusable records, case preparation, selected sharing |
| R03 | For agencies | PUBLIC | PROPOSED | Describe request intake, case work and actual agency scope |
| R04 | Trust/privacy details | PUBLIC | PROPOSED | Exact control/scope/grant/revocation/retention descriptions |
| R05 | Auth signup/signin/recovery | AUTH | PROPOSED | Real Neon Auth flow; role selection does not grant agency rights |
| R06 | Account/context switcher | APP | PROPOSED | Show available account capacities only after server authorization |
| R07 | Traveler home and attention | TRAVELER | PROPOSED | One important next action, active case continuity, precise tasks |
| R08 | My profile / personal record | TRAVELER | PROPOSED | Owner-confimable facts; provenance/version and as-of date |
| R09 | Passports & identity | TRAVELER | PROPOSED | Identity documents as repeating records, not a single mutable field |
| R10 | Travel/application history | TRAVELER | PROPOSED | History with exact prepared/acknowledged/reported submission distinctions |
| R11 | Wallet/documents | TRAVELER | PROPOSED | Find versions, preview, attach to case, replace safely |
| R12 | Case list and start/reuse | TRAVELER | PROPOSED | Case initiation without recreating whole profile; reuse selected candidates |
| R13 | Individual case | TRAVELER | PROPOSED | Requirements/action/selected evidence/version; not visa outcome promise |
| R14 | Agency requests / resumable intake | TRAVELER | PROPOSED | Authenticated case-bound request fulfilment with real save/resume |
| R15 | Change impact and consistency | TRAVELER | PROPOSED | Separate date/context differences from incompatible facts; neutral copy |
| R16 | Application memory | TRAVELER | PROPOSED | Exact prepared/history snapshots and selected comparisons |
| R17 | Needs Attention | TRAVELER | PROPOSED | Deduplicated tasks, dates/expiry, case impacts |
| R18 | Sharing and access | TRAVELER | PROPOSED | Recipient+scope+versions+deadline and revocation, no unlimited access |
| R19 | Handover, trip essentials, context export | TRAVELER | PROPOSED | Preview exactly included fields and files, redact by default |
| R20 | Agency overview | AGENCY | PROPOSED | Exception-first operational queue, cases and evidence requests |
| R21 | Agency clients | AGENCY | PROPOSED | Only agency-authorized case subjects with proper list scope |
| R22 | Agency case detail | AGENCY | PROPOSED | Assigned work/requests/review within exact scope |
| R23 | Agency intake/invitation | AGENCY | PROPOSED | Recipient-bound invite; token is not a record access key |
| R24 | Agency evidence review | AGENCY | PROPOSED | Review and request corrections with provenance |
| R25 | Agency team/membership | AGENCY | PROPOSED | Role management, tenant isolation, no wallet inference |
| R26 | Agency activity/audit | AGENCY | PROPOSED | Actor, case, event with scoped visibility |
| R27 | Administrator overview | ADMIN | PROPOSED | Real operational health, exceptions and permissions |
| R28 | Administrator provider/AI settings | ADMIN | PROPOSED | Approved provider abstraction, budgets/limits, secure keys |
| R29 | Administrator users/org/security | ADMIN | PROPOSED | Scoped account controls, no PII browse by default |
| R30 | All utility/legal pages | PUBLIC/APP | PROPOSED | 404,403,500,consent,terms,privacy,notifications,settings |

## U01–U10 experience mapping (not a deployment claim)

| Approved product upgrade | Critical surfaces | Visual behavior that must not misstate the workflow |
|---|---|---|
| U01 Organize and find personal record | R07–R11 | Real current fact/document and version, contextual actions, no invented authenticity |
| U02 Prepare again | R12, R13 | Reuse candidate ≠ automatically accepted; three states reusable/refresh/missing |
| U03 Needs Attention | R07, R17 | Deduplicated direct actions, missing date = unknown, not guessed |
| U04 Change impact | R08, R09, R15 | Changed master record shows affected selected cases; frozen history untouched |
| U05 Explainable consistency | R15 | Date/subject/context aware, human clarification before assertions |
| U06 Application Memory | R10, R16 | Exact snapshot/reported-submission distinction; no retroactive rewrite |
| U07 Resumable agency intake | R14, R23 | Auth-bound acceptance, protected uploads, no bearer-link access |
| U08 Selected handover | R18, R19 | Preview only selected authorized content and versions |
| U09 Trip essentials | R19 | Supplied selected items only; no imaginary itinerary/insurance |
| U10 AI context export | R19, R28 | Redacted-by-default explicit selected preview; no new hidden connectors |

Source: prior user-approved upgrade contract `upgrade.v1.1.md`. Implementation status **unknown** until current repo inspection. Route mapping is an operating brief, not a current feature audit.

## Route-by-route visual signoff packet

For each route: current production capture; proposed desktop @1440, tablet @1024/768, mobile @390; story of primary job; component IDs; source selectors / owner-signed extension IDs; relevant extreme content and keyboard/error/denied states; list of backend interfaces that must not change; before-after screenshot diff; QA report; owner signature and date. Once signed, store pixel baseline + hash. Anything lacking this packet is not visually approved, irrespective of model claims.

## App geometry compatibility rules

- Do not blindly install marketing hero `97px` headings in the app.
- Do not make C1 hero `.floatcard` the system toast or transform every record into floating cards.
- Do not confuse a visa **case** with a new underlying data entity if the product uses `Mission` canonically.
- Show only user-authorized records; client-side roles/colors do not grant permissions.
- Design boundaries should reflect authentic tasks: selecting files, reviewing access, explaining changes, managing cases, not vendor-flavored dashboard conventions.
