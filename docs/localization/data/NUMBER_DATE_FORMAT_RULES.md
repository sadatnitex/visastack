# Bengali number and date rules (documentation only)

Scope: rules for a later implementation. Nothing in the product was changed, no runtime formatting was implemented, and the language switch stays off. Examples are real `Intl` output from the machine that generated this file (Node ICU), so they show what the platform produces, not what anyone assumed.

## 1. The principle

1. **Human-readable numbers and dates** (counts, amounts, dates, times, percentages written for a person) follow the `bn-BD` locale: Bengali digits, lakh grouping, Bengali month names. The owner decided Bengali digits in prose on 2026-11-12.
2. **Anything a person types, copies, reads back or matches against another system stays exactly as it is**: passport numbers, national ID numbers, document numbers, application and reference codes (for example `C-8807JK`, `D-3M46M5`, `R-0PPRBH`), case and request codes, email addresses, URLs, file names, phone numbers as entered, one-time codes, and any other technical value the user entered. Never convert digits or letters in these, never add grouping, never translate.
3. **Machine-readable fields stay ISO**: dates in exports, calendar files, email headers, URLs and API fields keep ISO 8601 and Latin digits. Only the text shown to a person is localised.
4. **Names and addresses**: Bengali and Latin letters are both left-to-right, so a name in either script may sit inside a Bengali sentence. Keep a person's name in the script they entered it.

## 2. What the platform produces for bn-BD

Resolved calendar: `gregory` (Gregorian). Resolved numbering system: `beng` (Bengali digits). Plural categories (CLDR): 0: one, 1: one, 2: other, 5: other. Country names: Singapore is `সিঙ্গাপুর`, Bangladesh is `বাংলাদেশ` (from `Intl.DisplayNames`, which the product currently calls with English only).

| Kind | en-GB today | bn-BD |
|---|---|---|
| Long date | 12 November 2026 | ১২ নভেম্বর, ২০২৬ |
| Short date | 12/11/2026 | ১২/১১/২৬ |
| Weekday and date | Thursday, 12 November 2026 | বৃহস্পতিবার, ১২ নভেম্বর, ২০২৬ |
| Time | 09:05 | ৯:০৫ AM |
| Month and day | 12 Nov | ১২ নভে |
| Count | 1,234,567 | ১২,৩৪,৫৬৭ |
| Decimal | 2,500.5 | ২,৫০০.৫ |
| Percent | 25% | ২৫% |
| Amount in BDT | BDT 25,000.00 | ২৫,০০০.০০৳ |
| Amount in USD (symbol) | US$150.00 | ১৫০.০০ US$ |
| Amount in BDT (code) | BDT 25,000.00 | ২৫,০০০.০০ BDT |
| Amount in USD (code) | USD 150.00 | ১৫০.০০ USD |
| Latin digits kept, lakh grouping | 1,234,567 | 12,34,567 |

Notes from the output: dates use Bengali digits and Bengali month names; grouping is lakh style (`12,34,567`); BDT shows the taka sign after the number; the AM/PM marker stays Latin in this ICU build; the plural rule treats 0 and 1 as the same category.

## 3. Category rules

| Category | Examples in the product | Rule |
|---|---|---|
| Reference and case codes | The case to add it to, for example C-7K2Q9M (see list_cases).; The case reference from list_cases, for example C-7K2Q9M.; The document reference from list_documents, for example D-7K2Q9M. | Keep exactly. Not a number to format |
| Passport, ID, document numbers, phone numbers entered by the user | entered at run time | Keep exactly, including Latin digits |
| Email addresses and URLs | `jane@example.com`, `https://` | Keep exactly |
| Counts shown to a person | `{count}`, `{length}` | bn-BD number format (Bengali digits, lakh grouping) |
| Dates and times shown to a person | expiry dates, reminders, history | bn-BD date format. Gregorian calendar only. Do not use the Bengali (Bongabdo) calendar unless the owner decides |
| Fees and amounts | visa fee and plan amounts | **Decided (owner, 2026-11-12): keep the ISO currency code beside the amount**, for example `১৫০.০০ USD` as `Intl` writes it with the code, or `USD ১৫০.০০` if the editor prefers the code first. No currency symbol (`৳`, `$`) is used and no currency is ever converted. Digits follow the prose rule; the code stays in Latin letters |
| File sizes | `4 MB`, `{uploadLimitLabel}` | Digits follow the prose rule; the unit stays `MB` unless the editor chooses a Bengali unit |
| Durations in prose | `7 days`, `24 hours` | Bengali digits; no plural suffix is needed |
| Typed confirmation keywords | `DELETE` | Keep exactly; the person must type it |
| ISO dates in exports and calendar files | `2026-11-12` | Keep ISO and Latin digits |

## 4. What the register drafts do today

Static digits in drafted Bengali prose were converted to Bengali digits by the register builder, skipping placeholders, tags, URLs, email addresses and code-like tokens. Audit of 3393 drafted groups: 65 contain Bengali digits; 12 protected tokens (emails, URLs, code-like tokens) in the English were checked for survival in the Bengali; 1 typed example(s) deliberately keep Latin digits (the form the field accepts); 0 exception(s) are listed in `data/NUMBER_DATE_AUDIT.csv` (issue types: protected token changed or missing, Latin digits left in prose, number changed or missing).

## 5. What a later implementation must do (not done here)

1. Pass the resolved locale (`bn-BD`) to every `Intl` and `toLocale*` call. 30 calls in the web app fix English today (see the coverage report).
2. Format only values meant for people. Render identifiers, codes and typed values through a path that never formats.
3. Keep input fields (dates, numbers, phone) in the control's own format; validate on the Latin form the server expects.
4. Decide AM/PM versus 24-hour time with the editor. The currency display is decided: the ISO code stays beside every amount (use `currencyDisplay: "code"`).
