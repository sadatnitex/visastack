# PUB4 records text (draft for the Guardian)

## Known issues (append to docs/commercial-v1/known-issues.md)

## 18 Nov 2026: WP-PUB4 Countries and For Agencies pages

- Two new public pages, built on the PUB1 parts. /countries lists every country in the sourced destination catalogue (public facts held in the code: no sign-in, no database, nothing private): 12 rows first, then a Show More link that works without JavaScript (`?show=`, whole steps of 12, clamped, so a hand-edited address never errors and the last click reaches the end). Each row has a flag, the name, the entry kind and the page the fact came from, "Checked On" with the latest check date, and a Start button that goes through sign-up (or sign-in while sign-up is closed) with the country kept; a signed-in person goes straight into the app with it. A country with no stated facts shows "Not Researched Yet" and no date. The count line reads "Showing 12 of N countries." The page says the facts are for Bangladeshi passports. Chapters alternate dark, light, dark; a ring of 12 flags opens the page; a three-step scene gives the matching card the strong edge (Source, Checked On, Not Researched Yet) while scroll motion runs, and text never dims; without motion all three read alike. "Checked On" is the latest check date for anything held on that country (its entry fact, routes and requirements), as the owner's brief says; the signed-in list shows the date of the one named source, so the two pages can differ.
- /for-agencies: invite-only wording and today's button labels and sign-in flow, unchanged (Sign In to Get Started, or Create Your Free Account while public beta is open, Open Your Workspace when signed in, See What Works Today). It states only what the home page already states for agencies (ask for a document, see what is missing, keep a clear record), shows one Example case line with the readiness ring (1 of 3, Documents Complete, "Completeness only. Not an approval.") and the three states Received, Suggested, Confirmed each in its own word, and a sharing card (Saved is not Shared; Access Ended) tagged Example. No logos, counts, testimonials, ratings or partner names.
- Both pages: one h1, first heading in the main area and whole inside the first screen on a computer and on a phone; the pilot notice unchanged; flat, brand tokens only, no new colour; reduced motion, data saver and no JavaScript show the finished picture standing still; no new dependency, no database change, nothing loaded from another site. Each page has its own small flat stylesheet inside its route folder.
- The title of /countries is built by a function, not a fixed value, because the signed-in list at /app/countries already has the title "Countries" and the page-title check refuses two equal fixed titles. Needs the Guardian's call at TURN: keep as is, or give one of the two pages another title.
- At TURN (not done here): add '/countries' and '/for-agencies' to LIVE_ROUTES in public-nav.ts and its comment, update the two expected header links in public-site.test.tsx, and add the page-titles rows only if the check needs them.
- Picture weight: /countries asks for about 50 KB of flags on its first screen set of rows (the budget limit is 150 KB per page); Spain's flag file is 82 KB, so the ring uses the Netherlands instead, and a long Show More list loads flags only as they scroll into view.
- Reviews done: code review (high), plus an accessibility and plain-language review by a fresh-context helper; confirmed findings fixed (separate stylesheet prefixes per page, no dimmed text, plain links for the sign-in Start buttons, rows built only for what is shown, honest wording). Not fixed on purpose: the date formatter is a small copy of the one in the signed-in list (kept apart so the public page does not change that file).
- NOT verified: the scroll engine and the two scenes on real phones and in Safari; a screen reader pass on the rows (list items with an unnamed flag picture, a named Start button); the accessibility, copy and design reviews by people; the facts shown for each country (they are the catalogue's, unchanged and unaudited here); Bengali for the new words below.

## New words for the localization lane (PUB4, 18 Nov 2026)

Shown in English, until the catalogue has them:

| English | Where |
|---|---|
| Countries, With Their Sources | /countries heading |
| Visa facts for Bangladeshi passports, with sources. Always confirm on the official page. | /countries opening line |
| All Countries | /countries list heading |
| Start (with hidden "With <country>") | /countries row button |
| Source: <name>, No Source Given, Checked On <date>, Check Date Not Given, Not Researched Yet | /countries rows |
| How to Read These Facts; Source; Checked On; Not Researched Yet; and the three card lines | /countries scene |
| Stop Chasing Documents by Message; Ask for a document, then see when it arrives, all in one place. | /for-agencies opening |
| What an Agency Gets; Ask for One Document; See What Is Missing; Keep a Clear Record (and their lines) | /for-agencies cards |
| One Case, One Clear Line; Passport Scan; Date of Birth; Visa Photo (and their notes); Documents Complete | /for-agencies example |
| You See Only What Is Shared; Saved Is Not Shared; Access Can End and Example States (and their lines) | /for-agencies sharing |
| One Traveller Profile, Fewer Repeat Requests | /for-agencies closing |
