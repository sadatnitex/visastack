# Decision queue: privacy, consent and legal wording

Status: MACHINE_REVIEWED_SPECIALIST_2026-11-12. These questions came up in the legal and semantic review of the bn-BD privacy, consent and legal wording (`LEGAL_SEMANTIC_REVIEW.csv`, `LEGAL_SIGNOFF_PACKET.md`). Each one needs a decision from an accountable person: the owner, and a qualified legal reviewer where the owner wants one. The recommended answer is listed first.

Items D1 to D6 are **source issues**: the English itself says something the code does not do, or two English strings disagree. The Bengali was translated faithfully from the English and was not softened to hide the problem. Whatever is decided, the English changes first and the Bengali follows. Nothing in the product was changed by this review.

Items D7 to D9 are smaller wording or translation-policy decisions.

## D1. "Your audit trail is preserved and anonymized" (account deletion)

- English: "Deletion is reversible during a 7-day grace window, then permanent. Your audit trail is preserved and anonymized. An active legal hold blocks deletion until released." at `apps/web/src/app/app/privacy/page.tsx:192-193` (group SG-c3018512).
- What the code does: the account row is deleted (`packages/services/src/deletion.ts:548`). The audit log is append-only and hash-chained. It keeps `actor_account_id` verbatim forever, along with `ip`, `device` and `metadata` (`packages/db/src/schema.ts:548-564`), and nothing rewrites those rows. The comment at `packages/services/src/deletion.ts:17-20` says the trail is "anonymized (FK `set null`)", but the audit table has no such link. At best the result is pseudonymous: the account id no longer resolves to an account, but the IP address and device stay.
- Why it matters: "anonymized" is a legal term with a specific meaning in data-protection law. A person who reads it may believe nothing identifying is left.
- Options:
  1. **Recommended:** change the English to say what happens, for example "Your audit trail is kept, as the law and security require. It no longer links to your account, but it still holds technical details such as the IP address and device used." Then re-translate.
  2. Make the code meet the claim: remove or overwrite IP, device and identifying metadata at deletion. This conflicts with the append-only, hash-chained design and needs an engineering decision.
  3. Keep the English as it is. Not recommended: the claim is stronger than the behaviour.

## D2. "It is kept safely and removed once that ends" (removal request under a legal hold)

- English: "We could not remove document {documentCode} yet because of a legal requirement. It is kept safely and removed once that ends." at `packages/services/src/lifecycle/removal-requests/requests.ts:825` (group SG-a80baa0b). Related: "Erasure jobs that exhausted their retries are a deletion obligation not met. A job blocked by a legal hold is deliberate and only needs review when the hold lifts." at `packages/services/src/operational-signals.ts:637`.
- What the code does: when a hold stops a document removal, the erasure job is parked as `BLOCKED_BY_HOLD`. It "will never resume on its own; only an explicit action (an admin's `retryErasureJob`, or a fresh enqueue request) moves it again" (`packages/services/src/erasure.ts:104-108`, retry at `apps/web/src/app/app/admin/actions.ts:245`). The recently-deleted purge does retry held items once the hold is gone, but only for the duplicate path (`packages/services/src/lifecycle/recently-deleted/purge.ts:72-77`).
- Why it matters: the person is promised automatic removal. If staff never retry the job, the document stays and the promise is broken.
- Options:
  1. **Recommended:** make the code match the promise. When a hold is released, re-queue the parked removal jobs it covered automatically. The English stays as it is.
  2. Change the English: "It is kept for now. Once the requirement ends, our team removes it and lets you know." Then make sure staff do this.
  3. Keep both as they are. Not recommended.

## D3. Large export: "every current, safe document file"

- English: "Need the actual document files too, not just their metadata? Request a large export - a ZIP containing every current, safe document file alongside the same manifest and CSV tables above. It takes a few minutes to prepare and stays downloadable for 24 hours." at `apps/web/src/app/app/privacy/large-export-panel.tsx:82-84` (group SG-94636f21).
- What the code does:
  - The ZIP bundles "every version ... not just the latest per document" (`packages/services/src/account-export.ts:257-259`), so it holds the full history, not only current copies.
  - A file is included when its stored status is `CLEAN` (`packages/services/src/account-export.ts:238-247`). Today `CLEAN` means the file type and structure were checked, not that a virus scan ran (`apps/web/src/lib/scan-state.ts:7-11`, and "virus scanning of uploads [is] not switched on yet" at `apps/web/src/app/terms/page.tsx:16`).
  - The 24 hours matches the code (`packages/services/src/account-export.ts:73`).
- Why it matters: "current" understates what the person receives. "Safe" overstates a check the product itself says has not run. The Bengali guardrails also forbid calling a file নিরাপদ (safe).
- Options:
  1. **Recommended:** change the English to "a ZIP with every usable document file, including earlier copies, that passed the file format check (files are not scanned for viruses yet)". Then re-translate.
  2. Change the code to export current copies only, and keep "safe" off the screen until antivirus scanning is switched on.
  3. Keep as it is. Not recommended.

## D4. One name for the privacy document: "Privacy Notice" or "Privacy Policy"

- English that says Privacy Notice:
  - the page title at `apps/web/src/app/privacy/page.tsx:6` and `:21`
  - the sign-up link at `apps/web/src/app/auth/sign-up/page.tsx:107`
  - the sign-up hint at `apps/web/src/app/auth/sign-up/page.tsx:18`
  - "Read the Privacy Notice" at `apps/web/src/app/terms/page.tsx:40`
- English that says Privacy Policy:
  - "Read the Privacy Policy" at `apps/web/src/app/app/sharing-invitations/accept/page.tsx:115` and `apps/web/src/app/app/trip-invitations/accept/page.tsx:177` (groups SG-5a3c84ab, SG-38dd0a48 and SG-10df57ea)
  - "Manage Privacy Policy Controls" at `apps/web/src/app/app/admin/settings/page.tsx:95`
- Both names open the same `/privacy` page. In Bengali they become two different documents: গোপনীয়তা নোটিশ and গোপনীয়তা নীতি.
- Why it matters: at a consent step the person is told to read a document by a name that does not match the page they land on.
- Options:
  1. **Recommended:** use "Privacy Notice" everywhere a person sees it. Change the two invitation links to "Read the Privacy Notice". The Bengali becomes গোপনীয়তা নোটিশ throughout. The staff-only admin label can follow later.
  2. Rename the page and every link to "Privacy Policy" (গোপনীয়তা নীতি).
  3. Keep both names. Not recommended.

## D5. Real details: "not accepted yet" against "you may use your own details at your own risk"

- English that restricts:
  - "Please use made-up details, or documents with all personal information permanently blacked out. Real applicant details are not accepted yet." at `apps/web/src/app/page.tsx:616`, shown only while the public beta is not open (`:612`, `:244`)
  - the pilot banner at `apps/web/src/components/pilot-banner.tsx:31-35`
  - "Do not use this pilot as the only copy of important records" at `apps/web/src/app/privacy/page.tsx:58-60`
- English that permits, with no condition on the mode:
  - "You may use your own details and documents, at your own risk" at `apps/web/src/app/terms/page.tsx:15-17`
  - "During the free public beta you may add your own information and documents at your own risk" at `apps/web/src/app/privacy/page.tsx:28-30`
- Why it matters: while registration is closed (controlled pilot), a visitor sees "real details are not accepted" on the landing page and banner, but the Terms and Privacy Notice say real details are allowed at the person's own risk. These are the binding documents, and they contradict the operating rule.
- Options:
  1. **Recommended:** make the Terms and Privacy sentences follow the same mode switch as the landing page and banner (`isPublicBetaOpen`). In pilot mode they repeat the made-up-data rule; in public beta they keep the own-risk wording.
  2. Keep the Terms and Privacy sentences unconditional and drop the restriction from the landing page and banner. This changes the pilot policy itself.
  3. Leave both. Not recommended.

## D6. "Only the number is kept, never what was read" (AI Use Today)

- English: "How much you used each AI feature today. Only the number is kept, never what was read. Everything in VisaStack works without these features." at `apps/web/src/app/app/privacy/page.tsx:253-254` (group SG-a73edff1).
- What the code does: the usage counter stores counts only (`packages/services/src/ai-feature-settings.ts:856-860`). AI reading itself does keep results: extraction runs, field proposals and drafts are stored and exported (`packages/services/src/export.ts:161-166`).
- Why it matters: read in context the sentence is about the count, and that part is true. A reader may take "never what was read" as a promise about AI reading in general, which is not true.
- Options:
  1. **Recommended:** scope the English: "For this count, only the number is kept, never what was read." Re-translate with the same scope.
  2. Keep the English. The card title (AI Use Today) supplies the scope.

## D7. Case retention notice: "will be permanently deleted in 30 days" is unconditional

- English: "This case has been closed for {months} months. Its case records will be permanently deleted in 30 days. Export anything you still need before then." at `packages/services/src/case-retention.ts:110` (group SG-aec9d67c). The Bengali defect, "within 30 days", is already corrected.
- What the code does: the purge runs 30 days after the notice (`packages/services/src/case-retention.ts:175`). It skips a case under a legal hold or with an unresolved complaint, and purges it once those clear (`:164-172`).
- Why it matters: the notice states a deletion date that may not hold. This is low harm, because the person is told to export early either way.
- Options:
  1. **Recommended:** keep the English. The date is right in the normal case and the export advice protects the person either way. Record the exception in the operations docs.
  2. Add "unless a legal hold or an open complaint requires us to keep them for longer".

## D8. The word নিরাপদ (safe) where the English says safe

- The guardrails (`VISASTACK_SEMANTIC_GUARDRAILS.md` section 2) allow নিরাপদ only inside the product noun Safe copy. Three English strings use safe or safely in another sense:
  - "It is kept safely", `packages/services/src/lifecycle/removal-requests/requests.ts:825`
  - "every current, safe document file", `apps/web/src/app/app/privacy/large-export-panel.tsx:83`, see D3
  - "Your data is safe and nothing was changed", `apps/web/src/app/app/privacy/large-export-panel.tsx:58` (SG-467f32a9)
- The Bengali uses নিরাপদ in all three, to match the English. A weaker word would change the meaning.
- Options:
  1. **Recommended:** keep নিরাপদ wherever the English says safe about data being kept or left untouched. Never use it for a file check. Settle D3 in the English.
  2. Replace it with সুরক্ষিতভাবে রাখা আছে (kept protected) in the first and third strings. This is close, but it is a different claim from the English.

## D9. A message key listed as English text

- `consent.issuerContact.title` (SG-a290edf4) is a message key mapped at `apps/web/src/app/app/(home)/page.tsx:111`, not English a person reads. Its English, "Issuer Contact Consent", is drafted separately (SG-5d200bba).
- Options:
  1. **Recommended:** leave it untranslated, and mark it in the census as a key, not text.
  2. Give it the same Bengali as SG-5d200bba.
