# Route map: current pages to Harbor R01-R30

WP-A0, read-only. Main SHA `84cc84ef18b3486c09c6537c25ecaed51539d499` (same as the planning reference `84cc84e`). Source: every `page.tsx` under `apps/web/src/app` (63 pages) and `docs/design/harbor-v2/04_route_contracts/ROUTE_REGISTER.md`.

Harbor's own note applies: its R rows are product surfaces, not pathnames. Only R01 has a frozen visual. Every other row is PROPOSED in Harbor and gets colour only (WP-C1) unless an approved preview exists.

## Harbor rows to current pages

| Harbor | Surface | Current page(s) | Fit | Package that touches it |
| --- | --- | --- | --- | --- |
| R01 | Public homepage | `/` | Exists, different design | WP-L1, WP-V6 (L2) |
| R02 | Product explanation | No page. Section `#product` on `/` (D3) | Section only | none (R02-R04 redesign out of scope) |
| R03 | For agencies | No page. Section `#for-agencies` on `/` (D3) | Section only | none |
| R04 | Trust and privacy details | `/trust`, `/trust/[packKey]` | Exists | WP-C1 colour only |
| R05 | Sign up, sign in, recovery | `/auth/sign-up`, `/auth/sign-in`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/account-recovery`, `/auth/reauth`, plus the `callback` route | Exists | WP-C1, WP-P0, WP-V1 |
| R06 | Account and context switcher | No page. Shell: `app/app/app-nav.tsx`, `workspace-shell.tsx`, `workspace-record-toolbar.tsx`; agency picker `/app/agency` | Partial | WP-X3 |
| R07 | Traveller home and attention | `/app`, `/app/applicant/[id]` | Exists (home computes a setup list and attention items) | WP-V3, WP-V4 |
| R08 | Personal record | `/app/applicant/[id]/profile` | Exists | WP-V3 |
| R09 | Passports and identity | No own page. Inside `/app/applicant/[id]/profile` and `/documents` | Partial | WP-V3 |
| R10 | Travel and application history | `/app/applicant/[id]/history` (fact version trail), `/app/applicant/[id]/missions` | Partial | WP-V3 |
| R11 | Wallet and documents | `/app/applicant/[id]/documents`, `/app/applicant/[id]/evidence` | Exists | WP-V3 |
| R12 | Case list, start and reuse | `/app/applicant/[id]/missions`, `/app/applicants` | Partial (no reuse) | WP-V4 |
| R13 | Individual case | `/app/mission/[id]`, `/app/mission/[id]/snapshots/[snapshotId]` | Exists | WP-X1, WP-V4 |
| R14 | Agency requests and resumable intake | `/app/client-invitations/accept`, `/invitation`, `/app/contributor-requests/accept`, `/app/applicant/[id]/evidence` | Partial | WP-V1, WP-V4 |
| R15 | Change impact and consistency | No page. Change notice inside `/app/mission/[id]` (`isDirty`) | Missing | WP-V2, WP-V3 |
| R16 | Application memory | `/app/mission/[id]/snapshots/[snapshotId]`, `/app/applicant/[id]/history` | Partial | WP-V3 |
| R17 | Needs Attention | `/app/notifications`, `/app/applicant/[id]/expiry`, attention block on `/app` | Partial (not one inbox) | WP-V4 |
| R18 | Sharing and access | `/app/applicant/[id]/sharing`, `/app/shared`, `/app/shared/[grantId]`, `/app/sharing-invitations/accept` | Exists | WP-X2 |
| R19 | Handover, trip essentials, context export | No page | Missing | WP-V5 |
| R20 | Agency overview | `/app/agency/[orgId]` | Exists | WP-C1, WP-V4 |
| R21 | Agency clients | `/app/agency/[orgId]/clients` | Exists | WP-C1 |
| R22 | Agency case detail | `/app/agency/[orgId]/cases`, `/app/mission/[id]` in agency context | Exists | WP-V4 |
| R23 | Agency intake and invitation | Invite form on `/app/agency/[orgId]/clients` (`createClientInvitation`) | Exists, not recipient-bound | WP-V1 |
| R24 | Agency evidence review | `/app/mission/[id]` agency view, `/app/agency/[orgId]` request list | Exists | WP-V4 |
| R25 | Agency team and membership | `/app/agency/[orgId]/team`, `/app/invitations/accept` | Exists | WP-C1 |
| R26 | Agency activity and audit | `/app/agency/[orgId]/activity` | Exists | WP-C1 |
| R27 | Administrator overview | `/app/admin` | Exists | WP-C1 |
| R28 | Administrator provider and AI settings | `/app/admin/ai-settings` | Exists | WP-C1 |
| R29 | Administrator users, organisations, security | `/app/admin/access`, `/audit`, `/complaints`, `/members`, `/organizations`, `/organizations/[orgId]`, `/privacy`, `/security`, `/settings` | Exists | WP-C1 |
| R30 | Utility and legal | `/privacy`, `/terms`, `/status`, `/pilot-access-denied`, `/app/help`, `/app/account`, `/app/privacy`, `/app/notifications`, `not-found.tsx`, `error.tsx`, `global-error.tsx` | Exists | WP-C1 |

## Current pages with no Harbor row

These keep their layout and get colour only (WP-C1). No package redesigns them.

| Page | What it is |
| --- | --- |
| `/app/countries`, `/app/countries/[iso2]` | Country reference sheets (added after Harbor was written) |
| `/app/agency/[orgId]/countries`, `/app/agency/[orgId]/countries/[iso2]` | Same sheets inside an agency workspace |
| `/app/agency/[orgId]/plan` | Agency plan and usage |
| `/app/agency/[orgId]/settings` | Agency branding (logo, accent, live preview) |
| `/app/admin/packs`, `/app/admin/packs/[packId]`, `/app/admin/packs/[packId]/diff` | Requirement pack administration |

## Landing comparison (R01)

Screenshots: `previews/landing/current-live-build-<width>.jpg` (current landing) and `previews/landing/before-harbor-<width>.jpg` (Harbor C1) at 1440, 1024, 768, 390 and 360.

"Current" is a local production build of main at `84cc84e`, not the live site: the live domain refused this container's network (proxy 403), so the live page was not captured. The local build ran in invite-only mode, so its availability pill reads "Invite-only pilot"; production may read "Public beta".

| Area | Current landing | Harbor C1 |
| --- | --- | --- |
| Colour | Teal and cream | Harbor blue on white, dark navy feature stage |
| Headline type | Serif italic second line, Inter body | System font stack, very heavy weight (D2 split approved) |
| Hero layout | Left text, right example card with checklist and two floating panels | Centred text, rotated phone with four floating cards |
| Navigation | Features, For agencies, Public trust, How it works, theme switch, Sign in | Product, For agencies, Privacy and control, How it works, Sign in, Explore (D3 fixes destinations) |
| Calls to action | "Sign in to get started" and "See what works today" | "Get started" and "Explore VisaStack" |
| Availability | Pill above headline plus a top banner | None in Harbor (must be kept: CR07, CL14) |
| Length | Nine sections: problem, how it works, what you can do, who it is for, trust, road ahead, final call | Hero plus one four-card section and footer |
| Honesty content | Road ahead, trust promises, status links | None (kept as `EXISTING-PRESERVED` under CR07) |
| Phone width | No sideways scroll from 320 to 1440 | Sideways scroll at 768 (783px) and 360 (379px); floats cover the phone text at 1024, 768, 390 and 360 |

## Harbor source defects found (D4 corrections)

Measured by `scripts/programme/measure-landing-preview.cjs` on `05_visual_previews/C1_HARBOR_HOMEPAGE.html`:

| Width | Sideways scroll | Floats over phone text | Caption over phone | Phone menu |
| --- | --- | --- | --- | --- |
| 1440 | none | none | no | not needed |
| 1024 | none | fc1, fc4 | no | none |
| 768 | 783px | fc1-fc4 | yes | none |
| 390 | none | fc1, fc2 | yes | none |
| 360 | 379px | fc1, fc2 | yes | none |

The corrected preview (`previews/landing-preview-corrected.html`) removes the sideways scroll at 768 and 360, stacks the floats under the phone at 900px and below, moves the caption under the phone, and adds a phone menu with the four site links and Sign in. At 901-1100px fc1 and fc4 move outward by the smallest step (D15), so nothing covers the phone at 1024. 1440 is unchanged. Results: `previews/landing/measurements.txt`.
