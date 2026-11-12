# Platform language evidence - sources attempted (capture date 2026-11-12)

Companion to PLATFORM_LANGUAGE_EVIDENCE.raw.csv. One line per source: what was tried, the result, what was learned. Network was through the session proxy; TLS verification was never disabled.

## Firefox / Mozilla (OFFICIAL_STRING_RESOURCE rows)
- https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/bn/browser/browser/preferences/preferences.ftl - HTTP 200 (37468 bytes). Folder bn holds the Bengali strings.
- https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/bn-BD/browser/browser/preferences/preferences.ftl - HTTP 200 (30427 bytes). A bn-BD folder exists; it has fewer files (52 of the 88 paths tried versus 58 for bn) and some values carry leftover access-key letters, which were skipped.
- https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/en-US/... - HTTP 404. en-US is not stored in this repository.
- https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n-source/main/browser/browser/preferences/preferences.ftl - HTTP 200. This is the English source used for the external_english column (same relative paths as the locale folders).
- Also reachable but not used: mozilla-firefox/firefox main and mozilla/gecko-dev master en-US copies (HTTP 200).
- https://api.github.com/repos/mozilla-l10n/firefox-l10n/contents/... and the same for firefox-l10n-source - refused by the session ("GitHub access to this repository is not enabled"), so no directory listing; file paths were found by trial.
- About 88 candidate .ftl paths were tried in each of bn, bn-BD and the English source. Files that returned 200 and were parsed include: browser/aboutLogins, browser/downloads, browser/accounts, browser/sync, browser/appmenu, browser/browser, browser/menubar, browser/places, browser/pageInfo, browser/sanitize, browser/tabbrowser, browser/safebrowsing/blockedSite, browser/preferences/preferences, browser/newtab/newtab, browser/featureCallout, browser/firefoxView, browser/aboutRestartRequired, browser/siteProtections, browser/webrtcIndicator, toolkit/neterror/certError, toolkit/neterror/netError, toolkit/passwordmgr/passwordmgr, toolkit/preferences/preferences, toolkit/global (wizard, textActions, notification, commonDialog), toolkit/about (aboutAddons, aboutSupport, config, aboutProfiles, aboutTelemetry), toolkit/updates/elevation, toolkit/printing/printPreview. Paths that returned 404 were dropped silently.
- Selection rules: single-line values only, English and Bengali each at most 120 characters, no plural or selector messages, placeholders such as {$email} kept exactly, values with leftover access-key letters (for example a trailing "E" or "(N)") skipped. Strings were copied by script from the fetched files, not retyped.
- Finding: the same intent is often worded differently inside Firefox itself (for example Delete is rendered as মুছে ফেলুন, মুছে দিন and অপসারণ; Cancel as বাতিল and বাতিল করুন; Learn more as আরও জানুন, আরো জানুন, অধিক জানুন, বিস্তারিত). Use the repeat rows to judge variation.
- https://mozilla-l10n.github.io/styleguides/bn-BD/ and https://wiki.mozilla.org/L10n:Teams:bn-BD/StyleGuide - curl tunnel 403 (blocked). Not read. Search results only showed their titles.

## Google (DIRECT_SCREEN rows)
- https://accounts.google.com/signin?hl=bn - HTTP 200 (971 KB). Bengali sign-in page read directly. Page title is the "Sign in - Google Accounts" equivalent, which uses প্রবেশ করুন in the tab title but সাইন-ইন করুন in the heading (a visible inconsistency inside one product).
- https://accounts.google.com/signin?hl=en - HTTP 200. English counterpart used for external_english.
- https://accounts.google.com/signup?hl=bn and ?hl=en - HTTP 200. Served an error screen ("Something went wrong" / "Sorry, something went wrong there. Try again.") plus footer links, loading label and language picker; these are real strings read from the page.
- https://accounts.google.com/signin/v2/usernamerecovery?hl=bn and ?hl=en - HTTP 200. Email recovery page labels.
- https://accounts.google.com/ServiceLogin?hl=bn and /signin/v2/identifier?hl=en - HTTP 200, same family, no extra rows.
- WebFetch on accounts.google.com/signin?hl=bn also worked and agreed with the curl reading for sign-in, next, create account, forgot email.
- https://drive.google.com/?hl=bn - WebFetch ENOTFOUND (host not in the session's allowed domains); curl tunnel 403.
- https://www.google.com/drive/?hl=bn, https://workspace.google.com/intl/bn/products/drive/, https://myaccount.google.com/?hl=bn - curl tunnel 403.
- https://support.google.com/ - not re-tested, per brief.

## Microsoft
- https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides - HTTP 200. Lists a Bangla (India) style guide only (https://aka.ms/bangla-india-styleguide); no Bangla (Bangladesh) entry.
- https://aka.ms/bangla-india-styleguide - curl tunnel 403 (blocked). Guide not read.
- https://microsoft.com/cms/api/am/binary/RE56vgf (guide link from a search result) - HTTP 404.
- https://www.microsoft.com/en-us/language/Search?... (Terminology search) - HTTP 404 via curl and via WebFetch.
- https://learn.microsoft.com/bn-bd/ and /bn-bd/globalization/ - HTTP 200 but English only; no Bengali interface text found. WebFetch confirmed no Bengali script on the page.
- https://www.microsoft.com/bn-bd/ - HTTP 404. https://support.microsoft.com/bn-bd - curl tunnel 403.
- WebSearch "Microsoft Bengali (Bangladesh) style guide download" - returned only titles and links (a 2016-era blog post about 53 style guides, Mozilla and Joomla guides). No Microsoft Bengali wording obtained, so no Microsoft product rows exist beyond UNVERIFIED placeholders.

## Facebook / Meta
- https://bn-in.facebook.com/login/ and https://www.facebook.com/login/?locale=bn_IN - WebFetch ENOTFOUND; curl to facebook.com tunnel 403.
- WebSearch (Bengali login terms) - returned an archived 2012 policy page and unrelated help pages; the summary repeated words from my own query, so it was not used as evidence. UNVERIFIED.

## bKash
- https://www.bkash.com/bn - WebFetch ENOTFOUND; curl tunnel 403.
- WebSearch - news articles and English product pages; no Bengali menu labels shown. UNVERIFIED.

## myGov Bangladesh
- https://www.mygov.bd/ - WebFetch ENOTFOUND; curl tunnel 403.
- WebSearch - a summary of a government training PDF (admin.training.mygov.bd) mentioned a button called "নাগরিক লগইন". Snippet only, PDF not fetched: recorded as CONTEXTUAL_ANALOGY, not product-attested.

## Bangladesh e-Passport
- https://www.epassport.gov.bd/ - WebFetch ENOTFOUND; curl tunnel 403. WebSearch returned English guides only ("Apply Online"). UNVERIFIED.

## Pathao
- https://www.pathao.com/bn/ and https://www.pathao.com/ - WebFetch ENOTFOUND; curl tunnel 403. WebSearch returned English App Store listings only. UNVERIFIED.

## Summary
- Product-attested (first three evidence types): Firefox string resources (bn and bn-BD folders) and Google sign-in pages (hl=bn). Everything else is UNVERIFIED or CONTEXTUAL_ANALOGY.
- Blocked hosts: facebook.com, bkash.com, mygov.bd, epassport.gov.bd, pathao.com, drive.google.com, www.google.com, workspace.google.com, myaccount.google.com, support.google.com, support.microsoft.com, aka.ms, mozilla-l10n.github.io, wiki.mozilla.org, github.com HTML and the GitHub contents API. To reach them the session's allowed network domains would need to include them.
- Intents with no Firefox or Google match (no honest row written): Sign up (Firefox), Forgot password, Reset password, Upload, Invite, Decline (only a prompt-button match), Consent, Scan a file, Version, Pending (only Paused/Starting), Optional, Review, Filter, Copy link (only Copy Download Link), Delete all data (only Remove All Passwords), Date of birth, Phone number, Country, Family member, Guardian, Team member, Role, Checklist, Appointment, Payment, Receipt, Plan/Subscription.


## Second pass, 2026-11-12 (orchestrating session)

Re-test with `curl -L` and a browser user agent:

| URL | Result |
|---|---|
| facebook.com/login, bn-in.facebook.com | no connection (000) |
| bkash.com/bn | no connection (000) |
| pathao.com/bn | no connection (000) |
| mygov.bd | no connection (000) |
| epassport.gov.bd | no connection (000) |
| support.google.com/accounts/answer/32050?hl=bn | no connection (000) |
| accounts.google.com/signin?hl=bn | 200, about 946 KB. All 17 Google rows reproduced when redirects are followed (an earlier re-check without `-L` got only a redirect and wrongly downgraded them) |
| microsoft.com Terminology search | 403 |
| learn.microsoft.com style-guide index | 200, English only |
| raw.githubusercontent.com Firefox string files | 200; all 248 Firefox rows reproduced |

Re-verification is scripted in `tools/evidence-verify.py`.
