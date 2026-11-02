# UMPE hard acceptance and launch-readiness gates

**Purpose:** a high-quality feature implementation can exist without verified production configuration, complete official-content coverage or permission to process real passports. Treat those as distinct facts. No forced pilot narrative; current owner direction is a commercially useful product. Do not falsify readiness or disable protections for velocity.

## Four evidence levels

1. `CODE_READY`: code compiles, targeted and negative tests pass at exact SHA, migrations backward-compatible, review completed.
2. `INTEGRATION_READY`: independent lanes merged in correct sequence; full repo check, exact internal APIs and role-based synthetic E2E pass.
3. `DEPLOYED_VERIFIED`: live/test deployment exact commit verified, relevant browser workflows work, providers respond as expected and application state is honest.
4. `OPERATIONALLY_READY_FOR_REAL_DATA`: deployment, file protections, access controls, retention, legal/privacy/consent and provider configuration have evidence and any separately required owner approval. **Never equate the first three with this fourth.**

## Required J1-J8 journeys

| Journey | Required demonstrated behaviour | Negative proof |
|---|---|---|
| J1 Unsorted individual import | 80+ mixed files + nested folders, bounded statuses, resume, classification and source-backed profile proposals | file 21 not dropped, no wrong-person assignment, no silent approved facts, unsupported file rejected honestly |
| J2 Purpose-specific trip and family | valid source-verified route, mandatory/recommended/alternatives, each participant distinct, common authorized booking | wrong-route no green, unauthorized adult or child relationship no access, mandatory exclusion not satisfied |
| J3 Continuity | new statement/passport/fact/rule changes only affected active packages, visible action and history | past issued/submitted snapshot never silently rewritten/shared |
| J4 Agency -> existing user | agency chooses country/route/date/purpose, reviews exact issued checklist, private email/link, user signs in, approves chosen exact evidence, agency sees receipt/review | forwarded/wrong-email/revoked link refused, no entire-vault grant, no fake 'WhatsApp sent' |
| J5 Agency -> guest | trusted brand neutral page, request proof, 80+ documents over sessions, automatic checklist mapping, submit, correction/replacement and immutable receipt without account | no fake account/profile, no guest draft leak, wrong org/request/expired session denied |
| J6 Saturday official sources | time-zone-correct scheduled source fetch, content changes, review proposal, reviewer publication, affected-case notice | HTML cosmetic change not mandatory law; unavailable source not verified; AI cannot self-publish |
| J7 Field outcomes | 2 external attempts, different evidence and decisions, correct provenance + suppression; unknown denominator | user self-report not labelled government verified, small cohort not exposed, no causal approval prediction |
| J8 Preservation and operations | old manual, advanced roles, AI-off, billing, sharing, deletion/restore, historic packs and full accessible UX | denied tenant/user/guest access; no scanner success without proof; tested rollback or forward-fix plan |

## Technical/no-loss gate

- All 87 ledger IDs have disposition and proof; code/content/ops failures are separated. Missing editorial coverage blocks the relevant route, not the entire unrelated functionality. No unverified route gets officially-ready status.
- Old published manifests verify with same exact checksum; old snapshots still replay; schema migration additive and reproducible from clean DB and existing DB fixture. No two ledger entries claim same database migration.
- All mutations audited by existing pattern. Every new applicant/guest/agency file route has negative access tests and retention/erasure semantics. Protected AI only with consent and task scope. Existing R2 private storage and scan truth remain intact.
- Existing owner/account settings, grants/per-case exclusions, exports, AI admin/model switch, agency cases, communications, payment settings, notification sweeps and legal deletion continue passing regression.
- Mobile, keyboard, screen-reader semantics and 200% zoom tested. No broken old URL or invisible advanced function. No person forced through full profile to upload or respond.
- Performance captured rather than guessed: 80-file import result accounting, queue concurrency and failures, upload size ceilings, OCR/AI run cost per file, p95 latency under synthetic fixtures, scheduler run resource cost, email delivery status. Alert and cancellation/backpressure mechanisms documented.
- CI green on exact final SHA and independent review evidence. Real deployment existence and same SHA must be verified; this kit author could not independently access connected Vercel account in the prior audit.

## Product and privacy gate

- Mandatory vs good-to-have visibly and semantically distinct; alternative evidence and conditional applicability work; mixed-nationality family correct; verified source effective date and reviewed date not conflated.
- User modifications never secretly edit authoritative pack; guest submission creates agency evidence only; outcome analytics separate from official visa authority. Consent, deletion, access and historical truth survive each workflow.
- Commercial pricing/payment/product entitlements remain whatever current code implements; UMPE does not authorize changing price or charging consumers. Test billing unaffected.
- Required owner activations listed as discrete tasks with purpose, risk and exact verification step; do not bury them in an unqualified 'done' status.

## Release verdict template

**HEAD / Deploy SHA:** ... / ...
**Code-ready units:** ... of 15, with evidence
**Integrated user journeys:** J1 ... J8 with direct test links
**Official-route content:** verified ... ; partial ... ; unsupported ... (source/date/reviewer list)
**Actual runtime:** auth ... email ... document processing ... safety ... guest proof ... source monitor ... outcome controls ...
**Preservation:** passing regression ... ; exceptions ...
**Measured cost/performance:** ... ; unmeasured ...
**Residual material risks:** ...
**Owner-dependent operational actions:** ...
**Verdict:** `NOT READY` / `FEATURE COMPLETE IN TEST` / `DEPLOYED AND VERIFIED` / `OPERATIONALLY READY FOR APPROVED REAL DATA` (choose only defensible status).
