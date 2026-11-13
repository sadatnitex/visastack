# Landing page under Bangla: every English string and why (13 Nov 2026)

What a visitor who picks বাংলা sees in English on the public home page (`/`), with the site header, the version notice and the footer, on main at 30f3dd2.

## How this was measured

- The page and the root layout were rendered under locale `bn` through the same server render the unit tests use (`renderServer`), in four states: invite-only pilot signed out, public beta signed out, signed in, and a failed sign-in (`?auth_error=`). Every text node and every `aria-label`, `title` and `alt` with Latin letters was listed.
- A production build and a browser render under `LOCALE_PREVIEW=1 DEPLOYMENT_MODE=development` were attempted first. The build was stopped by the machine's memory limit three times and the development server once (other sessions were running heavy test suites on the same machine). The text list does not depend on the browser; the screenshots and line counts are taken in the typography step.
- The country picker shows more lines after a country is chosen. Those were read from its catalogue and are marked "after choosing".
- Each string's register row was found through the catalogue's `.sources.json` group (or, for the header and footer, through the source census row for the same file and English), then checked against `scripts/i18n/register.mjs` (released queue, HOLDBACK, automated checks, draft).

## Counts by cause

| Cause | Strings |
| --- | --- |
| (a) Register draft passes, not yet refilled into the catalogue | 11 |
| (b) No Bengali draft in the register | 9 |
| (c) Held: legal, consent, sharing or official-rule wording | 14 |
| (c) Held: technical (the draft fails the automated version-wording check) | 6 |
| (d) Not converted: split sentence, sentence with a condition, number joined to a word | 8 |
| (d) Not converted: site header and footer | 17 |
| (d) Not converted: version notice component (wave E owns it) | 6 |
| (d) Not converted: page title (layout metadata) | 1 |
| (e) Intentionally English | 3 |
| Total | 75 |

## (a) Draft passes, not refilled

The release PR's `--refill-bn` (and later refill PRs) fill these. Not refilled here.

| English | Key | Note |
| --- | --- | --- |
| Documents | home.page.documents | phone mockup tab |
| Current | home.page.current | phone and product card tag |
| Employment Letter | home.page.employmentLetteraaddbb | two register rows, same draft |
| Bank Statement | home.page.bankStatement | five register rows, three with the same draft, two empty |
| Who It Is For | home.page.whoItIsFor | accordion kicker (its title is already Bengali) |
| For Agencies | home.page.forAgencies | audience label; three register rows, same draft |
| Available in Beta | home.page.availableInBeta | public beta only |
| Registration is open for public beta, ... | home.page.registrationIsOpenForPublicBeta | public beta only |
| What Works Today | components.versionNotice.whatWorksToday | version notice link |
| Visa Type | home.countryChecklistPicker.visaType | after choosing |
| Create Free Account for {name} | home.countryChecklistPicker.createFreeAccountForName | after choosing, public beta |

## (b) No Bengali draft

Needs a register draft (bn-BD corrections plus the guardrail checker), not part of a conversion wave.

| English | Key |
| --- | --- |
| Free Public Beta | home.page.freePublicBeta |
| Create your free account | home.page.createYourFreeAccount |
| Open your workspace | home.page.openYourWorkspace (the primary button a signed-in visitor sees) |
| Cases | home.page.cases (phone tab) |
| This is a private pilot for invited users, and some features are not switched on yet. | home.page.thisIsAPrivatePilotFor |
| Sign-in didn't complete. Please try again. If it keeps happening, contact support and quote reference | home.page.signInDidnTCompletePlease (failed sign-in only; also split by the bold reference) |
| Continue With {name} | home.countryChecklistPicker.continueWithName (after choosing) |
| Sign In to Start With {name} | home.countryChecklistPicker.signInToStartWithName (after choosing) |
| We keep your country for the next step, so your checklist is waiting. | home.countryChecklistPicker.weKeepYourCountryForThe (after choosing) |

## (c) Held

Legal, consent, sharing and official-rule wording (review queue not signed off, or a HOLDBACK row):

| English | Key | Why |
| --- | --- | --- |
| How VisaStack Treats Your Information | home.page.howVisastackTreatsYourInformation | HOLDBACK (privacy heading); the release PR releases it |
| Record sharing starts with your permission | home.page.recordSharingStartsWithYourPermission | HOLDBACK (consent) |
| AI never changes your profile on its own | home.page.aiNeverChangesYourProfileOn | HOLDBACK (AI) |
| Select records, review the scope and, if you want, set an access end date before agreeing to share. | home.page.selectRecordsReviewTheScopeAnd | HOLDBACK (sharing permission) |
| Invite an agency to see specific items for a set time. ... | home.page.inviteAnAgencyToSeeSpecific | HOLDBACK (sharing permission) |
| It is free to use at your own risk. ... | home.page.itIsFreeToUseAt | HOLDBACK (risk notice), public beta only |
| Please use made-up details, or documents ... | home.page.pleaseUseMadeUpDetailsOr | PRIVACY_CONSENT_LEGAL queue |
| Privacy and sharing are governed by actual product permissions. | home.page.privacyAndSharingAreGovernedBy | PRIVACY_CONSENT_LEGAL queue |
| Pick a visa route and check your file against its requirements. ... | home.page.pickAVisaRouteAndCheck | OFFICIAL_VISA_REQUIREMENT queue |
| See which documents are missing for each visa route | home.page.seeWhichDocumentsAreMissingFor | OFFICIAL_VISA_REQUIREMENT queue |
| Type a name or open the list. Checklists are ready for ... | home.countryChecklistPicker.typeANameOrOpenThe | OFFICIAL_VISA_REQUIREMENT queue |
| For an ordinary Bangladeshi passport. ... | home.countryChecklistPicker.forAnOrdinaryBangladeshiPassportThis | OFFICIAL_VISA_REQUIREMENT queue, after choosing |
| This list may not be complete. ... | home.countryChecklistPicker.thisListMayNotBeComplete | OFFICIAL_VISA_REQUIREMENT queue, after choosing |
| Open the Official Page | home.countryChecklistPicker.openTheOfficialPage | OFFICIAL_VISA_REQUIREMENT queue, after choosing |

Technical: a draft exists but its automated check reads `VERSION_CONCEPT_REVIEW` (the English says "version" and the draft says "copy"), so the codemod and any refill skip it until the register row is corrected:

| English | Key |
| --- | --- |
| One private file for your passport and papers. ... (hero subtitle) | home.page.onePrivateFileForYourPassport |
| Your documents live in your personal record. ... (product intro, right column) | home.page.yourDocumentsLiveInYourPersonal |
| Find your current documents and see their earlier versions. | home.page.findYourCurrentDocumentsAndSee |
| Current version · Updated 8 Oct | home.page.currentVersionUpdated8Oct |
| Previous Version Kept | home.page.previousVersionKept |
| No idea which version an agency is holding | home.page.noIdeaWhichVersionAnAgency |

## (d) Not converted

Landing page (`apps/web/src/app/page.tsx`):

| English | Why not converted | Register (joined form) |
| --- | --- | --- |
| Ready for / what's next. (phone) | sentence split by a line break | PASS draft |
| Keep the details. / Lose the repetition. | split by a line break | row, no draft |
| See exactly / what's missing. | split by a line break | row, no draft |
| Share the part. / Not the whole. | split by a line break | PASS draft |
| Yesterday stays / yesterday. | split by a line break | row, no draft |
| Step 1, Step 2, Step 3 | number joined to a word (`index + 1`) | "Step {value}": PASS draft |
| VisaStack is in a private pilot, so some features ... | condition inside the sentence | "{choice}, so ..." row, no draft for either full sentence |
| VisaStack is in public beta, so some features ... | condition inside the sentence (public beta) | as above |

Site header and footer (`apps/web/src/app/layout.tsx`, written as plain text). The codemod finds most of these as "register ambiguous" because the same English has several register rows; the census row for this file and English names the right one (its line numbers are one behind the current file):

| English | Census register row | State |
| --- | --- | --- |
| Skip to Content | SG-ea39de83 | PASS draft |
| Product | SG-a7e2f146 | PASS draft |
| For Agencies | SG-28e4a888 | PASS draft |
| Privacy and Control | SG-173ca489 | PRIVACY_CONSENT_LEGAL queue (held) |
| How It Works | SG-56ae628e | PASS draft (same key as the page heading, already Bengali) |
| Language (form name) | SG-ce01db35 | no draft |
| Sign In (header and footer) | SG-bd768b6c | no draft |
| Workspace (signed in, header and footer) | SG-809d83a7 | PASS draft |
| Get Started (public beta) | SG-28163d3c | PASS draft |
| © 2026 VisaStack. Proprietary and confidential. | SG-8b351879 | PASS draft; legal notice, proposed HOLDBACK |
| Footer (navigation name) | SG-53112dd6 | PASS draft |
| Features | SG-099866dd | PASS draft |
| Public Trust | SG-c1f08b9e | PASS draft, but it names the page differently from the page's own link ("পাবলিক ট্রাস্ট"); owner question |
| Status | SG-32a41c45 | no draft |
| About This Version | SG-8296a0aa | PASS draft |
| Privacy | SG-e0e720e4 | PRIVACY_CONSENT_LEGAL queue (held) |
| Terms | SG-385c948c | PASS draft |

Version notice (`apps/web/src/components/pilot-banner.tsx`, wave E): the label, the full sentence and the short line, for the invite-only pilot and for the public beta (six strings). Not converted here; the words are data-handling and risk wording, so they would be held even once converted.

Page title "VisaStack - one profile, every visa" (layout `metadata`, a module-level value; no draft).

## (e) Intentionally English

| English | Why |
| --- | --- |
| VisaStack | product name (header, phone label, "VisaStack থাকলে") |
| English | the language switch names the language it switches to (marked `lang="en"`) |
| the failed sign-in reference (for example ref123) | a code to quote to support |

The phone mockup's clock ("9:41") and signal marks are drawn decoration, hidden from screen readers, with no words.

## What the conversion PR changed (claude/magical-curie-3p4qcx-landing)

Every string in (d) on the page, the header and the footer is now one catalogue message (`homeCatalog`, keys `home.page.*` and `home.layout.*`), with `t.node` and `t.lang` marking the language of each part. Bengali came only from passing register rows through the codemod.

- Now Bengali (13 new keys): Ready for what's next; Share the part. Not the whole; Step {value} (Bengali digits); Skip to Content; Product; For Agencies (header and audience label, one key); Get Started; Workspace; the copyright line; Footer; Features; About This Version; Terms. How It Works reuses the page heading's key, which was already Bengali. Sign In (header and footer) reuses the sign-in screen's released message (`auth.authSignInPage.signIn`, সাইন ইন করুন), so one action has one name.
- Still English, needs a draft: Keep the details. Lose the repetition; See exactly what's missing; Yesterday stays yesterday; both "VisaStack is in ..., so some features ..." sentences; Language; Status.
- Still English, held: Privacy and Control, Privacy (PRIVACY_CONSENT_LEGAL queue); Public Trust (new HOLDBACK, see below).
- Not converted: the version notice (component, wave E) and the page title (layout metadata, no draft).
- The copyright line ships under the owner's blanket sign-off on legal wording (13 Nov 2026), not as a reviewed translation. Its year is written as a year in the language the line is shown in (`২০২৬`, never the grouped count `২,০২৬`).
- The codemod now finds a census row for the same file and English when the file's lines have moved (`Register.censusGroupIgnoringLine`), only from census rows within 25 lines of the text, and only when every such row names one register group. That is how the header and footer rows above were matched.

## Owner approval queue: term conflict

| English | Register row | Draft | Conflict | Held until |
| --- | --- | --- | --- | --- |
| Public Trust (footer link to /trust) | SG-c1f08b9e | জনগণের আস্থা | The home page's own link names the same page "পাবলিক ট্রাস্ট" (আমাদের পাবলিক ট্রাস্ট পাতা পড়ুন), and no catalogue has a passing Bengali value for the identical English "Public Trust" to reuse. One page keeps one name. | The owner picks one name for the page; the register row is corrected and the HOLDBACK entry removed in the same change. |

## After the release PR (#560) merged

The release PR released the privacy, consent and legal queue and lifted several holds on the owner's blanket sign-off. On this branch, after merging it:

- Refilled with `codemod.mjs --refill-bn --groups-from RELEASE_CLASSIFICATION_2026-11-12.json`: the header link "Privacy and Control" (গোপনীয়তা ও নিয়ন্ত্রণ) and the footer link "Privacy" (গোপনীয়তা). Both shipped on the blanket sign-off, not as reviewed translations.
- Main's refill already filled these page strings that this audit listed as held: Record sharing starts with your permission, Select records, review the scope ..., Privacy and sharing are governed by ..., Please use made-up details ..., and the home error sentence.
- The Public Trust hold (SG-c1f08b9e) is now also a KEPT row in `RELEASE_CLASSIFICATION_2026-11-12.json`, because the HOLDBACK map must equal that file's KEPT list.
