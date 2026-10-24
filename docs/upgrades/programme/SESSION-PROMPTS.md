# Session prompts for Claude Code

How to use: one package per session. Paste the shared preamble, then the package block. Do not paste the whole programme into the chat. The files are in the repo and Claude Code reads only what the prompt names.

Order of packages: A0, L1, C1, P0, V1, V2, X1, X2, X3, V3, V4, V5, V6 (allowed parallel pairs are in `PROGRAMME.md` section 7). Before each session check the Owner decisions table in `PROGRAMME.md` section 4: a package blocked by an OPEN decision may only do preview and audit work.

---

## Shared preamble (paste first, every time)

```text
You are implementing exactly ONE work package of VisaStack Programme X (UX/UI
upgrade plus upgrade.v1.2). You are a conformance engineer, not a designer.

Read in this order and nothing else unless a dependency forces it:
1. CLAUDE.md (loaded automatically).
2. docs/upgrades/programme/STATUS.md.
3. Your package in docs/upgrades/programme/WORK-PACKAGES.md.
4. Only the sections of docs/upgrades/programme/PROGRAMME.md that the package
   cites (normally 2, 3, 8, 10, 11).
5. For v1.2 packages: only the v1.2 sections the package names, in
   docs/upgrades/upgrade.v1.2.execution.md.

Rules:
- Preflight per CLAUDE.md section 6. Record the current main SHA in STATUS.md.
- Push only to the designated branch below. Never to main or any other branch.
- First commit on the branch: docs/upgrades/programme/allowlists/<package>.txt.
  If it does not exist, draft it from the package's allowlist seed, commit it,
  and tell the owner it needs approval before you edit any other file.
- Before finishing run: node scripts/programme/check-allowed-paths.mjs
  docs/upgrades/programme/allowlists/<package>.txt --no-emdash --exclude docs/design/harbor-v2
  It must exit 0.
- Verify current code before trusting any "head start" fact. If a fact is false,
  stop and report it. Do not assume historical v1.2 observations are current.
- Read narrowly: rg for symbols, then sed -n ranges. Never dump large files,
  logs or lockfiles. No subagents. No task-list tools.
- Never skip, disable, quarantine or waive a test. Never claim green without
  checking each required check on the CURRENT head SHA.
- Stop and report (do not decide) when: an owner decision the package needs is
  OPEN; two sources conflict outside the conflict register; an authorization
  boundary is unclear; copy would claim something you cannot prove; the
  allowlist is not enough; a required check cannot pass without weakening a test.
- Do not implement anything outside the package, anything in the exclusion
  lists, or "while I am here" fixes.
- No em dashes anywhere (code, docs, commits, PR text, chat). Use a hyphen.
  Plain wording, no engineering talk in anything a user will see.
- Run local verification ONCE, completely, as a single background script, and
  read only its summary.
- Open a DRAFT PR using .github/pull_request_template.md headings. Include: the
  gate table from PROGRAMME section 10 with evidence, the scorecard values for
  the X measures the package moves, the claim register rows if copy changed, and
  a "What I did not touch" note (routes, actions, permissions, consent, data
  model). Do NOT merge. Wait for the owner's explicit merge word.
- Follow CLAUDE.md section 6 ("Docs are append-only"): add the next known-issues chunk the standing rules require for anything you could not verify.
- At the end update STATUS.md (250 to 400 words) and the ledger rows you touched
  in docs/upgrades/programme/COVERAGE-LEDGER.csv with exact command, outcome and
  tested commit.
- Report to the owner in plain language: a table (Area | What changed | What you
  will see | Who notices), then Checked live / Not live yet / Not yet checked /
  Needs you. End with (1) what was done (2) one concrete next step.
```

---

## WP-A0 prompt

```text
Package: WP-A0 (read-only audit, baselines, Harbor lock, allowlists, drift guard).
Designated branch: claude/prog-a0-audit.
This package changes docs and scripts only. Do not touch apps/, packages/, infra/
or CI workflows.

The owner has placed (or will place) these files in the repo:
- docs/upgrades/upgrade.v1.2.execution.md
- docs/upgrades/programme/ (this programme)
- docs/design/harbor-v2/ (the Harbor Blue v2 package)
- scripts/programme/check-allowed-paths.mjs and its test
If any are missing, stop and tell the owner exactly which.

Do WP-A0 steps 1 to 10 from WORK-PACKAGES.md. Deliverables: Harbor lock result,
ROUTE-MAP.md, the filled COVERAGE-LEDGER.csv (no blank statuses), scorecard
baselines with the method used, one allowlist per package, the proposed CLAUDE.md
addition, and the landing preview screenshots at 1440, 1024, 768, 390 and 360
with the corrections shown before and after. Do not wire the guard script into
CI or the root scripts in this package. Propose in the PR description how and
where to wire it, and wait for the owner's decision.
```

## WP-L1 prompt

```text
Package: WP-L1 (landing page, Harbor R01). Designated branch: claude/prog-l1-landing.
First read PROGRAMME section 4. Decisions D1, D2, D3, D4 and D5 must be answered
(not OPEN) before you write any production landing code. If any is OPEN, finish
the preview work only, report which are OPEN, and stop.

Read Harbor in the order given in WORK-PACKAGES.md WP-L1 step 1. The frozen source
hash must verify before you start. This PR changes no route other than the
homepage. Use the content register in WP-L1: verify every row with a file and
symbol, and ship the reduced text for CL08. Every CSS change gets a Harbor
classification label. Write the disposition table for every old section and claim.
Run Harbor gates A to F and fill the gate F block in the PR. Capture 1440, 1024,
768, 390 and 360 screenshots before and after.
```

## WP-C1 prompt

```text
Package: WP-C1 (Harbor colour layer, everything except the landing).
Designated branch: claude/prog-c1-colour. Needs WP-L1 merged. D9 and the owner's
approval of the five derived tints and of each dark-surface colour must be
recorded before you edit. List the dark-surface literals first and wait.

Colour only. No layout, spacing, radius, type, font, control size, copy or
behaviour changes. Use the token map in WP-C1, checked against
docs/design/harbor-v2/01_tokens/HARBOR_TOKENS.json (the JSON wins on any
difference). Write docs/upgrades/programme/colour-map.md. Add the contrast test.
Search the repo for every old hex afterwards and report survivors. Capture all
screens before and after.
```

## WP-P0 prompt

```text
Package: WP-P0 (WorkOS retirement). Designated branch: claude/prog-p0-workos.
Session 1 is read-only: list every WorkOS reference, classify each, and write the
brief (exact files to change, tests to keep or port, data that must stay untouched).
Stop for the owner's approval of the brief. Only after approval remove the WorkOS
runtime branches and dependency. No destructive database change, no dropped
identity columns, no removed tests. Prove all auth journeys on staging with
Neon Auth only.
```

## WP-V1 prompt

```text
Package: WP-V1 (v1.2 PR1/S1). Designated branch: claude/prog-v1-identity.
Spec: docs/upgrades/upgrade.v1.2.execution.md section 6 row PR1/S1, section 3 E01
(return-path security) and Appendix B B09. Verify first: does
packages/services/src/client-invitations.ts still accept any signed-in account?
Is safeReturnPath (apps/web/src/lib/neon-recency.ts) sufficient for invitation
return paths? Record existing, partial, missing or blocked per requirement, then
make only the smallest remaining change. Reuse identity, audit, transactions,
mail and scope services. Add no guest upload system, no SMS provider, no new
permissions engine. Tests: T02-T05, T15-T16 for the affected cases plus R01
return-path cases.
```

## WP-V2 prompt

```text
Package: WP-V2 (v1.2 PR1/S2). Designated branch: claude/prog-v2-time.
Spec: v1.2 section 6 row PR1/S2, B06, B07, E03 service foundation. Verify the
conflicts table behaviour, revealFactVersionValue and material-revision
invalidation in current code first. Unknown dates stay unknown. An explanation is
a recorded assertion, not proof. No fake AI proposals to store conflicts. Add a
schema change only if the ledger proves nothing fits and the owner approves.
Tests: T06, T10-T12, R05, R06.
```

## WP-X1 prompt

```text
Package: WP-X1 (case journey view). Designated branch: claude/prog-x1-case.
Needs WP-C1 merged. First write and pass a characterization test of the current
case page (apps/web/src/app/app/mission/[id]/page.tsx). Then add the next-step
card from the first existing attention item, and move the existing isDirty notice
under the stage tracker as the approved alert. Use the real STATE_LABELS. Hold
out the reminder line until the owner approves its wording, and hold out the
changed-fields list (WP-V3). Add no placeholder elements.
```

## WP-X2 prompt

```text
Package: WP-X2 (grant review brief). Designated branch: claude/prog-x2-brief.
Needs WP-C1 merged. Build SelectedScopeSummary (new, presentational) and re-lay
the review panel and the active grant cards with it. No "Verified organisation".
Show the end date, or "No end date" in warning tone. Whole profile and every
document use warning tone. The download sentence appears only with the Download
permission and only with the wording the owner approves. Do not touch the pending
invitation block. Required test: the form data posted to createGrantAction is
identical before and after for narrow, whole-profile and every-document cases.
```

## WP-X3 prompt

```text
Package: WP-X3 (context chip). Designated branch: claude/prog-x3-chip. Needs
WP-C1 merged. Show a compact version of the existing WorkspaceSelector in the
mobile top bar. Do not change workspaceNavigation() or access computation. Add
app-nav.test.tsx. Verify at 360 and 390px and with keyboard (Escape closes and
returns focus).
```

## WP-V3 prompt

```text
Package: WP-V3 (v1.2 PR2/S3 plus four-tab shell and task-first first run).
Designated branch: claude/prog-v3-record. Needs V1, V2, P0 and X3 merged.
D7 and D8 must be answered and the revised first-run preview approved.
Spec: v1.2 PR2/S3, B03, B08, E01, E03. Write the /app characterization test
first. Implement the four tabs, the Record hub, task-first first run (no purpose
or destination prompt, only choices whose destination has shipped, skip always
possible, validated return path respected), Application Memory and the prior
versus current view. Keep every route reachable and write the before and after
link list into the PR. Consent stays one explicit choice that switches nothing
else on.
```

## WP-V4 prompt

```text
Package: WP-V4 (v1.2 PR2/S4 plus agency Do next). Designated branch:
claude/prog-v4-journey. Needs V3 and X1 merged. Spec: v1.2 PR2/S4, B04, B05,
B09 request UX, E01, E02. Map existing evidence, request and review statuses to
the E02 groups first (a table in the ledger). Do not create a second state
machine. Do not widen who can see evidence requests; if v1.2 needs that, stop and
ask. Implement the Do next list only from the E02 mapping and data the person
already loads. The ranking order needs the owner's approval before you code it.
The follow-up message is built, shown for review, copied by the person, never
sent by the product. Add the ADR.
```

## WP-V5 prompt

```text
Package: WP-V5 (v1.2 PR3/S5). Designated branch: claude/prog-v5-outputs. Needs
V4 and X2 merged. Spec: v1.2 PR3/S5, B10 to B12, E04, E01 output. Build one
server-authorized selected-output projection and four thin templates. Never
filter a full-account export in the UI. Reuse SelectedScopeSummary for the
preview. Add the "Prepare a brief" first-run choice. WhatsApp share is a generic
message plus a secure link, never sent automatically. Tests: T14-T16, R07, R08.
```

## WP-V6 prompt

```text
Package: WP-V6 (acceptance, landing truth refresh, scorecard). Designated branch:
claude/prog-v6-acceptance. Needs V5 merged. Run T01-T16 and R01-R08 against the
exact final commit on staging with synthetic accounts and record exact commands
and outcomes. Refresh landing copy only where features have shipped (restore the
"Prepared again, faster" float and the full card 1 text only if proven). Fill
the scorecard X01-X14 with baseline and after values and report any regression.
Write the release reconciliation. The final release-candidate PR must not be
merged or deployed without the owner's explicit instruction after they read the
final report.
```

---

## After the owner says "merge"

```text
The owner approves merging <package> PR #<n>. Squash merge it. Then per CLAUDE.md
section 6: confirm the Vercel commit status for the merge SHA is success, the
Deploy Smoke and Playwright Deploy Smoke runs for it passed, the push-triggered
CI run on main is green, and GET /api/health is healthy. Update STATUS.md. Report
in the plain-language table format. Do not start the next package.
```

## If a session stops

```text
Resume <package>. Read STATUS.md and the stop reason you recorded. Re-run the
preflight. Do not repeat finished steps. Continue only from the recorded next
action, inside the same allowlist.
```
