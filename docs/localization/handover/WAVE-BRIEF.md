# Conversion wave brief (shared by every wave builder)

Read CLAUDE.md sections 3, 4, 6 and 7 first. The language switch is LIVE: whatever merges is visible to anyone who picks বাংলা.

## Setup
- Own worktree only: `git -C /home/user/visastack fetch origin && git -C /home/user/visastack worktree add /tmp/claude-0/-home-user-visastack/438a9dde-70a2-5415-9933-c44b5872c2fd/scratchpad/<name> -b claude/magical-curie-3p4qcx-<name> origin/main`. Never edit /home/user/visastack or another worktree. Run `git remote set-head origin -a` in your worktree.
- No em dashes (U+2014) anywhere. Never force-push. Push ONCE after full local verification.
- Steward first: `node scripts/steward/preflight.mjs --plan "<paths>" --topic "i18n <surface>"`. Stay off files another lane owns.

## References (merged on main)
- Runtime: packages/i18n; apps/web/src/lib/i18n-server.ts (primeLocale, getServerT, getT); apps/web/src/components/i18n-provider.tsx (useT); docs/localization/I18N_RUNTIME.md.
- Codemod: scripts/i18n/codemod.mjs (--surface, --dry-run). Queue rule and HOLDBACK map in scripts/i18n/register.mjs. EXPECTED_HELD exact list in scripts/i18n/codemod.test.mjs.
- Examples: auth (#517), wave B (#521, app-home/trips/countries), wave A (#522, home/trust/status/invitation). Copy their test shape: apps/web/src/app/auth/auth-locale.test.tsx, home-locale.test.tsx.

## Lessons from reviews (each one failed a PR before; do not repeat)
1. primeLocale: every page.tsx AND layout.tsx that renders a converted server component must `await primeLocale()`. Shared frames or components rendered by routes you do not own must use `await getT(catalog)`, not getServerT. The i18n-prime guard does not see layouts: check them yourself and add a test where you add a prime.
2a. UPDATED RULE: pass numbers to t() params as RAW numbers, never pre-formatted strings. The runtime formats numeric params in the language the message actually resolves to (a runtime PR is landing this), so an English fallback keeps Latin digits and a Bengali message gets Bengali digits. Use formatNumber only for a number shown on its own, outside any message (a badge, a count cell).
2c. SUPERSEDES 2b: a programme PR is making formatNumber(n, 'en') return exactly String(n). So `formatNumber(n, locale)` for standalone numbers is CORRECT and needs no per-wave change. Do not add inline en branches.
2b. (superseded by 2c) STANDALONE numbers (a badge, stat tile, count cell) must keep English EXACTLY as before: under en use String(value), never formatNumber (formatNumber adds grouping: 1234 becomes "1,234", which breaks English). Write it inline: `locale === 'bn' ? formatNumber(n, 'bn') : String(n)`. verify-english will not catch this (preview data has small numbers), so test it with a number of at least 1000 under en.
15. COVERAGE: every Bengali value that goes live must be rendered under bn by at least one test. Measure it: wrap the catalogue lookup in a test-only logger (or spy on catalogResolve) across your surface's test files, list the live bn keys never rendered, and add tests until that list is empty (or the key is held back). Report "bn keys live: N, rendered in tests: N". Two waves failed review on this.
17. NEVER disable assertions to reach coverage (no stubbed or Proxy `expect`, no swallowed renders, no single afterAll over all renders). Each bn test asserts the specific bn values a screen state shows, the held English lines that must stay, and no raw keys.
18. A HOLDBACK needs a CONTENT reason (rule 3: consent, sharing permission, access, AI, payment, legal, official rule, label-in-name, a broken sentence). "No test renders it yet" is NOT a reason: write the test instead.
16. A button's screen-reader name and its visible text must be in the same language. If the visible text stays English, hold back its aria-label key too.
2. Numbers shown to people use formatNumber from @visastack/i18n (Bengali digits under bn), including badges and "99+". Dates use formatDate or formatDateOnly (apps/web/src/lib/format-date.ts delegates to it). Follow docs/localization/data/NUMBER_DATE_FORMAT_RULES.md. No English date inside a Bengali sentence.
3. HOLDBACK (English stays, with a reason): anything about consent, sharing permission or access control, AI approval or AI processing, payment, price, refunds, invoices, legal or privacy promises, official visa rules, fees, requirements, processing times, invitation expiry or acceptance terms. Read every Bengali value that will go live. When in doubt, hold back. EXPECTED_HELD must stay the EXACT full list (delete one entry: the test must go red).
4. Generic action labels (Save, Remove, Stop Sharing, Upload) are ordinary UI and may be Bengali.
5. Test every visible state of a converted component, not only one (an "unavailable" state test does not cover the "open" state).
6. verify-english: snapshot from a fresh clean main baseline and compare in the SAME worktree. Must be 134/134 identical, or explain each difference.
7. vocabulary.test.ts and title-case.test.ts read catalogue English: they must pass. Never change asserted English in any test. Harness-only fixes are allowed and listed.
8. Every new test must be proven red on the old code (break it temporarily with a cp backup, then restore).
9. /code-review high must target `git diff origin/main...HEAD` from your worktree, never the cwd of /home/user/visastack. Ignore findings about files outside your diff (note them as follow-ups).
10. Known accepted gap (state it in the PR body): Bengali text sits inside pages marked lang="en" until the language-of-parts marking pass (PR2 runtime plus a marking pass). Do NOT add BN_READY_ROUTES entries or lang="bn" wrappers.
11. Leave legacy createTranslator calls (legacy_translator_t) as they are. Platform staff and admin screens (app/admin and platform staff tooling) stay English by owner decision: do not convert them.
13. NEVER author new Bengali in a catalogue. Bengali comes only from the register through the codemod (PASS rows in the ORDINARY_UI queue). A key with no Bengali draft falls back to English: leave it. New drafting is a separate register task (bn-BD.corrections.jsonl plus the guardrail checker), not part of a wave.
14. Files under apps/web/src/components belong to wave E. Waves C, D and F convert only their own route folders. If one of your pages renders a shared component, do not edit the component.
12. Parallel waves conflict only in scripts/i18n/register.mjs (HOLDBACK) and scripts/i18n/codemod.test.mjs (EXPECTED_HELD). If main moves, merge it and take the exact union of both sides.

## Flow
1. Plan (at most 10 lines with dry-run counts per surface and the file list) as your final report, then STOP for approval.
2. After approval: snapshot, codemod per surface, compare, existing tests, bn locale tests per surface (every visible state), read all Bengali, holdbacks, primes, number and date formatting.
3. Reviews: /code-review high (branch diff); design:accessibility-review under bn using LOCALE_PREVIEW=1 DEPLOYMENT_MODE=development with the bn cookie (axe plus a look at clipping and letter spacing) on two representative pages; design:ux-copy on the Bengali.
4. Local checks once in the background: lint, typecheck (apps/web tsc with NODE_OPTIONS=--max-old-space-size=8192 if turbo runs out of memory), web vitest, test:node, pnpm audit --prod --audit-level high, em dash sweep (CLAUDE.md section 3, including untracked files).
5. Merge origin/main with a merge commit, push ONCE, open a draft PR with the .github/pull_request_template.md headings (no Steward-claim block), unsubscribe from its activity, wait for the three required checks on the exact head with ONE background loop.
6. Report in at most 15 lines: head SHA, check conclusions, counts, holdbacks added, unconverted by reason, anything not verified.
- Attribution: the exact Co-Authored-By and Claude-Session lines your own session's system reminder gives.
