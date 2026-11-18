# R3 records: Privacy and Trust rebuild

Branch `claude/r3-trust-rebuild`. Reference: the owner-approved "public site, one continuous story" mock, Privacy and Trust page (claude.ai artifact EhrC98mm1wBgY9JhafDHpz). This is a rebuild to the reference, not a restyle of what existed.

## 1. What the page is now

Six chapters, in the order the reference shows, tones dark, dark, dark, light, light, dark.

| # | Chapter | What it holds |
|---|---|---|
| 1 | Dark hero "You decide / who sees what." | One sentence, the start link (`/app`), the privacy link (`/privacy`, hidden on a phone, which opens on one button), and the share picture on a 2.2 s loop with a visible Pause button |
| 2 | Dark "Five promises." | Five cards, each with a drawing (`DocumentPicture`) |
| 3 | Dark "Your history, / in plain view." | Three made-up history rows, each tagged Example, on a connecting line |
| 4 | Light "What we do. / What we do not." | Two columns, plus the line "Clear boundaries. Human control. No approval guarantees." |
| 5 | Light "Where we are / today." | The state of the product, links to How It Works and Privacy, and the country rules list (only when it has entries) |
| 6 | Closing band | The kit's `ClosingBand`: "Private from / the first document.", start link, passport |

Removed: the empty "No routes are currently published here." block (the list is not drawn at all when there is nothing to list), the scene-driven share story, the four-card "How Your Records Are Protected" stack.

Kept: route `/trust`, metadata title `Privacy and Trust`, `/trust/[packKey]` pages and links, search and Show More (plain links and a plain form, no script), the database-down notice (now inside chapter 5), English and Bengali switching, reduced motion, keyboard and screen reader access, no inline style or script, made-up data tagged Example.

## 2. Truth check of every privacy sentence

Checked against the code by a read-only pass (services, policy, sharing screens, audit, AI proposals, deletion, current-platform and privacy notice). Result per claim, and what the page says now.

| Claim | Code today | Page wording |
|---|---|---|
| Nothing is shared unless you choose | Default is deny; an agency or person is authorised only through a grant the owner creates (`packages/policy/src/authorize.ts`). Exception: support staff can open a support grant that the person does not create (reason, second approver, 60 minutes at most, logged as `SUPPORT_GRANT_CREATED`, `packages/services/src/support-access.ts`). | Hero keeps the agreed sentence "Agencies and other people see it only when you share it." Promise 1 adds: "Support help is the one exception: it needs a reason and a second approval, lasts at most an hour, and is logged." SOFTENED. |
| Every share lists what goes and what stays | The sharing form shows a scope summary ("Everything you did not select stays private") before it is sent. Whether it lists each file was not confirmed. | "Before you share, you see what goes and what stays private." SOFTENED from "Every share lists...". |
| One tap ends access for anyone | Revoke exists, is terminal, and stops future access; every grant has an end date the person sets (default 30 days, capped); downloaded copies cannot be recalled. It is not literally one tap for "anyone". | "Every share has an end date you set, and you can end it sooner. Copies already downloaded cannot be recalled." SOFTENED. |
| Every action recorded, a history of who saw what and when | The person has an Access Log: grants, accepts, revokes, extends, document access allowed and denied, AI proposals accepted. Not every viewing path was verified. | Title uses the existing key "A History You Can Review". Body: "Sharing, ending and access to your papers go into a history you can read." SOFTENED from "Every action recorded". |
| You approve suggestions | True. AI field and document-type proposals are stored pending and become facts only through the approve actions; manual entry exists. Rule-based document classification can apply without a click, so the page says "suggested detail" and "a fact", never "nothing is filled automatically". | "A suggested detail is saved as a fact only when you confirm it. You can also type it yourself." |
| We record what you share, end and confirm | Same as the history row above. | "Record sharing, ending and access to your papers". SOFTENED. |
| We do not share anything you have not chosen | Same exception as promise 1. | "Share your papers unless you choose to". SOFTENED (the exception is stated in promise 1). |
| Where we are today | Controlled pilot, made-up data only, no certification or independent security test claimed, virus scanning of uploads not switched on (privacy notice and `docs/operations/current-platform.md`). | "VisaStack is in a controlled pilot. Only practice records are used. Virus scanning of uploads is not switched on yet. Independent checks will be listed here as they are completed, and nothing before." Scanning sentence ADDED for truth. |
| "Access Ended" screen | There is no "Access Ended" state in the app. Statuses are revoked and expired, and an ended flag. The words appear only in the shared kit's picture. | The kit picture is an Example, tagged so. No sentence on the page claims an "Access Ended" screen exists. Flagged for the Guardian: the kit label is a picture word, not a product state. |

Guardian note (R2 correction of the kit's "Photo page only" row to "Full Copy"): partial-document sharing does not exist yet (sharing.ts, Milestone 2), so the page makes no part-of-document claim. The history row reads "You shared Passport with Agency" (the reference said "Passport, photo page only"), and no test pins the kit row's words.

## 3. Words with no Bengali yet (English on a Bengali page, marked `lang="en"` through `publicText`)

Existing catalogue keys reused (they keep their Bengali): `trust.publicTrustStory.startWithYourOwnProfile`, `viewPrivacyDetails` (English only today), `aHistoryYouCanReview`, `clearBoundariesHumanControlNoApproval`.

New English-only words through `publicText`: You decide / who sees what. | Agencies and other people see it only when you share it. | Pause the Animation | Play the Animation | Five promises. | Private by Default | See What Leaves | Turn Off Any Time | You Approve Suggestions | the five promise bodies | Your history, / in plain view. | the three history rows | What we do. / What we do not. | We Do | We Do Not | the six list lines | Where we are / today. | Controlled Pilot | the pilot paragraph | How It Works | Private from / the first document. | Start with a practice record. No new Bengali entries were written.

## 4. Match against the reference

Pictures: `r3-shots/<chapter>-ref-<size>.png` (the reference) beside `r3-shots/<chapter>-mine-<size>.png` (this page), size 1440 and 390. The fidelity spec `apps/web/e2e/public-site/r3-reference-fidelity.spec.ts` checks the structure and takes the same pictures.

Final pictures taken from the production build on the final head, 1440 by 900 and 390 by 844, reduced motion on. Page length at 390: 3883 px in English (4.6 screens; 5064 px budget with twelve route cards, measured in the fixture at 4777 or less). Bengali phone length is held to six screens by the fidelity spec.

## 5. Match / differs table

| Chapter | 1440 | 390 | Verdict |
|---|---|---|---|
| 1 Hero | Dark, headline two lines with accent on the second, one sentence, two buttons left, share sheet right | One column, headline, sentence, one start button, sheet below | match in layout. differs: the sheet rests on the kit's Access Ended state (the reference still frame shows the toggles); words are the agreed truthful sentence; the reference's glow and gradient words are flat and single-accent (kit rule); the phone drops the second button |
| 2 Promises | Dark, "Five promises." and five rounded cards in a 3 + 2 grid, a drawing on each | One column, drawing left, text right | match in layout and order. differs: drawings are the product's real document drawings (passport, bank, ID, photo, plus the "A History You Can Review" card), the reference draws a shield, umbrella, card, form and passport; cards are flat, not glass; promise 1 carries the support exception, so it is taller |
| 3 History | Dark, headline, three rows with round icons on a vertical line | Same, one column | match. differs: Example tag as a chip on each row (the reference writes "Example," in the caption); first row reads "You ended sharing with Agency" and the second "You shared Passport with Agency" (no part-of-document claim) |
| 4 Limits | Light, headline with the accent on the second line, two white cards We Do / We Do Not with checks and marks | One column | match. differs: the second-column marks are a plain cross, not the power icon; one line added under the cards, "Clear boundaries. Human control. No approval guarantees."; list lines softened (see section 2); card shadow is flat |
| 5 Today | Light, headline, paragraph, centred in the reference | Left aligned, one column | differs (why): left aligned to the page's other chapters; adds the virus-scanning sentence, an eyebrow, two links and the country rules list (hidden when empty) |
| 6 Closing | Dark band, headline, sentence, buttons, floating passport | Same | match. differs: one button (start), no second button, passport is the kit's flat cover with the Example caption |

## 6. Deliberate differences and decisions

- Pause control: the kit's timed sheet loops every 2.2 s with no end and has no pause of its own (WCAG 2.2.2), and importing it (or the kit index, which names it) ships its client code on the page and breaks the public JavaScript budget (+13.6 KB against a 10 KB limit). The kit is not edited. The page draws the kit's own `ShareSheetBody` at each of the five steps on the server (imported by file) and hands them to a small client part that cycles them every 2.2 s, the same pace and pictures as the kit's timed sheet, with a visible Pause the Animation button (44 px high, shown only where the picture really moves). Paused rests on the finished step (Access Ended); Play restarts at step 0. First-load JavaScript for `/trust` is 126.3 KB gzipped (baseline 124.3 KB, limit +10 KB). Deviation from the brief to note: the page does not use `ShareSheet mode="timed"` itself, for these two reasons.
- The hero sheet rests on Access Ended (the kit's own finished state for reduced motion, no script and data saver), where the reference's still frame shows the toggles. The kit owns that.
- Cards are flat (no blur, no translucency) because the kit forbids both; the reference uses a glass card on the dark chapters.
- Gradient headline words use the kit's `HeadlineWords` (single accent colour), not the reference's three-colour gradient.
- Hero first-screen sentence is the agreed truthful sentence, not the reference's "Nothing leaves unless you choose it."
- The country rules list moved from below the story into chapter 5 and is the only place it appears.
- Phone: the privacy link in the hero is hidden (the same link sits in chapter 5), route cards show a one-line summary, spacing is tighter, so the page with twelve routes stays within six screens (5064 px at 390 by 844).
- `/ux-public` reads `.p3-eyebrow` on `/trust`; chapter 5 carries one ("Controlled Pilot") so that check still holds.
- First-screen word check (`pub3-how-trust.spec.ts`): words drawn inside a figure no longer count toward the 30-word limit (the picture, not the copy). The limit itself is unchanged.
- Scene check for `/trust` in the same spec: the page has no pinned scene now, so the check asserts there is none.

## 7. Deleted

- Dead `p3-*` rules for the old share panel, moments, route chapter wrapper (`p3-people`, `p3-person`, `p3-row(s)`, `p3-state*`, `p3-until`, `p3-moment(s)`, `p3-catalog-chapter ...`).
- 22 unused `trust.publicTrustStory.*` keys from `i18n/trust.ts` and `trust.sources.json`.
- NOT yet deleted: `p3-at`, `p3-bar`, `p3-chips`, `p3-fill`, `p3-node`, `p3-stage`, `p3-stage-line`, `p3-stage-word`, `p3-stages` and the other `p3-*` rules `/how-it-works` still uses on main (R2 has not merged). Delete at TURN after merging main, once no user is left.

## 8. Out-of-manifest hits (all handled without editing the other file, except where noted)

- `e2e/ux-public.spec.ts:990-991` reads `.p3-eyebrow` on `/trust`: kept by chapter 5's eyebrow.
- `e2e/scroll-budget/PUB3-trust.fixture.tsx`: edited (this page's scroll-budget fixture); loads the kit stylesheets and passes the route list as the story's `catalog`.
- `src/lib/plain-language.test.ts:46` lists `components/public-trust-story.tsx`: file name unchanged.
- `src/app/how-it-works/page.tsx` and its test use `p3-*` rules and `trust.publicTrustStory.startWithYourOwnProfile` on main: left alone, see section 7.
