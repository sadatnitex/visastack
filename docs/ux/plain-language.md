# Plain language on public pages

Owner instruction, 2026-10-05: **no engineering talk to the public unless it is
really needed.** A visitor, a traveller or an agency's client has never heard of
the tools behind VisaStack and should not have to.

## What this covers today

- The home page, the status page, the banner every page carries, the page title and
  description, the footer.
- The screens a person lands on when something goes wrong: not found, error, "pilot
  access denied".
- The public trust pages.

It does **not** yet cover the signed-in screens. The words there that still need the
same treatment are listed at the end.

## The rules

1. **Say what the person gets or sees, not how it is built.** "Only you and the people
   you choose can open them", not "permission-aware preview".
2. **Do not name the tools behind the product** (hosting, database, sign-in provider,
   scanner).
3. **No paths, codes, version numbers or internal names.** A visitor never needs to
   read `/api/health/ready`, `unconfigured` or `v0.0.0`.
4. **Be honest about what is not switched on yet,** in plain words. The status page
   says "Not set up yet" or "Switched off for now" next to each such feature, and the
   home page says the pilot is invite-only and that some features are not on yet.
5. **Make no promise the product cannot keep:** no approval predictions, no
   "guarantee", nothing about a language that is only partly there.
6. **No em dashes** in written text.

## Before and after

| Where | Before | After |
|---|---|---|
| Home page label | Technical Preview, authenticated applicant core under validation | Invite-only pilot |
| Profile | A Master Profile whose every value is an immutable, atomically-approved version, no silent mutation | Every change is saved as a new version, so nothing is quietly overwritten |
| AI | Quarantine, scan, normalize, extract, with deterministic passport-MRZ parsing | AI can suggest details from a document, and you approve or reject each one |
| Trust list | Provider-agnostic ports, Fail-closed audit, Remote-first delivery | Every action is recorded; AI never changes your profile on its own |
| Footer | Built remote-first on Vercel + Neon | (removed) |
| Status page | Liveness, Readiness, `/api/health/live`, `platform.aiExtraction: unconfigured` | Overall: Everything is working. AI suggestions from documents: Not set up yet |
| Banner | Internal controlled pilot. Use synthetic or irreversibly redacted information only | Invite-only test version. Please use made-up details, or documents with all personal information permanently blacked out |

The banner still says exactly what the pilot rules require (nothing real goes in);
only the words changed.

## How it is enforced

`apps/web/src/lib/plain-language.test.ts` reads the text a visitor can see in the
public files (with the same scanner `vocabulary.test.ts` uses for internal names) and
fails when engineering vocabulary, a tool name, a path, a version number, a raw state
code or an em dash comes back. It checks the words, not the meaning: a sentence can
pass and still be unclear, so read new copy aloud as if to a traveller. When it
fails, reword; do not add the word to an allowance list.

The status page is built so it cannot leak a raw key: `capability-names.ts` names
every platform capability (or hides it on purpose) and the build fails if a new one is
added without a decision.

## Still to do (signed-in screens)

These are shown to signed-in travellers and still carry engineering words. They are
the next candidates for the same pass:

- Document stages: done (2026-10-06): now "Checking the file", "Reading the file", "Held for safety", "No problems found", "Reviewed and approved".
- AI controls on a document: "Run OCR", "Fallback provider used", "Unmapped (no
  matching field)", and raw document type codes such as `BANK_STATEMENT`.
- Agency and platform consoles, which are written for staff and are left as they are
  unless the owner asks otherwise.
- Email templates (not reviewed yet).

## Capitalisation (owner rule, 25 Oct 2026)

- A term is written in Title Case: page, section and card headings, menu and tab names, field labels, status badges and short button names. Every word starts with a capital, apart from small joining words after the first ("Share & Care", "Ready for Review", "Sign In with the Invited Email").
- A sentence keeps only its first word capitalised: hints, messages, questions and anything ending in a full stop.
- Names that already carry capitals (VisaStack, AI, eTA) keep them.
- `apps/web/src/lib/title-case.ts` holds the rule; its guard test (`title-case.test.ts`) fails when a heading, card title, field label, button name, or either side of a label choice is written in sentence case.
