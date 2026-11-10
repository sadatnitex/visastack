# P7 / P8 split (lead, drafted before P6 lands; finalize names from the P6 hand-back)

Common base: main after P6 merge + migrate 0117. Both use P6's request, revision and link services and the `/collect` cookie exchange. Both behind the same `AGENCY_COLLECTION_REQUESTS` switch.

## P8 (Lane D) guest proof, branch umpe/p8-guest-proof
- Owns `apps/web/src/app/collect/**` landing and guest pages, and new services `umpe-guest-*` / `guest-collection-*`.
- Landing (after cookie exchange): agency-branded desk (ACTIVE agencies only, existing agency-brand helper, restrained Powered by VisaStack), two choices: "Sign In to Respond" -> `/collect/account` (built by P7) and "Continue Without an Account".
- Guest proof: 6-digit email code to the link's recipient email hint only (no free-entry email; if the link has no email hint, guest path unavailable with a plain line to ask the agency). Code hashed, 10 min expiry, 5 attempts, per-link and per-IP limits, sent through the existing outbox with a new event type. No account or applicant rows ever.
- Guest session: request-scoped, httpOnly Secure SameSite=Lax cookie, short life (for example 30 min idle, 12 h max), rotate on verification, revoke with link/request; resume from another device by fresh code.
- Retention choice (owner 2 Nov): at submission the guest picks 3, 7, 15, 30, 60, 90 or 180 days after the request closes; no preselected value; stored on the guest submission; legal holds override; purge job removes bytes and rows (daily job slot, cron lockstep files leased to P8 when P9 adds uploads; in P8 only store the choice).
- P8 shows the issued checklist (necessity labels, any-one-of groups, agency items labelled as agency) to the verified guest only. Uploads are P9.
- Access ratchet: guest tables join the P6 collection-table set or a parallel request-scoped gate type.
- Schema slot: TEMP migration; lead regenerates in merge order.

## P7 (Lane C2) account reuse, branch umpe/p7-account-response
- Owns `apps/web/src/app/collect/account/**` and services `umpe-collection-response-*`.
- Signed-in traveller (existing Neon Auth session; if not signed in, sign-in/sign-up returns to the same request via the existing return-path mechanism). If the link carries an email hint, the signed-in account email must match (reuse `isIntendedRecipient` semantics; wrong account gets the same neutral refusal, audited once). Opening the link grants nothing.
- Choose own person (owner or authorized managed profile through `requireAccess`), see the exact issued checklist with existing matching evidence proposed (exact document versions and confirmed facts), approve selections, and submit: creates an immutable response record (request revision id, applicant id, exact document version ids, consent text version, timestamp) and grants the agency access to ONLY those versions using the narrowest existing sharing mechanism (investigate ADR 0017 per-case sharing exceptions and document-level grant scope; if the existing model cannot scope to exact versions, stop and report with options, do not broaden).
- No silent whole-vault share; no auto-created case unless the traveller explicitly chooses to start one; later file changes never alter the submitted response.
- Schema slot: TEMP migration; lead regenerates in merge order.
- Must keep all existing client-invitation tests green; do not edit client-invitations.ts except through a reviewed lease if truly required.

## Both
Reviews: /code-review max and /security-review; full check by lead; switch stays off in production until P9 lands and the owner says go.

## Anti-rework rules (owner, 2 Nov: no wasted tokens, conflicts, reruns or rework)
- Before hand-back every lane runs: web build; a11y-forms, title-case, vocabulary and parity guards for touched screens; no timing-dependent tests.
- File ownership is exclusive. P8 owns `apps/web/src/app/collect/page.tsx` and every shared file it needs (notifications event union, invitation-email, email-design, rate-limit). P7 adds NO notification event or rate limit; if it needs one it asks the lead, who adds it after P8 merges. P7 touches only `apps/web/src/app/collect/account/**` and its own `umpe-collection-response-*` services.
- `packages/services/src/index.ts`: each lane appends its own export lines in a block headed by a comment naming the lane; the second lane to merge resolves the append-only conflict by keeping both blocks.
- Migrations: TEMP migration as the last commit; the lead regenerates once at merge in order P8 then P7.
- Merge order: P8 first (it owns the landing that links to P7), then P7 after merging main.
- (added after P1) Lanes that change packages/services or packages/db must also run the adapters suite and the web suite files that load services with a stand-in (`apps/web/src/app/api/health/ready`, `apps/web/src/lib/session-neon.test.ts`) or simply the full web vitest; never read the schema at module load (build column sets lazily).
