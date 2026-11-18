# WALD2 records - protected profile values

Branch: claude/wald2-protected-profile-values, from main 6da17c9. Class A (personal data and encryption).

## What was wrong

My Profile read protected details (Date of Birth, passport number and the rest of the SENSITIVE and RESTRICTED fields) without the key. Each one came back as the stand-in text "[protected]":

- A date box cannot show that text, so Date of Birth looked blank while its Essentials chip said Added and its badge said Confirmed.
- A protected text box showed the words "[protected]". Pressing Save stored those words, encrypted, over the real value. Nothing refused it.

## What changed

| Area | Change |
| --- | --- |
| Service (`packages/services/src/profile.ts`) | `editFact` refuses the stand-in, in any case or spacing, for every field and every caller, with an `invalid` error that never repeats the input. `isProtectedPlaceholder` now ignores case and spaces. It is exported from the package index (one added line, Guardian DECISION asked). |
| Save action (`actions.ts`) | `saveFactAction` refuses the stand-in before it calls the service, with plain words: "This detail is saved and protected. Type the new value to change it, or leave it as it is." An empty save was already refused. |
| Profile page (`profile/page.tsx`) | After the owner check, it reads the profile once with the key and reuses that read for the app-suggestion comparison (before, it read twice). A protected value that did not open reaches the editor as `value: null` with a reason: `no_key` (no key here), `unreadable` (the key is here but the value would not open) or `lost` (what is stored is the stand-in itself, from the old bug). A lost value has no status badge and does not count as Added. An unknown key setting no longer breaks the page: it is reported and the page opens in no-key mode. |
| Editor (`profile-editor.tsx`) | A stand-in is never used as a box's value. A locked box is empty, says "Saved and Protected" (date boxes ignore placeholder text, so the hint below the box carries it), and links the hint to the box for screen readers, choice boxes included. Text and choice boxes remount when the stored value changes, so after a save they show what was stored, not what was typed. |

## Red then green

Each test below was run against the code on main first (by backing up the changed file, putting main's copy in place, then restoring the backup).

| Test file | On main | After |
| --- | --- | --- |
| `packages/services/src/profile-protected-placeholder.test.ts` | 8 failed, 2 passed. `editFact` accepted "[protected]" and its variants (`expected true to be false`). | 10 passed |
| `apps/web/.../protected-placeholder-save-action.test.ts` (real database, real key path) | 3 failed, 2 passed. The action stored "[protected]" over the encrypted passport number. | 5 passed |
| `apps/web/.../profile-editor-protected.test.tsx` | 7 failed, 1 passed. The passport box held "[protected]". | 17 passed (lost state, choice-box hint and a stand-in rule check against the services package added afterwards) |
| `apps/web/.../profile/protected-access.test.ts` | Owner cases 5 failed. Non-owner cases passed on main and failed when the key read was moved above the owner check on purpose. | 7 passed |
| `apps/web/.../profile/protected-essentials.test.ts` | Passed on main. This locks the chip rule in place, it is not a fix. | 4 passed |

## Guardian findings on 1445839 (fixed)

| Finding | Fix | Proof it can fail |
| --- | --- | --- |
| F1: the essentials test passed on main and did not guard the real fix, which is the lost-value filter in `profile/page.tsx` | `protected-access.test.ts` now checks the page's own Essentials list: a lost passport number is not Added, an unopened Date of Birth is | With the filter removed, the lost-value test goes red (1 failed, 6 passed) |
| F2: the read-once test had no pending suggestion, so a second keyed read would not be noticed | That test now has one pending app suggestion and still expects exactly one keyed read | With a second keyed read put back for the suggestion comparison, it goes red (1 failed, 6 passed) |
| F3: a saved Other text under a protected choice was hidden when its value was not shown | The Other row shows when its detail is locked too | With the change removed, 3 tests go red (no_key, unreadable, lost) |

`protected-essentials.test.ts` is kept. It does not guard the page fix (F1 does that). It pins the rule the page works around: a protected stand-in with a status counts as Added in `master-profile.ts`.

17 protected choice fields (RESTRICTED or SENSITIVE, each with an Other detail at the same level) exist in the catalogue, so F3 reaches real people: immigration_incident_type, immigration_incident_appeal_outcome, travel_ban_type, travel_ban_appeal_status, criminal_record_outcome, military_service_discharge_type, clearance_result, organisation_membership_type, bankruptcy_type, bankruptcy_status, tax_default_tax_type, vaccination_vaccine, medical_exam_type, medical_exam_result, health_declaration_treatment_status, labour_migration_medical_result and gcc_medical_test_result.

Review notes, recorded here and not in code:

- The two profile lifecycle writes in `profile-lifecycle.ts` cannot write the stand-in: No Longer Current writes null, Ended copies the real value (confirmed by review).
- Every profile view now opens all protected values with the key. Before, it did so only when app suggestions were pending. The key-service cost on production has not been measured.
- The Evidence reply label "[protected]" stays for a later unit.
- Look-alike characters (for example full-width brackets) are stored as typed. Accepted.

## Other screens that read the profile without the key (audit only, not edited)

| Screen | What it does with a protected value | Writes it back? |
| --- | --- | --- |
| Person home (`[id]/page.tsx`) | Counts and field labels only | No |
| Record (`record/page.tsx`) | Section counts only | No |
| Sharing (`sharing/page.tsx`) | Category detection only | No |
| Evidence replies (`evidence/request-panes.tsx` to `submit-response-form.tsx`) | Shows "[protected]" as the label of the radio choice when a request asks for a protected detail. The person sees the stand-in instead of their value. | No. It posts the fact id, not the text. |
| History, Review, Documents | Already use the key, or a history read that never opens values | No |

Recommended follow-up: Evidence replies should read with the key, or show "Saved and Protected" as the choice label. That needs its own unit (not in this manifest).

## Security

- The keyed read happens only after the owner check. Another account gets Not Found, and neither the key port nor the read is called (tested).
- The page is `force-dynamic`, with no caching around the keyed read.
- Decrypted values reach the browser only through the editor's own field values. `view`, latest changes and assurance carry no values.
- No new logging of values. The key-setting report carries the setting error only, through the sanitised logger.
- `/code-review high` and `/security-review` were run. The confirmed review items were fixed: the lost-value state, page errors from the key setting, the no-key wording, the choice-box hint, display of the stand-in look-alikes, and the doc comment placement. Security review: no findings.

## Local check

`scripts/agent/full-check.sh` on the frozen head, run with more Node memory (`NODE_OPTIONS=--max-old-space-size=8192`), because the container's default ran out during typecheck and build. Result in the READY message.

## Not verified

- Live behaviour on production. Nothing is checked live before merge.
- Bengali wording. The new lines are English only, because `apps/web/src/i18n` and the services message catalogue are outside this manifest. Follow-up for the localization lane.
- The editor's own stand-in check (`protectedStandIn`, internal to the editor) mirrors the services one. A rendering test keeps the two in step. A shared client-safe module in `packages/core` would be cleaner (outside this manifest).
- How many production rows already hold an encrypted "[protected]". Recommendation, needs the owner's word: a read-only count of current fact versions on protected fields whose decrypted value is the stand-in. Those people now see "This detail needs to be added again".

## Rollback

Revert the PR. No database change, no data change, no new switch.
