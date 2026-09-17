# Commercial V1 Assumptions and Blockers

## Blocker 1: governing PRD file (RESOLVED)

Part 1 Section 1 of the governing directive (`docs/roadmap/commercial-v1-implementation-directive.md`)
names `docs/product/commercial-v1-prd-2026-09-16.md` as the single authoritative
product specification, pinned to a SHA-256 hash, with an explicit instruction to
stop and report rather than reconstruct or paraphrase the PRD from memory if it
is missing or the hash does not match.

The file was initially not present in the repository (confirmed by direct path
check, full-repository text search for the filename, and a search for the hash
prefix; all found nothing). This was reported to the product owner as a stop
condition rather than proceeding on a guess.

The product owner then supplied the file directly. Its SHA-256, computed with
`sha256sum`, is `5eeb15438799d89db9122ff050f15d96139f8e94d373e3b5ba9ea406a1c21575`,
an exact character-for-character match to the hash pinned in Part 1 Section 1.
Correction to the record: an earlier draft of this file claimed that pinned
hash string was 65 hex characters and therefore could not be a valid SHA-256
digest. That was a manual miscounting error made while eyeballing the string in
the directive text, not a property of the actual hash; `sha256sum`'s own output
is (as it must always be) exactly 64 hex characters, and it matches. Retracted.

The PRD is committed at `docs/product/commercial-v1-prd-2026-09-16.md`. Part 1
proceeds on it as the authoritative specification, per the directive's own
authority order (Section 1): explicit user instruction, then this PRD, then
approved implementation decisions, then retained architecture/security
invariants, then older PRDs as historical context only.

## Decision required: staff MFA enforcement mechanism (OPEN)

Confirmed this session, live against VisaStack's actual production WorkOS environment
(`authkitSettings` query via the connected WorkOS MCP connector): `mfaEnabled` is currently
`"Off"`. No staff/reviewer/support/platform-admin MFA is enforced anywhere, in code or at the
identity provider. Full technical detail in `threat-model.md` under "Staff MFA bypass."

The only mechanism this session found for provably-enforced MFA (not just "encouraged")
is WorkOS's environment-level `mfaEnabled: "Required"` AuthKit setting. It is environment-wide:
turning it on would require MFA for every user in that environment, including travellers,
which the PRD (IAM-01, §4) explicitly says not to require for V1 ("Traveller MFA: supported
and encouraged; not required by V1"). No organization- or role-scoped override was found in
the WorkOS operations surfaced to this session, and confirming whether one exists needs either
further live WorkOS API exploration this session hasn't done, WorkOS support, or docs access
(`workos.com` is blocked by this environment's network egress proxy, so this could not be
checked directly).

This session did not flip the live setting. That is a production identity-provider policy
change with a real blast radius (could lock out any user without MFA already enrolled,
including the product owner's own account) — squarely the kind of hard-to-reverse,
production-affecting action that needs explicit authorization, not an autonomous tool call,
regardless of how strong the technical case for it is.

Options for the product owner:

1. Accept universal MFA for V1 (travellers included) and authorize turning on
   `mfaEnabled: "Required"` on the production (and staging) WorkOS environment. Simplest,
   most robust, deviates from the PRD's stated traveller-optional design (a stronger security
   posture than asked for, not a weaker one — flagging the deviation per Part 1's own rule
   that any deviation must be named explicitly, even a strictly-more-conservative one).
2. Keep MFA optional for travellers and find or build a role-scoped enforcement path (needs
   more WorkOS investigation, e.g. organization-level policies, or an application-level
   gate built on whatever session signal WorkOS can actually provide once identified).
3. Authorize this session (or a future one) to continue investigating WorkOS's API for an
   org/role-scoped option before deciding between 1 and 2.

Until resolved, IAM-01/SEC-01's MFA requirement is REPAIR/NOT_STARTED in the ledger, and A01
cannot pass.

### Resolution (2026-09-17)

Product owner chose option 1: universal MFA for V1, travellers included, accepted as a
stronger posture than the PRD's own traveller-optional design (deviation named per Part 1's
rule: affected requirement IAM-01/§4; reason: no role-scoped alternative found; security
effect: strictly more conservative, not weaker; migration effect: none, a live setting only;
cost/operational effect: travellers must enroll a second factor, a real UX change from the
PRD's stated design; replacement acceptance evidence: explicit product-owner authorization,
this record).

Attempted via the connected WorkOS MCP tool (`updateAuthkitSettings`, `mfaEnabled: "Required"`,
Production environment): refused by WorkOS itself with `FORBIDDEN`, "Your role ('ADMIN') does
not have permission for this operation. Some roles have different access levels in sandbox vs
production environments." This is a WorkOS-side permission boundary on the connected account,
not a decision this session made or can route around. The product owner needs to make this one
specific change directly in the WorkOS dashboard (Production environment, AuthKit/Authentication
settings, MFA -> Required); this session cannot perform it.

Once flipped, IAM-01/SEC-01 can move from BLOCKED and A01 can be attempted. Nothing else in
Part 2 depends on this specific change landing first.

## Deferred: least-privilege application DB role (SEC-01)

Confirmed this session: the running app and migrations both use the same `neondb_owner`
role, the only one that exists so far, violating SEC-01's explicit "migration/admin
credential must be separate from application runtime credential" requirement. The fix
needs a new restricted role created in Neon's console first (this session cannot create
Postgres roles with usable credentials without either handling a raw password itself, which
it should not do casually, or the product owner creating it through Neon's own role-creation
flow, which hands back a ready-to-use connection string the same way `visastackdev` itself
was set up). Offered to walk through this now; the product owner deferred it. Not silently
dropped: revisit before Part 2 is called complete, since SEC-01's own checkpoint criteria
name it explicitly ("Ensure runtime DB role is least privilege").

### Resolution (2026-09-17)

Product owner created the `visastack_app` role directly in Neon's console (name, and letting
Neon auto-generate the password, per the exact steps this session gave). Migration
`packages/db/migrations/0035_least_privilege_app_role.sql` grants it
SELECT/INSERT/UPDATE/DELETE on every table and USAGE/SELECT on every sequence in the `public`
schema, plus matching `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner` so a table a future
migration adds is covered automatically without a repeat grant. No CREATE/ALTER/DROP is
granted; `neondb_owner` (via the existing `db-migrate.yml` GitHub Actions secret, untouched by
this change) remains the only role that can modify schema.

Step 1 is done: with the product owner's explicit go-ahead, this session triggered
`db-migrate.yml` (run 19, `workflow_dispatch` with `confirm: migrate`, ref
`claude/lucid-lamport-70jivu`) against production Neon; it completed successfully
(conclusion `success`). `visastack_app` now genuinely holds SELECT/INSERT/UPDATE/DELETE on
every table and USAGE/SELECT on every sequence in `public`, nothing more. This did not change
what the app connects as; `neondb_owner` is still what it uses today.

One step remains, needing the role's password, which only the product owner has (this session
never handled it and should not): switch the app's own connection string
(`DIRECT_DATABASE_URL` in Vercel, Production and Preview) from `neondb_owner`'s to
`visastack_app`'s. This is the step that actually stops the running app from using the
powerful role day to day. `DIRECT_DATABASE_URL` is never read by `db-migrate.yml` (confirmed:
that workflow's `env:` block only lists
`DATABASE_URL`/`POSTGRES_URL`/`DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING`/
`POSTGRES_PRISMA_URL` as GitHub Actions secrets), so this and the migration secret are already
two separate credential stores; switching this one does not touch the other.

Until it lands, SEC-01's least-privilege requirement stays IMPLEMENTED_UNVERIFIED, not
VERIFIED: the grant is live in Neon, but the app has not yet been proven to run correctly
under the restricted role, since it isn't using it yet.

## Decision: how "push to production" is being interpreted

The instruction to commit, push, and reach production within three minutes of
each key chunk is noted, and conflicts directly with the governing directive's
own rules: Part 1 Section 3 ("Do not merge anything to main. Do not deploy
production.") and Part 10 Section 17 ("DO NOT merge to main; merge/close PR
#77; deploy real production ... unless explicitly instructed by the user after
reviewing the final report"). The PRD itself reinforces this independently:
Section 22 item 9 says not to "set readiness attestations, claim commercial
operation or merge/deploy beyond the actual authorisation," and the whole
document's release-gate design (Section 19) treats commercial admission as
something that requires accumulated verified evidence across all P0
requirements, not a per-chunk action. It also sits outside this session's own
operating rules for this repository, which designate
`claude/lucid-lamport-70jivu` as the branch to develop on and call for a draft
pull request, not a direct production deploy.

Resolution being applied: "push to production" is being treated as push to the
working branch and keep one draft PR continuously current, on the same cadence
(after each meaningful chunk), so the PR's own CI is the fast feedback loop
standing in for a production push. Actual merge to `main` and any real
production deployment or commercial-mode activation waits for explicit
sign-off after review, exactly as the directive and the PRD both require. This
is a deliberate deviation from the literal chat instruction, made because
every governing document this session was asked to implement forbids the
literal instruction, and because this product handles passport and financial
data where an unreviewed autopush to production is a real risk. Flagging it
here rather than silently picking a side.
