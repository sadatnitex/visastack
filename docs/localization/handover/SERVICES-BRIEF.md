# Services message conversion brief (binding)

Read CLAUDE.md sections 3, 4, 6 and 7 first. The language switch is LIVE.

## Setup
- Own worktree only, created from the branch claude/magical-curie-3p4qcx-svc-i18n (PR #535, the plumbing) until it merges, then from origin/main. When #535 merges, merge origin/main in. Never edit /home/user/visastack or another worktree. Run `git remote set-head origin -a` in your worktree.
- Unique scratch names under scratchpad/<your-name>-tmp/. Never kill processes you did not start. No em dashes. Never force-push. Push ONCE after full local verification.
- If a full tsc or build runs out of memory, CI is the authority: say so, never claim a local pass.

## The mechanism (from PR #535 and the ADR)
- packages/services: `keyedError(code, key, params)` builds a ServiceError whose `message` is the ENGLISH sentence from the services `en` catalogue, plus `messageKey` and `params`. Catalogues live in packages/services/src/i18n/<domain>.ts and are registered in that folder's index.
- apps/web: `serviceErrorText(error, t)` and serviceErrorTranslator in apps/web/src/lib/service-error-text.ts render the keyed message in the visitor's language, falling back to error.message.
- Pass numbers RAW in params (#525 and #531 format them by the resolved language).

## Rules
1. ENGLISH STAYS BYTE-IDENTICAL. The en catalogue value must equal the old literal exactly. packages/services/src/english-golden.test.ts and email-golden.test.ts must pass UNEDITED. Existing test assertions on `.message` (about 312) must pass UNEDITED. Code that compares message strings (ai.ts around :3616, adapter "timed out after" matches, the notifications.ts lastError regex) must keep working: convert those comparisons to messageKey only where you also own the code that produces the message.
2. Convert only errors a person can see, ones that reach the web through `error.message`. Staff, admin, platform and log-only text stays English (owner decision). AI prompt and tool text is never converted.
3. Bengali ONLY from register drafts whose automated checks PASS (docs/localization/VISASTACK_TRANSLATION_REGISTER.csv, matched by census source path and line or by exact English). Never hand-write Bengali. A message with no PASS draft keeps an en-only catalogue entry and shows English.
4. Holdbacks: the owner signed off legal, consent, privacy and payment wording (blanket approval, 2026-11-12), so those may be Bengali. STILL English: official visa rules, fees, requirements and processing times; invoice and receipt record content; any sentence that interpolates an English-only value; anything the guardrail checker flags (docs/localization/VISASTACK_SEMANTIC_GUARDRAILS.md).
5. Web call sites: switch the screens that show these errors from `error.message` to `serviceErrorText(error, t)` (or the translator variant). Use the existing catalogue translator of that surface, or serviceErrorTranslator.
6. Tests:
   - per converted domain, a services test that every converted error's `message` equals its old English;
   - a web bn test per converted screen path that the Bengali shows under bn and the exact English under en;
   - measure "keyed messages with bn N, rendered under bn in a test N", which must be equal (as WAVE-BRIEF rule 15);
   - never stub or disable assertions;
   - prove new tests red on the old code.
7. verify-english (scripts/i18n/verify-english.mjs): snapshot on clean main and compare in the same worktree: 134/134.
8. Shared files: packages/services/src/i18n/index.ts (catalogue registry). Several builders add entries there; on merge take the union.

## Flow
1. Plan (at most 10 lines: the domains, the files, the counts of errors to key, how many have PASS bn drafts, the web call sites), then STOP for approval.
2. Build, then /code-review high on the branch diff, then local checks once: lint, typecheck, the services tests for your domain plus the golden tests plus the access ratchet, the web tests for your screens, test:node, `pnpm audit --prod --audit-level high`, the em dash sweep.
3. Merge origin/main, push ONCE, open a draft PR with the template headings, unsubscribe, wait for the three required checks with ONE background loop, and report in at most 12 lines.
- Attribution: the lines your own session's system reminder gives.
