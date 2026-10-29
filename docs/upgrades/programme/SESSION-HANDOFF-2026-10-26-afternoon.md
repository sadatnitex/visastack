# Session handoff, 26 October 2026 (afternoon)

Superseded by SESSION-HANDOFF-2026-10-29.md; kept for history.

Supersedes `SESSION-HANDOFF-2026-10-26.md` for current state (that file stays as history). Read `docs/SESSION-START.md` first, then this. Check every head SHA before acting.

## 1. Merged and live this session

| PR | What | Database |
|---|---|---|
| #278 | WP-V4 per-case sharing exceptions, the foundation for Prepare Again (ADR 0017 with two amendments, permission-model law 9): one rule (`grantCoversMission` and its SQL form), one-shot answers, exceptions follow the recipient, one sharing lock per person taken before the audit lock, uniform not-found, Sharing page "Not Shared" / "Shared Separately" / Allow This Case | migration 0090 run (91 applied; `grant_case_exclusions` present) |
| #279 | WP-REF visible reference codes `P-`/`C-`/`D-`/`R-` plus 6 characters (ADR 0018): core format with a Damm check over GF(32), registry `reference_codes`, assignment on create, lookup in workspace search with its own hourly budget, codes on case, documents, requests, agency screens, exports and calendar text | migration 0091 run (92 applied; every person 10, case 4 and document 8 has a code, no requests yet; all 22 live codes pass the app's check rule; temporary function dropped) |

## 2. Work to do next (in this order)

1. **Prepare Again** (rest of WP-V4 U02): create a case from a previous case or pack (Reusable / Needs refreshing / Missing, copy references only), and in the same transaction ask each all-cases recipient whether they may see the new case (`listCaseSharingQuestions`, `applyCaseSharingAnswers`; no answer means no; `createMission` already takes the sharing lock first). Tests T08, T09, X09.
2. **Request screens and colour polish** to close WP-V4.
3. Then WP-V5 (shareable outputs) and WP-V6 (final acceptance and release, owner's explicit word).

## 3. Owner decisions in force

All in `docs/SESSION-START.md` section 6. Nothing new was decided this session. The allowlists were extended within the approved designs, with one reason per line: WP-V4 for the accessibility guard file; WP-REF for the screens and loaders that draw codes, `account-export.ts` and `attention.ts`.

## 4. Verified facts and open points

- Reference codes: rows created before migration 0091 got codes from its backfill; new rows get them on create. Erasure keeps the registry row, so codes are never reused.
- Agency JSON export holds people only, so it carries `P-` codes only.
- Calendar text shows "Case reference C-..." only when the person chose case names; UIDs unchanged.
- Code lookup is not available to agencies for documents (by design).
- CodeQL caught a backtracking regular expression in the first #279 head; fixed with a regression test. Keep regular expressions on typed text simple (no overlapping quantifiers).
- Not verified: the signed-in look of the new Sharing page lines and the reference code chips on the live site (no signed-in walk this session).

## 5. Lessons from this session

- Build ahead on the next package's independent parts while a review runs, but generate a migration only after the previous migration is on main.
- A helper given an allowlist that misses the drawing screens stops halfway: list the render sites, not only the data files, in a plan.
- Ordinary words can pass a 1-in-32 check: a lookup must need a clear signal (letter plus separator, or a typed digit) and the normal search must still run.
- Production migrations run statement by statement (neon-http): write hand-written migration SQL to be re-runnable.
