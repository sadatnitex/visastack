# Component Register — C1 Harbor v2

**60 indexed components.** `FROZEN` = directly inherited from user-selected C1. `PROPOSED` = gated; do not let a coding model independently design it. Components under both labels must not conflate illustration with functional interface.

| ID | Component | Approval class | Source | Contract / critical states |
|---|---|---|---|---|
| C01 | Root canvas | FROZEN | `body.variant1` | White/porcelain canvas; deep ink; never blue marketing fill; **default** |
| C02 | Marketing header | FROZEN | `.topnav` | 78px desktop and 68px mobile; free horizontal layout, not pill container; **default, compact, keyboard** |
| C03 | Brand lockup | FROZEN GEOMETRY / LOGO TBD | `.brand,.mark` | 22px / 760 brand; source 31px icon envelope; use verified asset; **light, dark, small** |
| C04 | Navigation link | FROZEN | `.links,.rightlinks` | 13px / 590; clean baseline; no tile; **default, hover, focus, active** |
| C05 | Hero eyebrow | FROZEN | `.nudge` | 11px / 760, .19em tracking and uppercase; **light, dark** |
| C06 | Hero headline | FROZEN | `.headline` | Clamp, 820 weight, -.073em tracking; centered; final copy review; **desktop, mobile, zoom** |
| C07 | Hero subline | FROZEN | `.subline` | 20px /1.44 /660px; no multi-paragraph sales copy; **desktop, mobile** |
| C08 | Hero primary action | FROZEN | `.pill` | 14px /700; padding 13px 23px, radius 100px; **default, hover, focus, loading, disabled** |
| C09 | Reassurance microcopy | FROZEN | `.meta` | 12px low-emphasis, truthful plain words; **default, compact** |
| C10 | Device stage | FROZEN | `.devices` | Centered max 1140px, height 640px, mobile 560px; **desktop, mobile** |
| C11 | Phone chassis | FROZEN | `.phone,.island` | 335x642px at -2.8deg, source bezel/radii and notch; **desktop, mobile** |
| C12 | Device statusline | FROZEN | `.statusbar` | Source inset, no added fake OS details; **desktop, mobile** |
| C13 | Device segmented tabs | FROZEN | `.segment` | Actual source 3-section rail; labels must represent supported views; **default, selected** |
| C14 | Phone record panel | FROZEN | `.phonepanel` | Source border, shadow dimensions and inset; **default, empty** |
| C15 | Phone file row | FROZEN | `.fileline,.fileinfo,.fileico` | Icon left, facts center, status right; exact densities; **ready, update, processing** |
| C16 | Status tag source | FROZEN / DERIVED SEMANTICS | `.tag` | Keep compact geometry; never call mere upload authenticated; **current, warning, waiting** |
| C17 | Four floating events | FROZEN | `.floatcard,.fc1,.fc2,.fc3,.fc4` | Exactly 4 desktop/2 mobile, source tilt and positions; **action, history, scope, expiry** |
| C18 | Phone bottom nav | FROZEN | `.bottomnav` | Source compact rail; no additional decorative tabs; **selected, inactive** |
| C19 | Dark chapter | FROZEN | `.darkstage` | Harbor stage #0B1A30, full bleed 110px/100px; **desktop, mobile** |
| C20 | Dark intro | FROZEN | `.darkintro,.sectionhead` | 2-column 100px gap; source scale, no centered benefit boxes; **desktop, mobile** |
| C21 | Bento feature | FROZEN | `.bento,.feature` | 1.2/.8, 15px gap, 25px radius, 34px padding; **major, minor** |
| C22 | Angled preview | FROZEN | `.miniui` | Source tilted document micro-preview; **desktop, mobile** |
| C23 | Minimal footer | FROZEN | `.foot` | No inflated sitemap, badges or endorsement strip; **default, mobile** |
| C24 | App-shell navigation | PROPOSED | `none` | No design in landing source; require owner-approved traveler/agency/admin shell; **expanded, collapsed, mobile** |
| C25 | Page title and actions | DERIVED / APPROVAL | `C05-C08 principles` | One purposeful H1, controlled primary action; operational size requires approval; **compact, long, empty** |
| C26 | Breadcrumbs | PROPOSED | `none` | No invented geometry; require route-level approval; **current, overflow** |
| C27 | Command/search input | PROPOSED | `none` | Search actual authorized objects only; visual approval first; **idle, focus, results, no-results, denied** |
| C28 | Text entry | PROPOSED | `none` | Explicit label/help, truthfully saved state; visual approval; **default, focus, error, disabled** |
| C29 | Select/combobox | PROPOSED | `none` | Keyboard and search with scoped real options; **open, selected, empty, error** |
| C30 | Checkbox/radio/switch | PROPOSED | `none` | State semantic, no decorative variants; **on, off, disabled, invalid** |
| C31 | Date/expiry control | PROPOSED | `none` | Absolute dates, locale/time-zone integrity; **editing, invalid, unknown** |
| C32 | Upload zone | PROPOSED | `C15 hierarchy principle` | Never show 'Ready' until validated and attached; **idle, uploading, scanning, success, rejected, failed** |
| C33 | File row large | DERIVED / APPROVAL | `C15` | Document metadata, owner, version, scope, freshness, actions; **current, processing, rejected, expired** |
| C34 | File preview pane | PROPOSED | `none` | No access via public URL; no raw PII in demo; preview rights server enforced; **loaded, loading, forbidden, unsupported** |
| C35 | Document versions | PROPOSED | `none` | Old selected version remains accessible under valid policy; **current, previous, pending-replacement** |
| C36 | Table/data grid | PROPOSED | `none` | Dense agency operations; contextual actions, not KPI cards; **sort, filter, selection, empty, loading, error** |
| C37 | Case progress | PROPOSED | `none` | Separate preparation, review, submission and outcome; never infer approval; **started, preparing, review, recorded-submitted, closed** |
| C38 | Case request item | DERIVED / APPROVAL | `C17 narrative hierarchy` | What, why, who, when, action; scoped to case; **missing, received, needs-correction, reviewed** |
| C39 | Needs-attention feed | PROPOSED | `none` | One deduplicated actionable inbox; **overdue, due, info, resolved** |
| C40 | Timeline/history | PROPOSED | `none` | Exact event time, actor/source, immutable record version; **event, correction, submission-claim** |
| C41 | Side-by-side fact compare | PROPOSED | `none` | Prior/current as-of context; neutral 'needs clarification'; **consistent, change, context, unknown** |
| C42 | Grant/share preview | PROPOSED | `none` | Recipient, exact selected items/versions, scope, expiry, actions; **draft, active, expired, revoked** |
| C43 | Agency request composer | PROPOSED | `none` | Specific item, reason, due date, clarification; **draft, sent, responded, closed** |
| C44 | Drawer/side panel | PROPOSED | `none` | Not a global 40% drawer default; full overlay/focus and route approval; **open, closed, unsaved** |
| C45 | Dialog/confirmation | PROPOSED | `none` | Escapes, focus trap, reversible path; exact geometry requires approval; **confirm, cancel, blocked** |
| C46 | Toast/notification | PROPOSED | `C17 is marketing illustration only` | In-app functional notification style not dictated by hero floatcards; **success, warning, error, undo** |
| C47 | Tabs in app | DERIVED / APPROVAL | `.segment` | Selection cues derive from source, operational sizing must be approved; **selected, hover, keyboard** |
| C48 | Badge in app | DERIVED / APPROVAL | `.tag` | Statuses not decorative; label + accessible color; **neutral, success, warning, danger** |
| C49 | Role and organization switcher | PROPOSED | `none` | Never grant underlying access because of client-side selection; **traveler, agency, admin, unauthorized** |
| C50 | Settings/preferences | PROPOSED | `none` | Legible hierarchy, serious actions isolated; **view, edit, saved, error** |
| C51 | Danger zone | PROPOSED | `none` | Revocation doesn't recall copies; deletion honors actual policy; **confirm, revoked, blocked** |
| C52 | AI suggestion review | PROPOSED | `none` | Proposal distinguished from fact; explicit approval before master write; **suggested, reviewed, rejected, applied** |
| C53 | Export/packet preview | PROPOSED | `none` | Output exactly reflects authorized selected versions; **preview, generated, denied, stale** |
| C54 | Empty state | DERIVED / APPROVAL | `C14 single purpose` | Explain next useful action, not emoji illustration or marketing card; **new, no-results, permission-limited** |
| C55 | Loading/skeleton | PROPOSED | `none` | No fake success and no spinning ornament; stable page geometry; **pending, slow, retry** |
| C56 | Mobile operational navigation | PROPOSED | `.bottomnav only within phone demo` | Source display rail is marketing illustration; auth app nav requires approval; **compact, open, keyboard** |
| C57 | Admin system status | PROPOSED | `none` | Only real monitoring values, distinguish simulated/unknown; **normal, degraded, unknown** |
| C58 | Audit event | PROPOSED | `none` | Actor/object/action/time with authenticated scope; **recorded, redacted, restricted** |
| C59 | Invitation/claim entry | PROPOSED | `none` | No PII in anonymous preview; identity-bound claim; **unclaimed, accepted, expired, wrong-account** |
| C60 | Reusable record group | PROPOSED | `C15 list hierarchy` | Structured sections, current facts, versions and provenance; **available, outdated, conflict** |

## Component registration procedure

A coding agent may *reference* every component but may implement visual modifications only when it is `FROZEN` or explicitly approved by owner with a route-specific screenshot in `approved-extensions/`. `DERIVED` means only the shared design role is usable, not that missing sizes/radii are known. Every missing design value must be inherited from exact C1 selector or receive a separate approved visual artifact; there is no “best judgment” exception.

### Minimum acceptance packet per application component

**Desktop and mobile screens** showing: real-size context, content extremes, focus-visible, error/denied state, keyboard and screen-reader semantics, loading/retry, dark/light boundaries when used; plus screenshot-based baseline, property-token mapping, reference/extension ID, product/security sign-off and owner decision.
