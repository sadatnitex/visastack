# Drafting brief: bn-BD proposals for the VisaStack interface

> SUPERSEDED IN PART by `OWNER_DECISIONS.json` (2026-11-12): the case word is ফাইল (this brief says কেস) and prose digits are Bengali (this brief says Latin). The register applies both automatically; the drafts in this folder were written under the older rules and are not rewritten.

You draft proposed Bangladesh Bengali (bn-BD) wording for English interface strings. English is canonical. Your drafts are proposals for a human editor; they are never released automatically.

## Files

- Input: one `input-<X>.jsonl` file in this folder. One JSON object per line.
- Glossary: `../BN_BD_CORE_GLOSSARY.csv` (read it completely first, it is short). Use its Bengali for those English terms. Respect `bn_must_contain_any_of` and `bn_must_not_contain_any_of`.
- Output: append to `bn-BD.part-<X>.jsonl` in this folder, one JSON object per line, in the same order as the input, one output line per input line, nothing skipped.

Input fields: `sg` id, `en` English (may contain `{placeholders}` and `<tag>...</tag>` markers), `dom` domain, `k` kind of text (attr_accessible = screen reader name; label_map_value = status badge or label; composed = a sentence built from parts), `g` guardrail tags, `j` journeys it appears in, `icu` number/plural flags, `rc` review class (LEGAL_POLICY_TEXT or OFFICIAL_RULE_CONTENT or PAYMENT_BILLING), `out` output kind (email, pdf, download).

Output fields: `{"sg": "...", "bn": "...", "conf": "HIGH|MEDIUM|LOW", "note": "..."}`. Keep `note` empty unless there is a real issue. If you cannot translate safely, set `bn` to an empty string and `note` to a short reason that starts with `NEEDS_OWNER_DECISION`.

## Hard rules

1. Meaning exactly as the English. Never make a promise, security claim, compliance claim, government-filing claim, official-source claim or visa-approval claim stronger than the English. If the English is hedged, keep the hedge.
2. Keep every `{placeholder}` exactly as written (same spelling, same count). Keep every `<tag>` and `</tag>` marker, in a valid pair, around the matching words. Do not translate placeholder names. Bengali word order differs from English: move placeholders where the Bengali needs them.
3. Do not translate: VisaStack, product codes, email addresses, file extensions, currency codes, country codes, URLs. Write "AI" as এআই. Keep "WhatsApp" and "PDF" in Latin letters.
4. Digits: use Latin digits 0-9 for all numbers (passport and document numbers must not change shape). Do not write Bengali digits.
5. Register: polite, plain, spoken-standard Bangladeshi Bengali. Address the reader as আপনি. Buttons use the polite imperative (করুন, দিন, পাঠান). Status labels are short adjectives or past participles. Headings are noun phrases. Hints and errors are full sentences, calm, blame free ("কিছু একটা সমস্যা হয়েছে", never "আপনি ভুল করেছেন"). Avoid Indian (West Bengal) vocabulary where a Bangladeshi alternative exists (for example জল is not used, use পানি; এজেন্সি, ডকুমেন্ট, নোটিফিকেশন, সাইন ইন are fine). Prefer widely used loanwords for software terms (ডকুমেন্ট, ফাইল, আপলোড, ডাউনলোড, অ্যাকাউন্ট, প্রোফাইল, পাসওয়ার্ড) over rare Sanskritised ones.
6. Gender: Bengali third person is gender neutral. Do not add gender. "he/she" in English becomes "তিনি" or a role word.
7. Plurals: Bengali does not inflect for number. Use "{count}টি ডকুমেন্ট" style. An English `{choice}` or `(s)` placeholder means an English-only plural suffix switch: drop it in Bengali.
8. No em dash characters anywhere. Use a hyphen or restructure the sentence.
9. Title Case in English is a display rule, not part of the meaning. Bengali has no letter case.
10. Keep the length close to the English. Buttons and badges must stay short enough for a narrow phone screen (aim for no more than 1.4 times the English length in characters).

## Distinctions you must never blur (these are product facts)

- Saved (stored in VisaStack) is not Submitted (given to a named party) is not Sent (left VisaStack) is not Received (the other side has it) is not Reviewed (a person looked) is not Accepted (an invitation or grant was taken) is not Verified (a specific fact was checked, for example an email address) is not Approved (a person approved an AI suggestion, never a visa decision) is not Confirmed is not Ready.
- File format checked (type and structure looked at, পরীক্ষা) is not antivirus scanned (স্ক্যান) is not held for safety (আটকে রাখা, the file still exists).
- Mandatory is not Mandatory if applicable (keep the condition) is not one of several alternatives (any one is enough) is not Recommended is not Optional is not Unknown (we do not know yet) is not Not applicable.
- A request from an agency is not a grant of access is not the government visa application. VisaStack does not file visa applications.
- Link opened is not access accepted. Revoking access does not take back a copy someone already downloaded.
- Current copy, earlier document, replaced copy, exact copy: use কপি. Never use সংস্করণ or ভার্সন or "Version 2" wording.
- Nationality, country of residence, destination, and the place where a person applies are four different things.
- Export data, share access, download original, safe copy, archive, delete, permanent erasure (not possible under a legal hold) are different actions.

## Domain notes

- `case` (the product word) = কেস, one person's visa preparation. Keep consistent.
- "Document" = ডকুমেন্ট (never দলিল). "Wallet" = ওয়ালেট.
- Legal and policy text (`rc` = LEGAL_POLICY_TEXT), official rule content (OFFICIAL_RULE_CONTENT) and billing text: draft anyway but set `conf` to LOW and add note `LEGAL_REVIEW_REQUIRED` or `OFFICIAL_RULE_REVIEW_REQUIRED` or `BILLING_REVIEW_REQUIRED`.

## Process

Work in batches of about 80 lines: read a slice of the input (use the Read tool with offset and limit), write the matching output lines by appending with a shell here-document (`cat >> file <<'EOF'`), then continue. Do not rewrite earlier output. At the end, verify with a short script that the output has the same number of lines as the input, the same `sg` order, and that every placeholder and tag in `en` appears in `bn` (report mismatches, then fix them). Report in six lines or fewer: lines written, count by `conf`, count of NEEDS_OWNER_DECISION, the five hardest decisions and what you chose.
