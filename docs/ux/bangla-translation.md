# English and Bangla: how it works and what is still open

Commercial V1 directive Part 9 section 4 asks for English and Bangla for nine
critical flows, with the Bangla reviewed for meaning, security, privacy and
consent wording, and with professional legal review marked explicitly before
public launch. This page is the working record: what is translated, how the
translation is built so a gap cannot slip in, the choices that were made, the
wording each reviewer must check, and where a review is recorded.

## What is translated

| Flow | Status | Where |
|---|---|---|
| Site frame (header, footer, skip link, language switch, pilot banner, error and not-found screens, loading label) | Done | `shell`, `errors` catalogs |
| Signed-in navigation and the applicant's section tabs | Done | `shell` |
| Account and consent (Overview, consent list and gate, applicants, add an applicant, account page) | Done | `account`, `consent` |
| Alerts (the page and the text of each alert sent to a traveller) | Done in the app, English-only in email | `alerts` |
| Privacy actions (export, large export, account deletion, legal-hold notices, consent history) | Done | `privacy` |
| Upload | Not yet. Status words exist; the uploader and the documents page do not use them | `upload` |
| Requests (answering an agency's evidence request) | Not yet | planned `requests` |
| Readiness warnings | Not yet. The four readiness sentences exist | `readiness` |
| Sharing | Not yet. Status words exist | `sharing` |
| Invitations (client, team, contributor) | Not yet | planned `invitations` |
| Acknowledgement | Not yet | planned `acknowledgement` |

Agency and platform consoles stay English-only. The nine flows are what a
traveller meets; an agency's staff and the platform's staff work in English
today. The public pages (landing, public trust, status, "pilot access denied")
are also still English apart from the header and footer, and the sign-in screen
itself is the identity provider's (WorkOS AuthKit), which this product does not
control. The browser-tab title is in the reader's language; the site description
shown by search engines is marketing copy that is waiting for the owner's content
review and stays English.

## How it is built

- **One catalog per flow** in `packages/i18n/src/catalogs/`. `defineCatalog` takes
  the English object and a Bangla object whose type is "exactly the same keys".
  A missing or extra Bangla key is a compile error, not an English sentence on a
  Bangla screen. There is no "partial Bangla".
- **Tests over every message** (`packages/i18n/src/i18n.test.ts`): same `{tokens}`
  and same `<b>`/`<link>` tags in both languages, Bengali script and no leftover
  English words (the brand and file-format names are the only Latin words allowed),
  canonical (NFC) Unicode, no empty text, no stray zero-width characters, no
  em-dash, no internal product names ("mission", "provider schema", "job lease"),
  plural pairs complete.
- **Server pages** call `getI18n()` and write text with `t(key, values)`, plurals
  with `tn(base, count)`, dates with `date()` and `dateTime()`.
- **Browser components** never carry a catalog. The server page picks the few
  messages the component needs (`pickMessages`) and passes them as a prop, so a
  traveller on a slow connection downloads only the words on the screen they open.
  Dates are written on the server too, so the browser never formats one and a
  server and a browser can never disagree. The only text a browser carries on its
  own is the error screen's, in a catalog of its own.
- **Action messages** ("Consent granted.", "Deletion scheduled for ...") are
  written in the reader's language by the server action. A failed service call is
  shown through `errorText`: English readers see the service's own wording exactly
  as before; Bangla readers see a message for the kind of failure, or a specific
  message when the service named one (`ServiceError.key`).
- **Alerts** are stored once, in English, with the message keys and values they
  were built from (`buildAlertPayload`). The alerts page looks them up again in the
  reader's language. An alert stored before this existed keeps the English it was
  written in. Email is still English only (see below).

## Choices

| Choice | What was decided | Why |
|---|---|---|
| Legal names | Stored exactly as typed. No transliteration, no normalisation, joiners (ZWJ, ZWNJ) kept. Tested through the service and the action | Directive: do not machine-transliterate legal names, preserve original Unicode |
| Digits | Bengali digits for counts, years and dates in Bangla. Identifiers, passport numbers, reference codes and anything a person typed are never converted | Bangla screens read naturally; data stays verbatim |
| Dates | Day first in both languages ("5 Oct 2026", "৫ অক্টো, ২০২৬"). English changed from the US order | Every market served (Bangladesh, UK, France, Singapore) writes the day first |
| Times | 24-hour, with the zone named ("23:30 UTC") | No AM/PM in Latin letters in a Bangla sentence; never mistaken for local time |
| Zone | Dates are written in UTC on the server | The server does not know where the reader is; a reader's own zone is a later refinement |
| Plurals | `.one` and `.other` pairs; Bangla uses one wording for every count | Matches how each language works |
| Typography | No letter-spacing and roomier line height under `html[lang="bn"]`; Bengali families named in the font stack; no web font | Tight leading clips Bengali marks and tracking breaks conjuncts; a font download is what a low-bandwidth reader can least afford |
| Latin words kept | The brand, hosting names, file formats (JSON, CSV, ZIP) | Names, not words to translate |

## Glossary

| English | Bangla | Note |
|---|---|---|
| Applicant | আবেদনকারী | |
| Case | কেস | Not "মামলা", which means a lawsuit |
| Document | নথি | |
| Evidence | প্রমাণ | |
| Consent | সম্মতি | |
| Grant / Revoke (consent) | প্রদান করুন / প্রত্যাহার করুন | |
| Sharing | শেয়ারিং | |
| Alerts | বিজ্ঞপ্তি | The usual word for notifications |
| Privacy | গোপনীয়তা | |
| Overview | সারসংক্ষেপ | |
| Reviewer | পর্যালোচক | |
| Legal hold | আইনি সংরক্ষণ আদেশ (লিগ্যাল হোল্ড) | Needs the professional's confirmation |
| Audit trail | অডিট ট্রেইল | |
| Master Profile | মাস্টার প্রোফাইল | Product term |
| Sign in / Sign out | সাইন ইন / সাইন আউট | |

## Professional review: what is marked and where it is recorded

The Bangla was drafted in-house. It has not been reviewed by a qualified
Bangla-speaking legal or privacy professional. Each catalog says which kinds of
review its wording needs:

| Catalog | Needs review of |
|---|---|
| `consent` | Consent, privacy, legal wording (what a person agrees to, and the statement made when adding a record for someone else) |
| `privacy` | Privacy, legal, consent wording (data rights, deletion, what a legal hold means) |
| `sharing` | Consent, privacy wording (who can see a person's information) |
| `readiness` | Legal wording (a readiness result must never read as a promise about the outcome) |
| `upload` | Security wording (what "scanned", "quarantined" and "structural validation" say happened) |
| `alerts` | Privacy wording (retention and deletion notices) |
| `shell`, `errors`, `account` | Ordinary copy: a native-speaker proofread is advised, nothing legal turns on it |

Three things make the state explicit rather than a promise in a document:

1. **On screen.** A Bangla screen that carries such wording shows a one-line
   notice saying the legal review is not finished and the English version is there
   to check against. It appears only in Bangla and only while the review is not
   recorded.
2. **In the launch gate.** `banglaTranslationReview` in the commercial readiness
   guard stays closed while any catalog that needs a review has none recorded. It
   is computed from the record, not from an environment flag.
3. **In the record.** `packages/i18n/src/review.ts` holds `BANGLA_REVIEW_RECORDS`,
   empty today. To record a review, add the catalog's id with the reviewer's name
   and role, the date, and the areas covered; a record that misses an area leaves
   the catalog pending. That is a normal commit, so who signed off and when is in
   the history. A test pins the empty state, so recording the first review changes
   that test in the same commit.

Until the records exist, commercial mode cannot report ready. That is the intended
state of this chunk.

## Adding or changing a message

1. Add the key to the right catalog's English object and the Bangla object (the
   compiler refuses one without the other). Keep English wording stable unless the
   change is the point.
2. Use `{token}` for values, `<b>..</b>` and `<link>..</link>` for emphasis and
   links, `.one` and `.other` for counted nouns.
3. If it is consent, privacy, legal or security wording, put it in a catalog that
   is marked for that review, and expect the review record to need an update.
4. Run `pnpm --filter @visastack/i18n test`. It rejects mixed script, a missing
   token, a stray invisible character and the rest above.

## What is not done

- Bangla for upload, requests, readiness warnings, sharing, invitations and
  acknowledgement (the next two chunks).
- Email. An invitation or alert email goes to someone who has not chosen a
  language yet, so the plan is a single email with the English text followed by the
  Bangla, built from the same keys. Today email is English only.
- A professional review of any Bangla text.
- A manual read-through by a native speaker, and a screen-reader pass in Bangla.
- Real phones and Safari. Layout was checked in Chromium with Noto Sans Bengali
  installed on the test machine, which is the font most Android phones use; other
  devices ship their own Bangla font and may differ.
- The signed-in pages themselves were never opened in a browser (no sign-in is
  possible in the build environment). Render tests call each page with simulated
  data in both languages, and the browser checks use the real stylesheet with the
  signed-in building blocks set in Bangla.
