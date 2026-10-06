# Free-stack path to a public launch

Written 2026-10-06 at the owner's request: get everything as capable as possible on free tools first, and upgrade to paid tools when commercial operation starts. This page says, for each launch blocker in `release-gate.md`, what free path exists, what it really achieves, and where it stops. It claims no approval. Nothing here switches the product from controlled pilot to public use; that is a separate decision the owner takes after reading the gate.

Vendor limits below come from `cost-and-vendor-register.md` and general knowledge, not from today's official pages. Confirm each provider's current terms before relying on them.

## What "public" can honestly mean on free tools

Two stages, so the owner can choose how far to go:

| Stage | Who can use it | Real customer documents | What is required first |
| --- | --- | --- | --- |
| A. Open pilot (possible on free tools) | Invited people, made-up or low-risk test data, clear wording that it is a pilot | No | Items 1 to 4 below |
| B. Public commercial launch | Anyone | Yes | Every row of the gate, including items 5 to 9 that no free tool can supply |

Stage B includes real passports and identity papers. The gate exists because a leak of those is serious and hard to undo. A free tool can lower cost; it cannot replace an outside reviewer, a lawyer, or a tested restore.

## Blockers and their free path

| # | Blocker (gate row) | Free path | What it achieves | Where it stops | Who acts |
| --- | --- | --- | --- | --- | --- |
| 1 | Malware scanner (G02) | ClamAV, free and open source. Needs a small always-on process (a container or small server). Free hosting tiers exist but sleep or limit memory; ClamAV needs about 1 GB | A real scanner, so PDFs can be released | The always-on host is the only cost. A free tier that sleeps would make uploads wait or stop; that is safe (files stay quarantined) but not useful | Owner picks a host; engineering wires it (adapter exists) |
| 2 | Email (G03) | Resend free tier (3,000 emails a month, 100 a day) | Real invitation, reminder and alert emails | Daily cap; a verified sending domain is needed | Owner creates the account and domain records |
| 3 | AI help (G04) | Google Gemini free API tier (limits and data-use terms differ from paid; free-tier inputs may be used by the provider to improve products, so never send real documents through it) | Real extraction suggestions on made-up documents; live provider tests | Free-tier terms rule it out for real customer documents. A paid business account is needed for Stage B | Owner creates the key; engineering runs the live checks |
| 4 | Outside monitoring (G17) | A scheduled check from GitHub Actions or a free uptime monitor (UptimeRobot free) hitting `/api/health/ready`, with email alerts | Someone is told when the site is down | Email only, no phone paging, five-minute resolution | Owner creates the monitor, or approves a workflow (a workflow for this was attempted and was blocked by the session's safety layer; the owner can add it) |
| 5 | Independent security review (G08) | None. Free scanners and this assistant's own review are internal | n/a | Cannot be substituted. Some universities, bug bounty platforms and community security groups offer free or low-cost reviews; quality and independence must be judged by the owner | Owner |
| 6 | Restore drill (G07) and document backup (G10) | A free Neon branch for the database drill; for files, a second free object store (for example a free-tier bucket) written to by a nightly job | A real, timed drill; a second copy of files | Free tiers shrink the history window (Neon free keeps a short restore window), which may not meet the 15 minute and 4 hour targets; the targets are not rewritten | Owner approves branch and store; engineering runs the drill |
| 7 | Key escrow (G09) | Print or store the master key in two sealed, separate places held by two named people | Loss of one holder no longer loses all data | A rotation tool is still missing (engineering work) | Owner and two key holders |
| 8 | Legal approval, privacy owner, rules reviewer, content (G05, G06, G12) | None. These are people | n/a | Cannot be automated or faked | Owner |
| 9 | Staff sign-in strength (G16) | WorkOS dashboard setting for multi-factor sign-in, plus a code check that refuses staff pages without it | Staff accounts protected | Free WorkOS tier limits apply | Owner sets the switch; engineering adds the check |

## Engineering done in this task

- Test tools upgraded (vitest 2 to 4, vite pinned to 6.4.3 or later): the 3 Critical and 1 High advisories in development tools are cleared. The audit now shows 2 moderate items only (one in a build tool, one in the DOCX reader).
- Named owners recorded: incident owner Incidentman, rules owner Ruleman (designations; see `release-gate.md`).

## Engineering still open and free to do next

1. Staff sign-in check in code (needs item 9 dashboard setting first to test).
2. Key rotation tool and a documented two-person escrow procedure.
3. An SSRF guard and its test, ahead of any custom AI endpoint field.
4. Nightly copy of document files to a second store (needs item 6 store).
5. Wire ClamAV in production (needs item 1 host).

## Order that unlocks the most for the least

1. Items 2 and 4 (email and monitor): minutes of owner time, no cost.
2. Item 1 (scanner host) and item 6 (second store and Neon branch): small or no cost, unlocks the recovery drill and real uploads.
3. Item 7 (key holders) and the named people for items 8: no cost, needs the owner's decisions.
4. Item 5 (independent review): the long pole. Start it first in calendar time.

## Update 2026-10-06: sign-in and email through Neon

The owner asked for sign-in, sign-up and email to be done by Neon. See `neon-auth-migration-plan.md`. In short: Neon Auth can replace WorkOS for sign-in and sign-up (free up to 60,000 monthly users), but Neon does not send email itself. Neon Auth sends its own emails through an SMTP account you connect (2 an hour project-wide until you do), and the app's own emails need an SMTP account too. One free SMTP account can serve both. Items 2 and 9 in the table above change accordingly once phase 1 to 3 of that plan are done.
