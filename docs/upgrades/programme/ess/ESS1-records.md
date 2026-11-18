# ESS1 records: My Profile shows each detail once, as read rows, with protected values loaded only on Show

Unit ESS1, Class A (personal data shown and loaded). Branch `claude/ess1-essentials-compact`, from main `9dead1f`. Builder session `session_0187kU9v4y5Vpjtj6UayufRJ`, Guardian 14.

## Owner request and decisions

- 18 Nov 2026, exact words: "on this page, "Essential First" section, is it supposed to be like how it is now?" (screenshot of My Record > Profile, Everything view).
- Orchestrator added: protected values must not sit in clear under the masked card; load them only on Show or Edit; each field shown once.
- Owner approved the mock (https://claude.ai/artifact/PmYMrmH3uzGfvWumynG5yY), 18 Nov 2026, exact words: "approved, must be 100% corrcet, without breaking any dataflow/sync anywher".
- Guardian 14 approved three manifest deviations: `profile/page.tsx` (it handed protected values to the browser), a plain shared rule module `profile-protected.ts`, and the WAL4 e2e fixture.

## What was wrong (on main 9dead1f)

WAL4 (#637) put the Passport Page Card above the older Essentials First list (UX-C, 27 Oct). So: (a) about 10 essentials were drawn twice; (b) every filled essential was an open box with Save and five history tools open below it, about 1,400 px; (c) Date of Birth and Passport Number were masked on the card but in clear in the boxes right below, and in the page's server markup and client payload; (d) three date styles on one page (04/17/1994 in a box, Dec 17, 2024 from the viewer's locale, 4 Nov 2026).

## What changed

| Where | Change |
|---|---|
| `[id]/profile-editor.tsx`, Essentials First | Lists only the essentials the Passport Page Card does not show (today Email, Phone, Home Address), with a "N left to add" pill. It is not drawn once those are added, and never at 12 of 12; the banner keeps "x of 12". An item added here stays listed until the page is next opened, so its saved message and the focus stay put. Show All Sections / Show Essentials Only moved into a small bar of its own. |
| `[id]/profile-editor.tsx`, every single detail | A saved detail is a read row: name, badges, value (protected ones as dots with Show), Edit. Edit opens the box with Save and Cancel and puts the focus in it; Cancel and a save put the focus back on Edit. A detail not added yet opens straight in its box. One closed Details per row holds, in the approved order: effective as of, Last confirmed, Where This Came From, How This Was Checked, Add the Date This Became True (a button on a read row that opens the box with the date field focused; the date field itself while editing, tied to the same form), No Longer Current. |
| `[id]/profile-editor.tsx`, dates | One style, "17 Dec 2024": date-only values through `@visastack/i18n` `formatDate` (en-GB / bn-BD, UTC so no viewer sees the day before), timestamps through `formatTimestampDate`. Boxes keep the native date control. |
| `[id]/profile-editor.tsx`, without script | A read row carries its edit form inside `<noscript>`, so a browser with script off can still change a detail; for a protected detail that form is empty (an empty post is refused by `saveFactAction` with "Enter a value first." and never clears the stored value: `protected-placeholder-save-action.test.ts`, "an empty post never overwrites the protected value"). |
| `[id]/passport-page-card.tsx` | A withheld value has no text until Show; Show asks the editor to open it, then prints it; a failure says "This detail could not be shown just now. Try again." in place. Every line now leads to the detail's own row (Essentials First no longer holds the card's details). The masking rule comes from `profile-protected.ts`. |
| `[id]/profile-protected.ts` (new) | The one rule for a protected detail: catalogue SENSITIVE or RESTRICTED, plus Date of Birth and Passport Number always. Read by the page (to leave values out) and by the editor and card (to mask). |
| `[id]/profile-reveal-actions.ts` (new, the only server function added) | `revealProfileValueAction(applicantId, factId)`: owner only, checked as a profile save checks it (the record's owner account is the signed-in account); a stranger, a fact of another record, a missing or malformed id and a server with no key all get the same `{ ok: false }`, and nothing is opened with the key for a non-owner. Returns the current value of that fact; never logs it. |
| `[id]/profile/page.tsx` | Still reads the profile once with the key (to tell a value that opens from one that would not or was lost, and to compare app suggestions), but a protected value that opened is handed to the editor as `withheld: true` with no value. Counts (x of 12, Profile Health, the full-profile percent) are computed exactly as before from the same read. |
| `globals.css`, new block "WP-ESS1" (end of file) | Read row, actions, Details, the essentials bar and the card's message. Tokens and a hairline only, no shadow, no gradient, no motion, 44 px targets. |
| `i18n/app-applicant.ts` | Eight keys added in one group (`appApplicant.appApplicantIdProfileEditor.ess1*`), English and Bengali. |

## Data flow and sync: what did not change

- Server functions touched: the new `revealProfileValueAction` only. No change to `saveFactAction`, `section-actions.ts`, any service, policy, schema, migration, stored value, history write, provenance, completeness or readiness count, AI suggestion approval, document link, case readiness, sharing or agency pack, or export.
- Parity tests (`passport-page-card.test.tsx`, "ESS1: the same writes as before"): a save posts exactly applicantId, fieldKey, value, effectiveFrom (and repeatingRecordKey for a list entry, `profile-editor.test.tsx`); Does Not Apply posts applicantId, kind, targetKey, on; No Longer Current posts applicantId, factId. A protected value opened with Show is saved as itself, never as dots or a stand-in.
- Counts: `profile/protected-access.test.ts` asserts the view the editor gets equals `buildMasterProfileView` over the same keyed read, as on main.

## Protected values

- Before Show, no protected value is in the editor props or the page's server markup: `profile/protected-access.test.ts` (serialized props and full server HTML, Date of Birth, Passport Number and a catalogue-sensitive value saved before encryption). Fails on main.
- An opened value lives in the editor's memory only, per saved version (a new save is opened afresh), never in the address or browser storage (`profile-editor-protected.test.tsx`).
- Denial: `profile-reveal-actions.test.ts` with two made-up people on a real database and the real key path.
- Owner-reveal audit: NOT done. No audit kind exists for the owner reading their own profile (main opened these values on every visit without an event). Not added without a DECISION.
- Not covered: free text written by staff or scanners (issuer confirmation claim, a scan's detail line) is shown in How This Was Checked as before; a document-level line could in principle quote a value.

## Tests that assert changed layout (updated)

`profile-editor.test.tsx` (Essentials First block, boxes reached through Edit, Add Information), `profile-editor-protected.test.tsx` (boxes reached through Edit; new withheld cases), `passport-page-card.test.tsx` (taps open rows; read rows; new ESS1 and parity cases), `profile/protected-access.test.ts` (new rule: withheld, value null), `e2e/wallet/u4-profile.spec.ts` and `e2e/fixtures/wal4-profile.fixture.tsx` (withheld fixture, Show stand-in, Details closed; new ESS1 cases at 390 and 1280 px).

## New Bengali words (for localization review)

| Key | English | Bengali draft |
|---|---|---|
| ess1Cancel | Cancel | বাতিল |
| ess1CouldNotShow | This detail could not be shown just now. Try again, or type a new value to replace it. | এই তথ্যটি এখন দেখানো গেল না। আবার চেষ্টা করুন, অথবা বদলাতে নতুন মান লিখুন। |
| ess1Details | Details | বিস্তারিত |
| ess1Edit | Edit | সম্পাদনা |
| ess1Hide | Hide | লুকান |
| ess1LeftToAdd | {count} left to add | যোগ করা বাকি {count}টি |
| ess1OnlyNotOnThePassportPage | Only the essentials the passport page above does not show. This box goes away once they are added. | শুধু সেই প্রয়োজনীয় তথ্যগুলো, যা ওপরের পাসপোর্ট পাতায় দেখানো হয় না। এগুলো যোগ করা হলে এই অংশটি সরে যাবে। |
| ess1Show | Show | দেখান |

The card's own new line ("This detail could not be shown just now. Try again.") is inline English like the rest of the card.

## Wording deviation from the mock

The mock said the box "goes away once all 12 are added". Acceptance 1 says it is not drawn once every essential is on the card or added, which happens earlier when a card essential is still missing. Built to acceptance 1, with the sentence reworded truthfully ("goes away once they are added"); sent to Guardian 14 as DECISION, recommended option taken.

## Known-issues chunk (to append)

## 18 Nov 2026: ESS1 My Profile shows each detail once, protected values load on Show

- Owner question (18 Nov 2026): "on this page, "Essential First" section, is it supposed to be like how it is now?"; mock approved the same day: "approved, must be 100% corrcet, without breaking any dataflow/sync anywher".
- Behaviour: Essentials First lists only the essentials the Passport Page Card does not show and goes away once they are added; a saved detail is a read row (value, Show for a protected one, Edit), its box opens on Edit, and its history tools sit behind one closed Details; one date style ("17 Dec 2024").
- Privacy: protected values (catalogue SENSITIVE or RESTRICTED, plus Date of Birth and Passport Number) are no longer in the profile page's markup or client payload; Show or Edit opens one through `revealProfileValueAction` (owner only, same answer for a stranger and a missing record, nothing logged). Owner-reveal audit not added (no audit kind exists).
- Data flow: no save, service, schema, count, readiness, sharing or export change; parity tests assert the same form payloads as main.
- NOT verified: real devices and screen readers; the live site after deploy; Bengali wording review of the eight new keys.
