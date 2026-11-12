# VisaStack semantic guardrails for translation

Status: DRAFT for the editor and a qualified reviewer. English is canonical. These rules say what a translated screen must never claim beyond what the English logic supports. They apply to every language; the Bengali (bn-BD) wording below is a proposal.

Enforcement: `docs/localization/tools/guardrail-check.mjs` checks every draft in the register against these rules (placeholders and markup preserved, required and forbidden Bengali word stems per English term, no stronger claim than the English, banned words). Its self-test runs the guard against the Bengali strings that already sit in `packages/i18n/src/messages.ts` and requires it to fail on the 7 known-wrong ones and pass on the corrected wording; run `node docs/localization/tools/guardrail-check.mjs --self-test`. Automated checks catch word-level mistakes only. They do not replace a human reader.

## 1. The rule above all rules

No language may state a stronger security, compliance, government-filing, official-source verification or visa-approval claim than the English logic supports. When the English is hedged, the translation stays hedged. When a word has no safe equivalent, the translator stops and asks (register value `NEEDS_OWNER_DECISION`), never guesses.

## 2. Language-state invariants

Each row is a set of different facts. A translation must give each English word its own word. Using one Bengali word for two rows is a critical error.

| Set | English words | What each means in VisaStack | bn-BD proposal | Never use for it |
|---|---|---|---|---|
| State words | Saved | Stored in VisaStack. Nothing left VisaStack | সংরক্ষণ করা হয়েছে | জমা (submitted), পাঠানো (sent) |
| | Submitted | Given to a named party inside VisaStack | জমা দেওয়া হয়েছে | সংরক্ষণ, পাঠানো, পাওয়া |
| | Sent | Left VisaStack. Delivery is not implied | পাঠানো হয়েছে | জমা, সংরক্ষণ, পাওয়া |
| | Received | The other side has it | পাওয়া হয়েছে (পেয়েছে in a sentence) | গ্রহণ (accepted), জমা |
| | Reviewed | A person looked at it | পর্যালোচনা করা হয়েছে | যাচাই, অনুমোদিত, নিশ্চিত |
| | Accepted | An invitation or grant was taken | গ্রহণ করা হয়েছে | অনুমোদিত |
| | Verified | One named fact was checked (for example an email address) | যাচাই করা হয়েছে | পরীক্ষা, অনুমোদিত, and never an official-source implication |
| | Approved | A person approved an AI suggestion. Never a visa decision | অনুমোদিত | গ্রহণ, যাচাই, নিশ্চিত |
| | Confirmed | A person confirmed a choice | নিশ্চিত করা হয়েছে | অনুমোদিত, যাচাই |
| | Ready | Ready for the person to use or send | প্রস্তুত | জমা, অনুমোদিত |
| File safety | File format checked | Type and structure looked at | ডকুমেন্টের ফরম্যাট পরীক্ষা করা হয়েছে | পরিষ্কার (clean), নিরাপদ (safe), স্ক্যান, ভাইরাস |
| | Antivirus scanned | A real antivirus scan ran. Today most screens do not claim this | স্ক্যান করা হয়েছে (only where English says scan) | |
| | Held for safety | The file exists but is held back from use | নিরাপত্তার জন্য আটকে রাখা হয়েছে | মুছে, বাতিল (deleted, cancelled), কোয়ারেন্টাইন unless English says quarantine |
| Requirement level | Mandatory | Always needed | বাধ্যতামূলক | ঐচ্ছিক, প্রস্তাবিত |
| | Mandatory if applicable | Needed when the condition is true | প্রযোজ্য হলে বাধ্যতামূলক | shortening to "mandatory" or "optional" |
| | One of several | Any one of the alternatives is enough | এগুলোর যেকোনো একটি দিলেই চলবে | a wording that reads as "all of these" |
| | Recommended | Helpful, not required | প্রস্তাবিত | বাধ্যতামূলক |
| | Optional | Not needed | ঐচ্ছিক | |
| | Unknown | VisaStack does not know yet | জানা নেই | ঐচ্ছিক, প্রযোজ্য নয় |
| | Not applicable | Does not apply to this person | প্রযোজ্য নয় | অজানা |
| Who is asking | Traveller-owned record | The person's own saved facts and files | (their) প্রোফাইল / ডকুমেন্ট | |
| | Agency request | An agency asks the person for something | এজেন্সির অনুরোধ | আবেদন (application) |
| | Agency grant | The person lets an agency see named items | অ্যাক্সেস | |
| | Government visa application | The official application. VisaStack never files it | ভিসা আবেদন | অনুরোধ |
| | Actual government submission | Done by the person or agency outside VisaStack | stated only if English says it | any "we submitted to the embassy" implication |
| Share lifecycle | Invitation link opened | Someone opened a link. They have no access yet | লিংক খোলা হয়েছে | গ্রহণ, অ্যাক্সেস |
| | Grant accepted | The recipient accepted. Access exists within scope | অ্যাক্সেস গ্রহণ করা হয়েছে | |
| | Scope revoked | Access withdrawn for the future | প্রত্যাহার করা হয়েছে | মুছে (deleted) |
| | Downloaded copy already retained | A copy someone saved earlier still exists | আগে ডাউনলোড করা কপি | a promise that revoking removes it |
| Copies | Current copy / earlier document / replaced copy / exact copy / pinned | See `docs/localization/data/BN_BD_CORE_GLOSSARY.csv` T080 to T084 | বর্তমান কপি / আগের ডকুমেন্ট / প্রতিস্থাপিত কপি / হুবহু কপি / নির্দিষ্ট করা | সংস্করণ, ভার্সন, any "Version 2" idea, for document copies. Where the English really says version (a snapshot number, a published checklist pack, a product release), keep the version idea; replacing it with কপি changes the meaning |
| Country roles | Nationality / residence / destination / where you apply | Four different facts | জাতীয়তা / বসবাসের দেশ / গন্তব্য / যেখান থেকে আবেদন করবেন | using one for another |
| Data actions | Legal hold is আইনি হোল্ড and never সংরক্ষণ (the word for Saved). Export data / share access / download original / safe copy / archive / delete / permanent erasure | Different actions with different effects. Erasure is not available under a legal hold | এক্সপোর্ট / শেয়ার / মূল ডকুমেন্ট / নিরাপদ কপি / আর্কাইভ / মুছে ফেলুন / স্থায়ীভাবে মুছে ফেলুন | merging any two |

The word নিরাপদ is allowed only inside the product noun "Safe copy" (নিরাপদ কপি), where the English says safe. It must never describe a format check, a file or a document.

## 3. Critical errors

A draft with any of these must not be released. Each has an automated check where a word-level test is possible.

| ID | Error | Automated check |
|---|---|---|
| C1 | One Bengali word used for two different state words (Saved/Submitted/Sent/Received/Reviewed/Accepted/Verified/Approved/Confirmed/Ready) | GLOSSARY_TERM_MISSING, GLOSSARY_FORBIDDEN_STEM |
| C2 | "Format checked" or "being checked" shown as clean, safe, scanned or virus-free | STRONGER_CLAIM (security, antivirus, virus, cleanliness) |
| C3 | "Held for safety" shown as deleted, or "checking" shown as quarantined | STRONGER_CLAIM (held-back state) |
| C4 | Optional, recommended or unknown shown as mandatory or as not required; the condition in "mandatory if applicable" dropped | GLOSSARY_TERM_MISSING |
| C5 | An agency request shown as a government application, or any sentence implying VisaStack filed an application | needs human review; GLOSSARY_FORBIDDEN_STEM for আবেদন/অনুরোধ |
| C6 | An opened link shown as granted access; revocation shown as erasing a copy already kept | needs human review |
| C7 | "Version 2" style wording (সংস্করণ, ভার্সন) where the English says copy or document; and the reverse, dropping "version" where the English means a real version (snapshot, pack, product release) | BANNED_WORDING, VERSION_CONCEPT_REVIEW |
| C8 | Nationality, residence, destination and place of application swapped | GLOSSARY_FORBIDDEN_STEM |
| C9 | Export, share, download, delete and erase blurred together; erasure promised under a legal hold | needs human review |
| C10 | A stronger claim than English: secure, safe, verified, official, government, approved, guaranteed, encrypted, confirmed | STRONGER_CLAIM |
| C11 | A placeholder or inline tag dropped, renamed or unpaired | PLACEHOLDER_MISMATCH, MARKUP_MISMATCH |
| C12 | Gendered or Indian-Bengali wording where a neutral Bangladeshi word exists (for example নাবালক) | BANNED_WORDING |

## 4. Wording rules (bn-BD)

- Politeness: polite আপনি throughout; buttons use করুন, দিন, পাঠান. Third person is gender neutral; do not add gender.
- Documents are ডকুমেন্ট (never দলিল, which means a deed). Files, upload, download, account, profile, password keep the common loanword forms.
- Sign in is সাইন ইন (Firefox and Google Bengali use it; see the platform evidence file). Create account is অ্যাকাউন্ট তৈরি করুন.
- Blame free errors: "কিছু একটা সমস্যা হয়েছে". Google Bengali uses "কিছু ভুল হয়েছে"; the editor may keep that, but never "আপনি ভুল করেছেন".
- Digits (owner decision 2026-11-12): Bengali digits in prose. Identifiers a person types or reads back (passport number, document number, codes, email addresses) keep their original characters. Counts, dates, times and amounts come from the bn-BD locale formatter, which gives Bengali digits and lakh grouping by default. The checker warns on Latin digits in prose (`WARN_LATIN_DIGITS`).
- Amounts keep the ISO currency code beside the number (owner decision 2026-11-12), for example `১৫০.০০ USD`. No currency symbol, no conversion.
- The word for a case (owner decision 2026-11-12) is ফাইল, written ভিসা ফাইল in every draft so it cannot be read as an uploaded file. Uploaded evidence is ডকুমেন্ট, or আপলোড করা ডকুমেন্ট where the upload must be named. Bare ফাইল is not used for either object and the checker rejects it (`CASE_UPLOAD_AMBIGUITY`). The navigation label Documents is ডকুমেন্টস (`NAV_DOCUMENTS`). নথি is not used; দলিল is used only for real deeds. Strings holding both objects are listed in `data/CASE_FILE_COLLISION_REVIEW.csv`.
- Sentence end: the danda "।". No letter-spacing, no forced capitals, no italic or faux bold. Allow line height of at least 1.6 for Bengali matras and conjuncts, and never cut text inside a conjunct.
- The English display rule of Title Case Terms and sentence case sentences does not apply to Bengali (no letter case); the product's title-casing function must be skipped for Bengali.

## 5. Placeholders, plurals, formality, bidi

- Placeholders `{name}` and tags `<strong>..</strong>` are kept exactly, and may move to fit Bengali word order (verb last).
- English plural switches (`item{s}`, `(s)`) must not be copied. Bengali counts use a classifier ("{count}টি ডকুমেন্ট", persons "জন"). CLDR plural categories for Bengali: `one` (0 and 1) and `other`. A message that needs true plural logic should become an ICU message, not string concatenation.
- Sentences built from fragments (see composed rows in the census, `jsx_composed`) must be translated as one unit.
- Names, emails, document numbers and codes stay Latin; Bengali and Latin are both left-to-right, so bidi mixing is not a problem for Bengali. For any right-to-left language, wrap each such run in an isolate (`<bdi>` or `dir="auto"`).

## 6. Review standards

- Reviewers (owner decision 2026-11-12): the owner is both editor and legal reviewer. Legal, consent, privacy, terms, billing and official-rule text (register column `qualified_review_required`) is flagged because the brief asks for a qualified reviewer where one is needed; an owner as editor is not by itself a substitute. The decision is recorded as the owner's own, nothing has been reviewed yet, and the owner should sign legal text off explicitly knowing that.
- Drafts are `DRAFT_NOT_FOR_RELEASE`. A string becomes releasable only after: editor sign-off, automated checks passing, review of the string in context on a screenshot at phone width, and screen reader name check. Nothing is released by this work.

## 7. Locale research notes (not drafts)

These notes are for the owner's later launch decision. No translation into these languages has been started, and none is justified until a launch locale is chosen. All rules need confirmation by a native qualified reviewer.

| Locale | Direction and script | Plural categories (CLDR) | Politeness and gender | Typography and layout | Numbers and dates |
|---|---|---|---|---|---|
| bn-BD | LTR, Bengali | one, other (0 and 1 are both `one`) | আপনি; gender neutral | Noto Sans Bengali; line height 1.6+; no italics; text is about 10 to 25 percent longer than English | Gregorian; Bengali digits (owner decision); lakh grouping; BDT ৳. Verified on this machine's ICU: `1234567.5` formats as `১২,৩৪,৫৬৭.৫`, `25000 BDT` as `২৫,০০০.০০৳`, a date as `১২ নভেম্বর, ২০২৬` |
| ar | RTL, Arabic | zero, one, two, few, many, other | Formal standard Arabic; gender agreement affects verbs and adjectives, so use neutral phrasing | Mirror layout and directional icons; isolate Latin runs; no letter-spacing; Arabic punctuation ، ؟ | Digits depend on region (Latin common in the Gulf and Maghreb; Arabic-Indic in others); decide per market |
| fr | LTR | one (0 and 1), many (millions), other | "vous"; gender agreement (prêt/prête) so use neutral wording | Narrow no-break space before ; : ? ! and inside « »; text about 15 to 20 percent longer | 1 234,56 with narrow no-break space; dd/MM/yyyy |
| de | LTR | one, other | "Sie"; avoid gender stars; use neutral nouns | Long compounds need hyphenation rules and wider buttons (about 30 percent longer); all nouns capitalised | 1.234,56; dd.MM.yyyy |
| es | LTR | one, many (millions), other | "usted" or "tú" must be chosen; es-419 and es-ES differ in vocabulary | Opening ¿ and ¡; about 25 percent longer | 1.234,56 (es-ES) or 1,234.56 (es-MX); dd/MM/yyyy |
| zh-Hans | LTR, Simplified Han | other | "您"; no grammatical gender | Full-width punctuation; no spaces between words; no italics; line breaking rules; text is shorter but needs larger line height | Latin digits; yyyy年M月d日; family name first |

## 8. Real examples from the census

The tables below are generated from the census (rows carrying each guard tag), so reviewers see the real wording each rule applies to.

### State words (G1_state_word): 551 rows, 465 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-02dc7f77a5 | Cases First Reaching Ready | `app/app/admin/page.tsx:66` (seen on a screen) |
| SRC-05a49033e0 | Sent Back for a Fix | `components/request-thread/thread-model.ts:12` (seen on a screen) |
| SRC-05ea852db5 | This case must reach "Submission Ready" (with a live acknowledgement) before a submission can be reported. | `app/app/mission/[id]/submission-report-panel.tsx:128` (seen on a screen) |
| SRC-06c7c891fb | Approved File Versions | `app/app/admin/page.tsx:370` (seen on a screen) |
| SRC-08114fd9f9 | Sharing follows your saved permissions. | `app/app/workspace-shell.tsx:394` (seen on a screen) |
| SRC-08787a5df7 | The text of a document is sent to an AI service to suggest values. You approve each one. | `lib/labels.ts:244` (seen on a screen) |
| SRC-088b07da22 | Provider acceptance is different from delivery. Receipt endpoint registration and signed events must also be verified. | `lib/provider-operations.ts:131` (seen on a screen) |
| SRC-10383ec347 | Approved Medical Centre Result | `core/src/catalogue/documents.ts:1260` (seen on a screen) |

### File safety (G2_safety_check): 38 rows, 33 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-0bb3f749d7 | Held for Safety | `lib/scan-state.ts:91` (seen on a screen) |
| SRC-5966316bc3 | The file type and structure were checked. It has not been scanned for viruses. | `lib/scan-state.ts:60` (seen on a screen) |
| SRC-96c8506898 | Sends scan pictures, not just text, to an AI. | `lib/labels.ts:278` (seen on a screen) |
| SRC-b0830845c5 | The picture of a scan is sent to an AI service to read it. This shares more than text alone. | `lib/labels.ts:249` (seen on a screen) |
| SRC-0dc984915a | this image failed the required safety scan | `services/src/branding.ts:295` |
| SRC-2483eed991 | 2 Copy of Passport bio page & copy of previous travel history (Hard Copy + Scan JPG) | `core/src/starter-checklists/seed-rows.ts:3590` |
| SRC-2871f3175e | {PDF_NEEDS_SCAN_TEXT} Add a photo or scan of each page as a JPG or PNG instead. | `lib/upload-rules.ts:158` |
| SRC-30c2f803b9 | We are making sure this file is safe to open. This page updates by itself. | `lib/document-reading.ts:28` |

### Requirement level (G3_requirement_level): 302 rows, 203 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-044203af44 | Destination Country (Optional) | `app/app/admin/packs/pack-forms.tsx:76` (seen on a screen) |
| SRC-05845aa791 | Still Unknown or Needs a Look | `app/app/applicant/[id]/outputs/page.tsx:126` (seen on a screen) |
| SRC-15456ff555 | Linked Pack (Optional) | `app/app/admin/packs/sources/source-forms.tsx:153` (seen on a screen) |
| SRC-1adf161996 | Some required items are missing, out of date or do not match. | `app/app/mission/[id]/case-model.ts:248` (seen on a screen) |
| SRC-280bbc9e36 | What the Terms Say (Optional) | `app/app/admin/ai-settings/forms.tsx:905` (seen on a screen) |
| SRC-2e7612827c | Helps us improve - not required | `app/app/privacy/deletion-panel.tsx:168` (seen on a screen) |
| SRC-33c77ba0a1 | Requested Route (Optional) | `app/app/agency/[orgId]/client-invitation-form.tsx:70` (seen on a screen) |
| SRC-3fd82f942b | Evidence (Optional) | `app/app/mission/[id]/outcome-panel.tsx:149` (seen on a screen) |

### Who is asking (G4_who_is_asking): 157 rows, 116 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-0079fec455 | Government Order | `core/src/catalogue/documents.ts:1938` (seen on a screen) |
| SRC-0559a7741d | Embassy or Consular Staff and Dependants | `core/src/catalogue/purposes.ts:544` (seen on a screen) |
| SRC-0d2084bf17 | Every grant expires. Leave blank for the 30-day default; the maximum is 90 days. | `app/app/applicant/[id]/sharing/grant-form.tsx:433` (seen on a screen) |
| SRC-0fe4ead193 | Registered accounts, separate from platform staff roles. Verification does not grant administrator access. | `app/app/admin/members/page.tsx:75` (seen on a screen) |
| SRC-16fad49d92 | No cases are reachable yet - a traveller must grant this organization access to a specific case. | `app/app/agency/[orgId]/cases/page.tsx:189` (seen on a screen) |
| SRC-249336e088 | Grant Role | `app/app/admin/admin-forms.tsx:116` (seen on a screen) |
| SRC-260445b0d3 | Grant Access | `app/app/applicant/[id]/sharing/page.tsx:446` (seen on a screen) |
| SRC-315be58e3a | What actually happened to your data, not just what a grant permits. | `app/app/applicant/[id]/sharing/page.tsx:713` (seen on a screen) |

### Share lifecycle (G5_share_lifecycle): 386 rows, 310 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-1137c1093d | Details we read from your documents. Nothing is added to your profile until you accept it. | `app/app/applicant/[id]/review/page.tsx:193` (seen on a screen) |
| SRC-172634b8eb | Send the Link Again | `app/auth/verify-email/page.tsx:48` (seen on a screen) |
| SRC-2884a6ec6b | Turn On Calendar Link | `app/app/applicant/[id]/calendar/calendar-feed-panel.tsx:161` (seen on a screen) |
| SRC-29357bb501 | Invite-Only Pilot | `app/page.tsx:261` (seen on a screen) |
| SRC-2ce26a6e74 | Completeness only. It says nothing about whether an application will be accepted | `services/src/selected-output-views.ts:470` (seen on a screen) |
| SRC-446dfddfec | Accepted and Revoked | `app/app/admin/access/page.tsx:237` (seen on a screen) |
| SRC-4c169b0ebb | Someone wants to share their information with you. Nothing is shared until you accept. | `app/app/(home)/page.tsx:189` (seen on a screen) |
| SRC-4f19c35c5b | Access Ends 30 November | `app/page.tsx:75` (seen on a screen) |

### Copies and versions (G6_copy_version): 260 rows, 212 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-12c8a26606 | Current record · Version 2 | `app/page.tsx:37` (seen on a screen) |
| SRC-194a2b62ca | Withdraw Version | `app/app/admin/packs/pack-version-buttons.tsx:130` (seen on a screen) |
| SRC-1b93f1ad4e | Find your current documents and see their earlier versions. | `app/page.tsx:409` (seen on a screen) |
| SRC-22e5f78469 | Where you live now. Earlier addresses can wait. | `lib/profile-essentials.ts:43` (seen on a screen) |
| SRC-2bd93ab41d | Make a country list your own. Your cases offer your version, and the shared one stays as it is. | `app/app/agency/[orgId]/checklists/page.tsx:60` (seen on a screen) |
| SRC-372b2b0d13 | The agency can download this exact copy while it has access. | `app/app/applicant/[id]/evidence/submit-response-form.tsx:29` (seen on a screen) |
| SRC-37863c095b | Version Diff | `app/app/admin/packs/[packId]/diff/page.tsx:62` (seen on a screen) |
| SRC-3ab31c3e0c | Some earlier sends have no time on record. | `components/request-thread/request-thread.tsx:13` (seen on a screen) |

### Country roles (G7_country_role): 61 rows, 52 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-044203af44 | Destination Country (Optional) | `app/app/admin/packs/pack-forms.tsx:76` (seen on a screen) |
| SRC-0559a7741d | Embassy or Consular Staff and Dependants | `core/src/catalogue/purposes.ts:544` (seen on a screen) |
| SRC-22e5f78469 | Where you live now. Earlier addresses can wait. | `lib/profile-essentials.ts:43` (seen on a screen) |
| SRC-26b3b75cbe | Permanent Residency by Long Residence | `core/src/catalogue/purposes.ts:417` (seen on a screen) |
| SRC-4a42603f86 | Where you apply, not the country you travel to. Some checklists differ by embassy or visa centre. | `app/app/mission/[id]/mission-buttons.tsx:53` (seen on a screen) |
| SRC-4bb4480219 | Host Residence Proof | `core/src/catalogue/documents.ts:2177` (seen on a screen) |
| SRC-4cace4cfc4 | Temporary Residence Permit | `core/src/catalogue/documents.ts:435` (seen on a screen) |
| SRC-6be4286880 | Search covers only the cases you are already allowed to see, by traveller, case title, reference, destination or stage. | `app/app/agency/[orgId]/page.tsx:452` (seen on a screen) |

### Data actions (G8_data_action): 460 rows, 372 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-033cb71cf5 | Record sharing starts with your permission | `app/page.tsx:149` (seen on a screen) |
| SRC-08114fd9f9 | Sharing follows your saved permissions. | `app/app/workspace-shell.tsx:394` (seen on a screen) |
| SRC-102628ef25 | Notes an agency working this case has chosen to share with you. An agency's own internal notes are never shown here. | `app/app/mission/[id]/case-secondary.tsx:230` (seen on a screen) |
| SRC-125ba06b0a | How Sharing Works | `app/app/shared/(list)/page.tsx:43` (seen on a screen) |
| SRC-18717eb76e | Permanent Residency by Points | `core/src/catalogue/purposes.ts:396` (seen on a screen) |
| SRC-1a8cd99cdd | Restores After Archive or Delete, Last 30 Days | `app/app/admin/lifecycle-measures.tsx:33` (seen on a screen) |
| SRC-1aac4eb887 | Sharing decisions are recorded | `app/page.tsx:150` (seen on a screen) |
| SRC-1bb3ff252a | Back to Sharing | `app/app/applicant/[id]/sharing/page.tsx:479` (seen on a screen) |

### Claim strength (G9_claim_strength): 217 rows, 183 distinct texts

| Source id | English | Where |
|---|---|---|
| SRC-02780ce8b4 | Agency lists, not official. Travellers pick them and change items on their case. | `app/app/admin/packs/import/page.tsx:33` (seen on a screen) |
| SRC-071218fb4e | Standard setting, never changed. | `app/app/admin/document-protection/page.tsx:68` (seen on a screen) |
| SRC-102628ef25 | Notes an agency working this case has chosen to share with you. An agency's own internal notes are never shown here. | `app/app/mission/[id]/case-secondary.tsx:230` (seen on a screen) |
| SRC-154fac3656 | Details that only some purposes need: study, work, business, family, official. | `core/src/catalogue/layers.ts:47` (seen on a screen) |
| SRC-19bf1abd04 | For an ordinary Bangladeshi passport. Rules change, so confirm on the official page before you apply. | `app/app/countries/country-view.tsx:175` (seen on a screen) |
| SRC-1ba9ae05ce | This list may not be complete. Check the official page for everything you need to submit. | `app/app/countries/country-view.tsx:109` (seen on a screen) |
| SRC-1d49f1995c | Official Sources | `app/app/admin/packs/corrections/page.tsx:168` (seen on a screen) |
| SRC-1f328e2bbb | Official Fee | `app/app/admin/packs/[packId]/page.tsx:569` (seen on a screen) |

