# P14 plan: final end-to-end verification (Lane G verifier)

Branch `umpe/p14-verification` from `umpe/int-w5` 1423f554. Verifier: product code changes only for a defect proven by a failing test.

## Inputs read
Common lane rules; Lane G prompt (P14 part); audit section D (J1-J8) and line 175; RELEASE_GATES.md; ADR 0026 with addenda 1-7; hand-backs P3, P4, P5, P7, P8, P9, P11, P12, P13, G1, G2, G3, G4; ledger (87 rows).

## Steps
1. Journey tests, one file per journey, under `packages/services/src/umpe-journeys/` on createMigratedPglite with synthetic people and files and deterministic stand-ins (AI, mail outbox, storage, clock):
   - J1 intake: names, receipts, relations (duplicate, corrected scan, new period, renewed passport), recognition and family filing, cross-person refusal, unknown kind stays protected.
   - J2 trip and family: three travellers, own requirement sets, any-of groups, recommended never blocks, unknown stays unknown, required exclusion refused, allowance-only shared booking.
   - J3 continuity: newer version recalculates only active affected cases, one note, handoff snapshot never rewritten.
   - J4 agency to account: issue revision, neutral page answer, exact version response, forwarded/revoked/closed denials, review and replacement.
   - J5 agency to guest: code proof, multi-session uploads, mapping, submit, correction, forwarded link without code sees no draft, no account or applicant row.
   - J6 Saturday sources: run, changed/blocked/PDF outcomes, candidates, never a pack edit, publication flags affected cases.
   - J7 field outcomes: two attempts stay two, unknown stays unknown, small cohorts suppressed, self-report never official.
   - J8 preservation: cross-tenant denial over new surfaces, AI-off manual path, golden manifest checksum, deletion removes UMPE rows.
   A web test only where the behaviour lives in the web layer (80-file import queue).
2. Browser: Playwright checks for the signed-out /collect neutral page and guest code page shape (synthetic link stand-in only if the harness allows), existing specs untouched.
3. Ledger: final status per row from evidence; U02-U06 from P13 and these checks.
4. Report `docs/umpe/operations/P14-VERIFICATION.md` and hand-back `handoffs/P14.md`.
5. Full check once (PORT=3101), `/code-review high` on the diff, fix confirmed findings.

## Not exercisable below the browser (reported, not faked)
Real Neon Auth sign-in, real email delivery, real AI provider calls, real malware scanner, live deployment on the exact SHA, real official source fetches, measured p95 and AI cost on production.
