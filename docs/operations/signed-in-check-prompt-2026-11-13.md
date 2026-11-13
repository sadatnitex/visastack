# Signed-in check on production: prompt for Claude in Chrome

Paste everything below the line into Claude in Chrome while you are signed in to VisaStack. Run Part 1 once (English) and Part 2 once (Bengali). Then paste its final report back into the VisaStack session.

You need three accounts with made-up names and made-up documents only:
- **Traveller:** a traveller record, shared with Agency A (Agency A has accepted the access).
- **Agency A admin:** an owner or admin of the agency the traveller shared with.
- **Agency B admin:** an owner or admin of a different agency that the traveller has NOT shared with.

---

You are checking a visa-document web app called VisaStack at https://vs.obsidianglobal.studio (if that address does not load, use https://visastack-five.vercel.app). I am the owner. This is a controlled pilot: every name and document is made up. Your job is to walk through the steps below, look carefully at each screen, and report exactly what you see. You are testing; you are not fixing anything.

Rules for you:
1. Never type or ask for a password. When a step needs a different account, stop and say "Please sign in as <account>, then tell me to continue". I will do it.
2. Use made-up data only. For uploads, I will give you three small test files marked SPECIMEN when you ask: a birth certificate, a marriage certificate and a bank statement, plus one "clearer" copy of one of them and one "newer" copy of another.
3. Do not delete accounts, change plans, pay for anything, change agency settings, or invite real people. If a step would need that, skip it and say so.
4. Do only what a step says. If a button or page named in a step does not exist, do not hunt for a workaround: write "NOT FOUND" for that step with what you saw instead.
5. At every step take a screenshot and record: the page address, the exact words of any message, and PASS, FAIL or NOT FOUND against the "Expect" line. Quote on-screen words exactly, including Bengali.
6. If anything looks broken (overlapping text, text cut off, a raw code such as `&middot;` or `{count}`, an error page, English and Bengali mixed inside one sentence, a spinner that never ends), note it even if the step did not ask.

## Part 1: the "Answer from Your Records" journey (English)

Make sure the language is English (the language switch says English).

**Step 1. Signed in as Agency B admin (the agency WITHOUT access).**
Ask me for the address of the traveller's record as Agency A sees it (I will paste it), then open it while signed in as Agency B. Also open the same address with the last few characters of the id changed to made-up ones.
Expect: both show the same "not found" style answer, with no traveller name, no hint that one exists and the other does not.

**Step 2. Signed in as the Traveller.**
Open the traveller's record, go to Documents, and add the three SPECIMEN files (birth certificate, marriage certificate, bank statement). Wait until each shows as checked and ready.
Expect: each upload ends with a clear saved state; no error.

**Step 3. Signed in as Agency A admin.**
Open the traveller's case or record in the agency workspace and request those three documents from the traveller (one request per document).
Expect: three requests appear as waiting on the traveller.

**Step 4. Signed in as the Traveller.**
Open Requests (requests from agencies). There should be a card saying the agency is waiting for answers, with a button "Answer from Your Records". Open it.
Expect: the page names Agency A as the one asking; the three requests are listed under "Ready to Send" with one saved copy each; each copy shows its name, "Version" number and when it was added; one button says "Send 3 Answers to <agency name>".
Press the send button.
Expect: a receipt titled "Answers Sent" that names each exact copy with its version number, a fingerprint and the time, and a status "Received, Not Yet Reviewed" for each. It must NOT say "Accepted".

**Step 5. Signed in as Agency A admin.**
Open the same three requests.
Expect: each shows the same copy (same name and version number) the receipt named. Accept one. Send one back with the reason "Page 2 is cut off." Leave the third.

**Step 6. Signed in as the Traveller.**
Open Requests, then the request that was sent back.
Expect: it names the exact copy that was sent back (name and version) and the reason is visible; no copy is chosen for me in advance; there is a clear way to add a clearer copy.
Add the "clearer" SPECIMEN copy and answer the request with it.
Expect: the earlier round is still visible in the history; the new answer shows as waiting for review.

**Step 7. Still the Traveller.**
Add the "newer" SPECIMEN copy of the document that was ACCEPTED in step 5 (as a new version or a new document). Then open the earlier receipt or the accepted request again.
Expect: the earlier receipt still names the OLD copy and version; it has not silently switched to the newer one.

**Step 8. Still the Traveller, phone size.**
Resize the window to about 390 pixels wide (or use the device toolbar). Open the Answer from Your Records page and the sent-back request page again.
Expect: nothing is cut off, nothing overlaps, there is no sideways scrolling, and every button is reachable.

**Step 9. Still the Traveller (normal window size).**
Go to Sharing and end Agency A's access.
Expect: a clear confirmation that access has ended.

**Step 10. Signed in as Agency A admin.**
Open the traveller's pages and the three requests again.
Expect: the agency can no longer open the traveller's record or documents. Note exactly what it sees instead.

## Part 2: the same screens in Bengali

Signed in as the Traveller. Switch the language to বাংলা with the language switch.

For each page below, take a screenshot at normal width and at about 390 pixels wide, and list (a) every piece of text that is still in English, (b) anything cut off, overlapping or oddly large, (c) any place where a number, date or name looks wrong.
1. The public landing page (sign out first for this one, then sign back in when I confirm).
2. Home after sign-in.
3. The traveller's record: Profile, Documents, Requests, Sharing, Privacy.
4. Requests, then "আপনার রেকর্ড থেকে উত্তর দিন" (Answer from Your Records) if a request is waiting; if none is waiting, say so.
5. A document's manage menu: open the delete dialog and the "ask us to remove" dialog, read the text, then CANCEL (do not delete).
6. Trips, and one case if there is one.
7. Account and Plan (look only; do not change the plan).

Expected to stay English on purpose, so do not report these as problems: the name VisaStack, people's and agencies' names, file names, official visa rules, fees and processing times, invoices and receipts, staff and admin screens, emails, the sign-in-with-another-app screen, and a "not found" message for a record that is not yours.

Then switch the language back to English and confirm the pages are English again.

## Your final report

Give me:
1. A table for Part 1: Step | PASS, FAIL or NOT FOUND | What you saw (exact words) | Page address.
2. For Part 2: per page, the list of English leftovers, layout problems and wrong-looking values, with the exact words.
3. Anything else that looked broken.
4. The screenshots, named by step (for example `part1-step4-receipt.png`).
Do not summarize away details: exact on-screen words matter more than a short report.
