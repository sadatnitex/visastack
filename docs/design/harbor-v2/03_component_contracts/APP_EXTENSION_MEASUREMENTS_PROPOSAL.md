# Application Components — Precision Proposal for Owner Signoff

**Status: PROPOSED, NOT FROZEN.** These exact measurements close the otherwise undefined spaces in the C1 landing-page reference for authenticated traveler/agency/admin software. They are provided so a coding model will **not** fill gaps with default styling. They MUST be checked visually and approved as screens, and may be revised before adoption; the frozen landing C1 properties remain untouched.

## Shared architecture (application, not marketing)

| Primitive | Proposed deterministic contract | C1 continuity |
|---|---|---|
| Font | `-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`; no external fonts | Exact font stack |
| Top application bar | 64px height, white background, 1px bottom divider | Quiet header hierarchy; app-specific size is proposed |
| Desktop side navigation | 228px expanded, 64px collapsed; white surface; 1px divider | Controlled navigation, not C1 marketing 78px header |
| App content frame | `max-width:1320px`, horizontal 32px at desktop; 18px below 760px | Reuses source 1320px cap and 18px mobile |
| Main app heading | 34px / weight 790 / line-height 1.06 / tracking −0.055em; mobile 28px | C1 tight/heavy typography in operational scale |
| App section heading | 21px / 760 / 1.18 / tracking −0.04em | Distinct from source marketing heading |
| Body | 14px / 400 / 1.5; important lead 16px / 1.5 | C1 subline/body density adapted to data |
| Metadata | 12px / 400 / 1.4; 11px tracked all-caps only where structural | C1 .meta, .nudge roles |
| Grid rhythm | `4, 8, 12, 16, 24, 32, 48px` only; 16px normal gap | Proposed rhythm based on source 13/15/16/18/34px anchors, normalized for app |
| Primary app button | 40px min-height, 14px/700, horizontal padding 18px, capsule radius 100px | Retains C1 capsule language; shorter operational padding requires approval |
| Secondary button | 40px; 1px border `stroke.default`, white background, same typography | Proportional counterpart to C1 CTA |
| Tertiary button | 40px; ink text only, no decorative tile | C1 hierarchy principle |
| Form input | min-height 44px, 13px body, radius 10px, 1px `stroke.default`; 12px/690 label | C1 segmented 10px; operational form field new |
| App panel | 17px radius, white, 1px subtle border; no mandatory box shadow | Derived from `.phonepanel` 17px; larger-scale use requires approval |
| Slim list row | Minimum 52px; 12px inline gap; 14px vertical / 16px horizontal padding | `.fileline` compact row logic |
| Document preview | At most 420px wide as optional contextual side panel; 1px boundary | New layout, approved only per route |
| Table | 44px heading row, minimum 52px data row, left-aligned 13px data and clear sortable header | Agency data precision, not another metric card grid |
| Navigation selected | `selection.bg` and 2px accent left border; text ink; not a branded solid-blue tile | Quiet accent philosophy |
| Compact status | 11px/720, 6px radius, 6px 8px padding; descriptive label + icon when needed | C1 `.tag` compactness |
| Event/toast | max-width 340px, 13px radius, concise action; placement must avoid masking form controls | Inspired by C1 13px event geometry; NOT reuse hero float positions |
| Drawer / dialog | Only after route-approved screenshot; no default fixed width or center animation | C1 cannot define it |
| Mobile app shell | 390px QA target; no horizontal scroll; task-first panel collapse with persistent action access | C1 mobile-first viewport discipline |

## Critical interaction states — must be visually resolved before app release

| Object | Exact state distinctions and labels | Forbidden conflation |
|---|---|---|
| Wallet file | Uploading → processing/scanning → received → reviewed or needs correction; current version and used-in-case are separate attributes | `Uploaded = verified` or `received = approved` |
| Case | Draft / collecting evidence / review / recorded submitted / completed or closed | Progress percent implies visa approval |
| Task | Due date present vs unknown; overdue vs soon vs resolved | Orange label without a deadline or source |
| Sharing | Draft preview / permission active / expired / revoked; selected records/versions and exact recipient visible | `Revoke = erase downloaded copies` |
| Version | Current document version / historical version / pending replacement | Silently overwriting earlier declaration |
| AI extraction | Proposed / awaiting human review / confirmed / rejected | AI output writing truth to master profile |
| Admin service | Connected / degraded / unknown / not tested | Green check for configured-but-not-proven provider |

## Approval workflow

C1/Harbor already defines the color and marketing presentation. New **application** measurements above are intentionally explicit to reduce AI latitude, but are **not** proof of excellent design. The owner must review and sign off at least one representative traveler, document, agency and admin screen at desktop + mobile before the token family is promoted to `OWNER-EXTENSION`. Add approved screenshots/hash and protect in regression tests. Coding agents must not treat this candidate file as blanket approval to transform every screen.
