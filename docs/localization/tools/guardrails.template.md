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
| File safety | File format checked | Type and structure looked at | ফাইলের ধরন পরীক্ষা করা হয়েছে | পরিষ্কার (clean), নিরাপদ (safe), স্ক্যান, ভাইরাস |
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
| Data actions | Legal hold is আইনি হোল্ড and never সংরক্ষণ (the word for Saved). Export data / share access / download original / safe copy / archive / delete / permanent erasure | Different actions with different effects. Erasure is not available under a legal hold | এক্সপোর্ট / শেয়ার / মূল ফাইল / নিরাপদ কপি / আর্কাইভ / মুছে ফেলুন / স্থায়ীভাবে মুছে ফেলুন | merging any two |

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
- The word for a case (owner decision 2026-11-12) is ফাইল. Uploaded files are also ফাইল. Where one sentence holds both ideas, keep the case as ফাইল and call the upload ডকুমেন্ট or আপলোড করা ফাইল; such strings are listed in `data/CASE_FILE_COLLISION_REVIEW.csv`.
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

<!-- EXAMPLES -->
