# Lane 00: baseline, exact rules, immutable compatibility (P0/P1)

You are the **sole architect/schema contract writer** designated by the UMPE lead for P0 and P1. Do not start until lead assigns this lane and confirms which central files you may edit. You are not the overall integrator, and your branch must not assume authority to alter production configuration.

## Contract and scope

Read `CLAUDE.md`, `docs/SESSION-START.md`, `docs/umpe/00_START_HERE.md`, `operations/INTERFACE_FREEZE.md`, relevant L3 source contract (§1 and §2), and audit rows `F01-F05`, `R01-R07`, `R09`. Inspect actual code on your base SHA before believing status labels. Preserve all existing approval, sharing, historical and manual behaviour.

1. Record existing published manifest serialization and checksum. Create a golden fixture from the existing repository tests/data without copying sensitive production content. Make a new-rule representation that **cannot invalidate older immutable manifests**; choose minimal versioned serializer/sidecar after evidence. Update formal ADR. Reject invalid new rules while allowing legacy rules to keep historic meaning.
2. Design necessity semantics (`MANDATORY`, conditional mandatory, any-of/all-of alternatives, recommended, optional, agency additions) separate from evaluation state (`NOT_APPLICABLE`, `UNVERIFIED`, `SATISFIED`, blocking gap) and separate from PROFILE_PACKS authorization categories. Define stable rule/category identifiers and transition from old `optional` boolean without inventing what historic boolean meant beyond its actual behaviour.
3. Upgrade matching to correctly consider jurisdiction, exact route, purpose, confirmed nationality/residence and application location, effective validity dates and unknown answers. Incomplete static country rows may be offered as research leads, **not** verified readiness.
4. Ensure `computeReadiness` and downstream mapping can handle exact requirement alternatives and never give a false green for an unknown condition or missing mandatory item. Keep legacy field/packed-case behaviour.
5. Freeze typed interfaces for import/classification, package selection, collection request version, source monitoring and outcome attempts **only to the extent other lanes need them**. Delegate new isolated table migrations in an agreed sequence; do not create an entire hypothetical schema now.

## Exclusive file rights

Only edit `packages/db/src/schema.ts`, Drizzle migrations and `packages/services/src/packs.ts`, `pack-matching.ts`, `rule-conditions.ts`, `missions.ts` if the lead assigned you an explicit hot-file lease. Otherwise supply a patch proposal/test without modifying the shared file. You may create dedicated P1 test/fixture files and an ADR freely. Never modify another lane's branch.

## Negative tests and proof

- Old published checksum still matches; old cases/snapshots still map.
- Two alternatives satisfy one mandatory group without double-counting; a recommended item never blocks.
- Missing condition => unknown, not satisfied or not-applicable; invalid new AST fails closed.
- Route with wrong nationality/residence/consular location is never auto-attached.
- No pack rule category broadens an existing agency grant.
- Static thin country route does not become officially ready.
- Unknown route falls back honestly to manual/agency request mode.

## Stop/hand off

Stop before destructive/reinterpretive migration or authorization change; request focused owner/lead decision. Otherwise create reviewed PR with tests and `operations/PR_HANDOFF_TEMPLATE.md` output. Commit baseline ledger edits and publish the **actual interface signatures** to lead, enabling P2/P6/P10 without waiting for the entire feature set.
