# Proposal: extending `packages/i18n` for a safe, later language release

Status: PROPOSAL ONLY. Nothing here is built, enabled or released. The language switch stays off (`LANGUAGE_CHOICE_ENABLED = false` in `apps/web/src/lib/language-choice.ts`, confirmed on main) and every page stays English. This document is bounded: it adds no route renames, no privilege changes, no data migrations and no premature release.

Evidence base: `VISASTACK_COVERAGE_REPORT.md` (counts and gaps), `VISASTACK_UI_SOURCE_CENSUS.csv` (every anchored string), `VISASTACK_SEMANTIC_GUARDRAILS.md`, `data/BN_EXISTING_CATALOGUE_REVIEW.csv`.

## 1. What exists today (verified in the repo)

| Item | State |
|---|---|
| `packages/i18n` | Flat catalogue of 46 English keys and 45 Bengali keys (`messages.ts`), `{token}` interpolation, English fallback, no plural or ICU support |
| Who uses it | 7 web files call `createTranslator`; 10 files read the locale. About 18,000 other strings are written directly in components, services and catalogues |
| Locale choice | A cookie `visastack_locale` (values `en`, `bn`), ignored while the switch is off. No account-level preference |
| `<html>` | `lang` is set from the locale; `dir` is never set |
| Dates and numbers | 44 `toLocale*` and `Intl` calls; 30 fix the locale to English |
| Display casing | The product title-cases terms when drawing them (owner rule, 25 Oct 2026); Bengali has no case |
| Fonts | Noto Sans Bengali is already served for the web. PDFs embed a Latin-1 Inter subset only. The email layout is fixed to `lang="en"` |
| Existing Bengali | 26 of 46 entries are flagged (6 critical, 8 high) (for example "Format Checked" shown as "পরিষ্কার", clean) |

## 2. Stop-ship items before the switch is ever turned on

1. Correct the Bengali catalogue entries listed as CRITICAL and HIGH in `data/BN_EXISTING_CATALOGUE_REVIEW.csv`. With the switch on today, a person would read that a file is clean when the English says only its format was checked.
2. Pass the guardrail self-test and the register checks in CI (Section 6).
3. Fix `.skip-link` to use a logical property (`inset-inline-start`); under `dir=rtl` the physical `left: -999px` blanked the entire page in the review packet probe.

## 3. Design (extends, does not replace)

**3.1 Locale model.** Keep the cookie and the values `en` and `bn`. Add a mapping layer in `packages/i18n`: `bn` resolves to the BCP 47 tag `bn-BD` for formatting and for `<html lang>`. No new cookie, no account field, no migration. An account-level saved preference is out of scope here because it needs a database column; if wanted later it is its own approved change.

**3.2 Catalogue.** Keep `MessageKey`, `createTranslator` and `{token}` interpolation working unchanged so existing callers do not break. Add:

- ICU MessageFormat support through a maintained library (`intl-messageformat`) behind the same `createTranslator` call, used only for messages marked as ICU. It gives plural categories per CLDR (Bengali: one and other; Arabic: six) and select/gender forms.
- Rich text: allow inline tag markers (`<strong>..</strong>`, `<link>..</link>`) in messages, rendered through a small React helper, so sentences such as the 583 composed units in the census stay whole instead of being split around tags.
- Stable ids: new keys are the census semantic-group ids (`SG-xxxxxxxx`) or readable names mapped to them, so each string has one owner and a review record. The register CSV is the source for review state; the runtime reads only strings whose release state is `RELEASED`.
- Per-locale files (`en.ts`, `bn.ts`) with the English file generated type-wise as the key source, as today.

**3.3 Adoption in thin slices, one surface at a time** (each slice is its own reviewed change; no big bang):

| Slice | Scope | Why first |
|---|---|---|
| 1 | Status and label maps that already exist (`grant-status.ts`, document status, relationship labels, `labels.ts`, `depth-words.ts`) | Small, high-risk wording, already centralised |
| 2 | Navigation, buttons, validation and refusal messages in server actions (`message` rows) | Short strings, consistent glossary |
| 3 | Sign-in and account screens | Public entry, attested wording |
| 4 | Traveller journeys J04 to J11 | The highest-value flows |
| 5 | Agency screens and guest request | After the glossary is confirmed with agency users |
| 6 | Emails, PDF, calendar and export files | Needs locale-aware templates and fonts (Section 4) |
| Last | Admin and platform staff | English may stay English; a business decision |

**3.4 Formatting.** Add one helper (`formatDate`, `formatNumber`, `formatList`, `formatCountryName`) that takes the resolved locale, and replace the 30 English-fixed calls as each slice lands. Country names use `Intl.DisplayNames` with the locale instead of `['en']`.

**3.5 Display rules.** Make the title-casing function a no-op for locales without letter case. Never apply `text-transform` to Bengali.

**3.6 Direction.** Set `<html dir>` from a locale property (`ltr` for `bn`, `rtl` only for a future `ar`). For Bengali no CSS change is required beyond the skip-link fix. For any right-to-left language, first convert the physical-direction rules in `globals.css` (about 200 lines use left, right, margin-left, padding-right, border-left and similar) to logical properties; the RTL probe screens inspected by hand (the documents screen) mirror because they use flex and logical properties, but not every probe image was inspected, so the size of this clean-up is unverified.

## 4. Outputs

- **Email**: add a locale parameter to `email-design.ts`, set `lang` and a Bengali-capable font stack, and translate subject, preheader and body together. Use plain text parts too.
- **PDF**: embed a Bengali font (Noto Sans Bengali, already licensed in the repo) and use a shaping-capable path; the current Latin-1 subset cannot draw Bengali. Test with real conjuncts (for example ক্ষ, স্ত্র).
- **Calendar, export, safe copy, archive README, WhatsApp text**: pass the locale; keep machine-readable parts (file names, codes) in Latin.

## 5. What this proposal deliberately does not do

- No route renames or locale URL prefixes (a cookie keeps every URL as it is today).
- No change to permissions, sharing, consent logic or data.
- No new database table or column, no migration.
- No enabling of `LANGUAGE_CHOICE_ENABLED` or any flag.
- No translation of legal text, official rule content or billing text without a qualified reviewer.

## 6. Tests and release gates

1. **Guardrail test in CI**: run the logic in `docs/localization/tools/guardrail-check.mjs` against every released string; fail on placeholder mismatch, missing glossary stem, stronger claim or banned word. Keep the self-test so the guard is proven able to fail.
2. **English stays canonical**: a test that every released key exists in English and that English output is byte-identical before and after each slice.
3. **Pseudo-locale**: an accented, 40 percent longer pseudo locale and a right-to-left pseudo locale in the browser checks, to catch clipping and concatenation before any real translation.
4. **Browser checks** at 390 px for Bengali: no sideways scroll, no clipped controls, line height, touch targets, screen reader names in Bengali.
5. **Per-string release state**: `DRAFT_NOT_FOR_RELEASE` to `EDITOR_APPROVED` to (for legal text) `QUALIFIED_REVIEW_APPROVED` to `RELEASED`. A locale ships per surface, not all at once.
6. **No claim drift**: any change to an English guarded string forces its Bengali back to `NEEDS_REVIEW`.

## 7. Effort and risk (order of magnitude)

| Piece | Size | Main risk |
|---|---|---|
| Stop-ship fixes (Section 2) | small | None if the corrected wording is approved |
| Catalogue upgrade (ICU, rich text, ids) | medium | Keeping all current callers working |
| Slices 1 to 3 | medium | Wording sign-off, not code |
| Slices 4 to 5 | large | About 4,000 core UI strings and sentence restructuring (plural switches, composed sentences) |
| Emails and PDF | medium | Font embedding and template restructuring |
| Staff screens | optional | Low value |

## 8. Decisions

Made by the owner on 2026-11-12 (recorded in `data/drafts/OWNER_DECISIONS.json` and applied to the register):

| Decision | Choice | Consequence |
|---|---|---|
| First language | Bengali (bn-BD) | Slices in Section 3.3 run for Bengali only; ar, fr, de, es and zh-Hans stay not started |
| Word for "case" | ফাইল, written ভিসা ফাইল | Every case is ভিসা ফাইল in the drafts, uploaded evidence is ডকুমেন্ট or আপলোড করা ডকুমেন্ট, and a bare ফাইল is never used for either, so the two objects cannot be confused (follow-up of 2026-11-12). Drafts holding both objects are listed in `data/CASE_FILE_COLLISION_REVIEW.csv`. Case manager is ভিসা ফাইল ম্যানেজার |
| Digits in prose | Bengali | Static prose digits in drafts converted (57 drafts with Bengali digits; identifiers, codes, emails and URLs untouched, audited in `data/NUMBER_DATE_AUDIT.csv`). Runtime numbers need the locale formatter: with `bn-BD` the platform's own `Intl` already gives Bengali digits and lakh grouping, so the helper in Section 3.4 must pass the locale and must not force Latin digits. Typed identifiers (passport and document numbers, codes, emails) stay as typed, so inputs and read-back values need an explicit Latin-digit rule |
| Amounts | ISO currency code beside the amount | No symbol, no conversion; the formatter in Section 3.4 must pass `currencyDisplay: "code"` |
| Editor and legal reviewer | The owner, for both | Recorded as the owner's own decision. The brief notes an owner as editor does not by itself replace a qualified legal reviewer; the review queues (`data/review-queues/`: ordinary UI, commercial, privacy and legal, official visa requirements) are assigned to the owner and nothing is reviewed yet |

Accepted as drafted on 2026-11-12: the landing-page "file" stays ভিসা ফাইল; ডকুমেন্টস for the Documents label; the blame-free generic error wording.

Still open:

2. Whether the language choice should later be saved on the account (needs a migration) or stay a cookie.
3. Whether platform staff screens are translated at all.
4. The Bengali unit for file sizes ("MB" is left in Latin letters in drafts).
