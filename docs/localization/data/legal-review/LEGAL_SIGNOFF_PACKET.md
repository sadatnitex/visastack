# Legal sign-off packet: privacy, consent and legal wording (bn-BD)

Status: MACHINE_REVIEWED_SPECIALIST_2026-11-12. A language-model specialist review, not a human or legal review. Nothing here is approved or released. The owner is recorded as legal reviewer (`data/drafts/OWNER_DECISIONS.json`); this packet is what that sign-off needs.

How to read it: each entry gives the English source and where it lives, the Bengali now in the register (after this review), the risk if the Bengali were wrong, what the code does, and, where a change was made, the earlier Bengali and why it changed. Entries are grouped by consequence, HIGH first. Open questions that need a decision are in `DECISION_QUEUE.md`; the full grid is `LEGAL_SEMANTIC_REVIEW.csv`.

Reviewed: 83 drafted groups. Fidelity: EXACT 69, MINOR_DRIFT 12, MEANING_CHANGE 2. Corrections appended: 13. Newly drafted in this pass: 185 groups (listed at the end), all LOW confidence and LEGAL_REVIEW_REQUIRED.


## HIGH consequence (21)


### SG-a80baa0b

- English: We could not remove document {documentCode} yet because of a legal requirement. It is kept safely and removed once that ends.
- Source: `packages/services/src/lifecycle/removal-requests/requests.ts:825`
- Bengali now: একটি আইনি বাধ্যবাধকতার কারণে আমরা ডকুমেন্ট {documentCode} এখনো সরাতে পারিনি। এটি নিরাপদে রাখা আছে এবং সেই বাধ্যবাধকতা শেষ হলে সরানো হবে।
- Changed in this review. Earlier Bengali: আইনি কারণে আমরা ডকুমেন্ট {documentCode} এখনো সরাতে পারিনি। এটি নিরাপদে রাখা আছে এবং সেই কারণ শেষ হলে সরানো হবে।
- Fidelity: MINOR_DRIFT. Right or duty changed: Qualification weakened: a legal requirement (a duty) was rendered as a legal reason (কারণ). Clarity: CLEAR
- What the code does: CONTRADICTS (packages/services/src/erasure.ts:104-108: a job parked BLOCKED_BY_HOLD never resumes on its own, only a staff retry (retryErasureJob, apps/web/src/app/app/admin/actions.ts:245) moves it; the English promises removal once the requirement ends)
- Reason: Bengali corrected to the duty; the English promise of automatic removal is a source issue (DECISION_QUEUE D2) and was not softened
- Needs a decision: YES: should the product remove the document automatically when the hold is released, or should the notice say staff will remove it? (DECISION_QUEUE D2)

### SG-aec9d67c

- English: This case has been closed for {months} months. Its case records will be permanently deleted in 30 days. Export anything you still need before then.
- Source: `packages/services/src/case-retention.ts:110`
- Bengali now: এই ভিসা ফাইলটি {months} মাস ধরে বন্ধ আছে। ৩০ দিন পর এই ভিসা ফাইলের রেকর্ডগুলো স্থায়ীভাবে মুছে ফেলা হবে। তার আগে আপনার যা এখনো দরকার, তা এক্সপোর্ট করে নিন।
- Changed in this review. Earlier Bengali: এই ভিসা ফাইল {months} মাস ধরে বন্ধ আছে। এর ভিসা ফাইল রেকর্ড ৩০ দিনের মধ্যে স্থায়ীভাবে মুছে ফেলা হবে। তার আগে আপনার যা লাগবে তা এক্সপোর্ট করে নিন।
- Fidelity: MEANING_CHANGE. Right or duty changed: Deadline changed: in 30 days (a date 30 days away) became within 30 days (any time up to then), which changes how long the person has to export. Clarity: CLEAR
- What the code does: MATCHES (notice at packages/services/src/case-retention.ts:110; purge 30 days after the notice, :175). Note: a hold or open complaint can still delay the purge (:164-172), see DECISION_QUEUE D7
- Reason: Corrected to ৩০ দিন পর

### SG-b812d87f

- English: VisaStack helps organize records and workflows. It does not guarantee a visa, certify a document's authenticity or replace advice from an appropriate professional. A readiness status describes the recorded workflow, not the likelihood of approval.
- Source: `apps/web/src/app/terms/page.tsx:35`
- Bengali now: VisaStack রেকর্ড ও কাজের ধাপ গুছিয়ে রাখতে সাহায্য করে। এটি ভিসার নিশ্চয়তা দেয় না, কোনো ডকুমেন্ট যে আসল তা প্রত্যয়ন করে না, এবং যথাযথ পেশাদারের পরামর্শের বিকল্পও নয়। প্রস্তুতির অবস্থা রেকর্ড করা কাজের ধাপের অবস্থা বোঝায়, ভিসা মঞ্জুর হওয়ার সম্ভাবনা নয়।
- Changed in this review. Earlier Bengali: VisaStack রেকর্ড ও কাজের ধাপ গুছিয়ে রাখতে সাহায্য করে। এটি ভিসার নিশ্চয়তা দেয় না, কোনো ডকুমেন্ট যে আসল তা প্রত্যয়ন করে না, এবং যথাযথ পেশাদারের পরামর্শের বিকল্পও নয়। প্রস্তুতির অবস্থা রেকর্ড করা কাজের ধাপের অবস্থা বোঝায়, অনুমোদনের সম্ভাবনা নয়।
- Fidelity: MINOR_DRIFT. Right or duty changed: NO (meaning same, but the word used reads as approval of an AI suggestion). Clarity: CLEAR
- What the code does: UNVERIFIABLE (a disclaimer; readiness is computed from the recorded workflow)
- Reason: Glossary T014 and T015 reserve অনুমোদন for a person approving an AI suggestion, never a visa decision; corrected to ভিসা মঞ্জুর হওয়ার সম্ভাবনা

### SG-c3018512

- English: Deletion is reversible during a 7-day grace window, then permanent. Your audit trail is preserved and anonymized. An active legal hold blocks deletion until released.
- Source: `apps/web/src/app/app/privacy/page.tsx:192`
- Bengali now: মুছে ফেলা ৭ দিনের অপেক্ষার সময়ের মধ্যে ফিরিয়ে নেওয়া যায়, এরপর তা স্থায়ী হয়ে যায়। আপনার অডিট ট্রেইল রেখে দেওয়া হয় এবং বেনামি করা হয়। আইনি হোল্ড চালু থাকলে তা তুলে না নেওয়া পর্যন্ত মুছে ফেলা যায় না।
- Changed in this review. Earlier Bengali: মুছে ফেলার সিদ্ধান্ত ৭ দিনের অনুগ্রহ সময়ের মধ্যে ফিরিয়ে আনা যায়, এরপর তা স্থায়ী হয়ে যায়। আপনার অডিট ট্রেইল সংরক্ষিত থাকে এবং পরিচয় গোপন করা হয়। আইনি হোল্ড চালু থাকলে তা তুলে না নেওয়া পর্যন্ত মুছে ফেলা যায় না।
- Fidelity: MINOR_DRIFT. Right or duty changed: Qualification changed: anonymized was rendered as identity concealed (পরিচয় গোপন), a different and narrower claim. Clarity: UNCLEAR (অনুগ্রহ সময়, a calque of grace window, is not ordinary Bangladeshi Bengali)
- What the code does: CONTRADICTS (packages/db/src/schema.ts:548-564: audit_events keeps actor_account_id verbatim forever, plus ip, device and metadata; the account row is deleted, packages/services/src/deletion.ts:548, but nothing anonymizes the audit rows; the comment at deletion.ts:20 describes a set-null link the audit table does not have). 7-day grace MATCHES deletion.ts:26; hold block MATCHES :172, :363
- Reason: Bengali corrected to বেনামি to match the English; the English claim itself is a source issue (DECISION_QUEUE D1)
- Needs a decision: YES: may the privacy page say the audit trail is anonymized when it keeps the account id, IP address and device? (DECISION_QUEUE D1)

### SG-da11df36

- English: <input/> I agree to the <Link>terms of use</Link> and acknowledge the <Link>privacy notice</Link>.
- Source: `apps/web/src/app/auth/sign-up/page.tsx:104`
- Bengali now: <input/> আমি <Link>ব্যবহারের শর্তাবলি</Link> মেনে নিচ্ছি এবং <Link>গোপনীয়তা নোটিশ</Link> সম্পর্কে অবগত আছি বলে স্বীকার করছি।
- Changed in this review. Earlier Bengali: <input/> আমি <Link>ব্যবহারের শর্তাবলি</Link> মেনে নিচ্ছি এবং <Link>গোপনীয়তা বিজ্ঞপ্তি</Link> সম্পর্কে অবগত আছি।
- Fidelity: MINOR_DRIFT. Right or duty changed: NO (agree to terms and acknowledge the notice stay two different acts). Clarity: CLEAR
- What the code does: MATCHES (apps/web/src/app/auth/sign-up/page.tsx:104-110: one unchecked acknowledgement; it does not enable marketing, AI or sharing)
- Reason: The checkbox named the notice বিজ্ঞপ্তি while the page it links to is titled গোপনীয়তা নোটিশ; a consent record must name the same document

### SG-e7e2efa2

- English: Independent backup and restore protections are still being completed. Do not use this pilot as the only copy of important records. Keep your own originals until real-data safeguards and their acceptance checks are complete.
- Source: `apps/web/src/app/privacy/page.tsx:58`
- Bengali now: স্বতন্ত্র ব্যাকআপ ও পুনরুদ্ধারের সুরক্ষা এখনো সম্পূর্ণ করা হচ্ছে। গুরুত্বপূর্ণ রেকর্ডের একমাত্র কপি হিসেবে এই পাইলট ব্যবহার করবেন না। আসল তথ্যের সুরক্ষা ব্যবস্থা ও সেগুলোর গ্রহণযোগ্যতা পরীক্ষা সম্পূর্ণ না হওয়া পর্যন্ত নিজের মূল ডকুমেন্টগুলো নিজের কাছে রাখুন।
- Changed in this review. Earlier Bengali: স্বাধীন ব্যাকআপ ও পুনরুদ্ধারের সুরক্ষা এখনো সম্পূর্ণ করা হচ্ছে। গুরুত্বপূর্ণ রেকর্ডের একমাত্র কপি হিসেবে এই পাইলট ব্যবহার করবেন না। বাস্তব তথ্যের সুরক্ষা ও তার পরীক্ষা সম্পূর্ণ না হওয়া পর্যন্ত নিজের মূল ডকুমেন্টগুলো নিজের কাছে রাখুন।
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: UNCLEAR (স্বাধীন reads as politically free; acceptance checks were reduced to পরীক্ষা)
- What the code does: UNVERIFIABLE (operational state, not code; consistent with the open recovery items recorded in CLAUDE.md section 7)
- Reason: Corrected to স্বতন্ত্র and restored acceptance checks

### SG-0eb53d16

- English: Account registration uses your name, email address and sign-in information to create and protect your account and send confirmation or recovery messages. Security controls record registration attempts and notice versions. During the free public beta you may add your own information and documents at your own risk; some protections, such as virus scanning of uploads, are not switched on yet.
- Source: `apps/web/src/app/privacy/page.tsx:27`
- Bengali now: অ্যাকাউন্ট নিবন্ধনের সময় আপনার নাম, ইমেইল ঠিকানা ও সাইন ইনের তথ্য ব্যবহার করা হয়। এর উদ্দেশ্য আপনার অ্যাকাউন্ট তৈরি ও সুরক্ষিত রাখা এবং নিশ্চিতকরণ বা পুনরুদ্ধারের বার্তা পাঠানো। নিরাপত্তা ব্যবস্থায় নিবন্ধনের চেষ্টা ও নোটিশের সংস্করণ রেকর্ড করা হয়। বিনামূল্যের পাবলিক বিটা চলাকালে আপনি নিজের ঝুঁকিতে নিজের তথ্য ও ডকুমেন্ট যোগ করতে পারেন; আপলোড করা ডকুমেন্টের ভাইরাস স্ক্যানের মতো কিছু সুরক্ষা এখনো চালু করা হয়নি।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (virus scanning not switched on MATCHES apps/web/src/lib/scan-state.ts:7-11; recording of registration attempts and notice versions was not traced in this review)
- Reason: নোটিশের সংস্করণ is a real version (guardrail C7)

### SG-14e00305

- English: Download a complete, structured snapshot of your account: identity, consents, travellers, Master Profile facts with full history, document metadata, and your audit trail.
- Source: `apps/web/src/app/app/privacy/page.tsx:165`
- Bengali now: আপনার অ্যাকাউন্টের একটি সম্পূর্ণ ও কাঠামোবদ্ধ কপি ডাউনলোড করুন: পরিচয়, সম্মতি, ভ্রমণকারী, সম্পূর্ণ ইতিহাসসহ মাস্টার প্রোফাইলের তথ্য, ডকুমেন্টের মেটাডেটা এবং আপনার অডিট ট্রেইল।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (packages/services/src/export.ts:119-172: account, consents and consent history, travellers, facts with all versions, document metadata, audit events)
- Reason: Snapshot rendered as কপি, acceptable here

### SG-23d6bf6c

- English: Access starts after acceptance. You can stop future access, but cannot erase copies already downloaded.
- Source: `apps/web/src/components/public-trust-story.tsx:84`
- Bengali now: গ্রহণ করার পরই অ্যাক্সেস শুরু হয়। আপনি ভবিষ্যতের অ্যাক্সেস বন্ধ করতে পারেন, কিন্তু আগে ডাউনলোড করা কপি মুছে ফেলা যাবে না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (grant acceptance and transitions in packages/services/src/sharing.ts:412-520; nothing in the product can reach a copy already downloaded)
- Reason: Matches; the downloaded-copy limit is kept

### SG-3a0802f1

- English: A legal hold keeps the guest files of this request past the periods the guests chose. Reason: {reason}
- Source: `apps/web/src/app/app/agency/[orgId]/collection/collection-response-panel.tsx:300`
- Bengali now: আইনি হোল্ডের কারণে এই অনুরোধের অতিথিদের ডকুমেন্ট অতিথিদের বেছে নেওয়া সময়ের পরেও রাখা হচ্ছে। কারণ: {reason}
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (guest files purge at close plus each guest's chosen days, packages/services/src/umpe-guest-retention.ts:67-70; a hold blocks the purge and release restores the chosen period, packages/services/src/umpe-guest-agency.ts:439 and :463)
- Reason: Retention period, hold and release all carried over exactly

### SG-3b5872c4

- English: This record is under legal hold and cannot be deleted.
- Source: `packages/i18n/src/messages.ts:53`
- Bengali now: এই রেকর্ডে আইনি হোল্ড আছে এবং মুছে ফেলা যাবে না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (packages/services/src/deletion.ts:172 and :363 refuse deletion under an active hold)
- Reason: Matches

### SG-51785b82

- English: Guest files are deleted when the period each guest chose ends after this request closes. A legal hold keeps them until you release it.
- Source: `apps/web/src/app/app/agency/[orgId]/collection/collection-response-panel.tsx:300`
- Bengali now: অতিথিদের ডকুমেন্ট মুছে ফেলা হয় যখন এই অনুরোধ বন্ধ হওয়ার পর প্রত্যেক অতিথির বেছে নেওয়া সময় শেষ হয়। আইনি হোল্ড থাকলে আপনি তা ছেড়ে না দেওয়া পর্যন্ত ডকুমেন্টগুলো রাখা হয়।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (guest files purge at close plus each guest's chosen days, packages/services/src/umpe-guest-retention.ts:67-70; a hold blocks the purge and release restores the chosen period, packages/services/src/umpe-guest-agency.ts:439 and :463)
- Reason: Retention period, hold and release all carried over exactly

### SG-58c298b7

- English: VisaStack is a free public beta, provided as it is. You may use your own details and documents, at your own risk: some protections, such as virus scanning of uploads, are not switched on yet, and the status page lists what works today. Creating an account does not grant access to an agency workspace.
- Source: `apps/web/src/app/terms/page.tsx:16`
- Bengali now: VisaStack একটি বিনামূল্যের পাবলিক বিটা, যেমন আছে তেমনভাবেই দেওয়া হয়। আপনি নিজের তথ্য ও ডকুমেন্ট নিজের ঝুঁকিতে ব্যবহার করতে পারেন: আপলোড করা ডকুমেন্টের ভাইরাস স্ক্যানের মতো কিছু সুরক্ষা এখনো চালু করা হয়নি, আর আজ কী কাজ করছে তা স্ট্যাটাস পাতায় তালিকাভুক্ত আছে। অ্যাকাউন্ট তৈরি করলে কোনো এজেন্সির ওয়ার্কস্পেসে অ্যাক্সেস পাওয়া যায় না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (no virus scan, apps/web/src/lib/scan-state.ts:7-11; creating an account grants no agency access) but conflicts with the pilot wording shown while registration is closed (DECISION_QUEUE D5)
- Reason: যেমন আছে তেমনভাবেই keeps the as-is disclaimer
- Needs a decision: YES: see DECISION_QUEUE D5

### SG-7a88f715

- English: a legal hold covers this document
- Source: `packages/services/src/lifecycle/recently-deleted/delete.ts:77`
- Bengali now: এই ডকুমেন্টে একটি আইনি হোল্ড আছে
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (packages/services/src/case-deletion.ts:55 and packages/services/src/lifecycle/recently-deleted/delete.ts:77 refuse deletion under an active hold)
- Reason: Matches

### SG-94636f21

- English: Need the actual document files too, not just their metadata? Request a large export - a ZIP containing every current, safe document file alongside the same manifest and CSV tables above. It takes a few minutes to prepare and stays downloadable for 24 hours.
- Source: `apps/web/src/app/app/privacy/large-export-panel.tsx:82`
- Bengali now: শুধু মেটাডেটা নয়, আসল ডকুমেন্টও দরকার? একটি বড় এক্সপোর্টের অনুরোধ করুন - এটি একটি ZIP, যাতে উপরের একই ম্যানিফেস্ট ও CSV টেবিলের সঙ্গে প্রতিটি বর্তমান ও নিরাপদ আপলোড করা ডকুমেন্ট থাকে। প্রস্তুত হতে কয়েক মিনিট লাগে এবং ২৪ ঘণ্টা ডাউনলোডের জন্য থাকে।
- Fidelity: EXACT. Right or duty changed: NO (the Bengali follows the English; the English is the problem). Clarity: CLEAR
- What the code does: CONTRADICTS (packages/services/src/account-export.ts:238-260 bundles every usable version, the full history, not only current copies; usable means the stored CLEAN status, which today is a format check and not a virus scan, apps/web/src/lib/scan-state.ts:7-11). 24 hours MATCHES account-export.ts:73
- Reason: Translation faithful, including নিরাপদ for safe; source issue (DECISION_QUEUE D3); Bengali must follow any English change
- Needs a decision: YES: what should the large export promise: current copies only or full history, and safe or format checked? (DECISION_QUEUE D3)

### SG-9a799cf5

- English: This deletes your entire account.
- Source: `apps/web/src/app/app/privacy/deletion-panel.tsx:140`
- Bengali now: এতে আপনার পুরো অ্যাকাউন্ট মুছে যাবে।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (the whole account row and owned data go after the grace window, packages/services/src/deletion.ts:280-548)
- Reason: Matches

### SG-ac643c77

- English: This case is under a legal hold, so it cannot be deleted for now.
- Source: `packages/services/src/case-deletion.ts:55`
- Bengali now: এই ভিসা ফাইলে আইনি হোল্ড আছে, তাই আপাতত মুছে ফেলা যাবে না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (packages/services/src/case-deletion.ts:55 and packages/services/src/lifecycle/recently-deleted/delete.ts:77 refuse deletion under an active hold)
- Reason: Matches

### SG-af11879a

- English: Pausing or revoking stops all <em>future</em> access immediately. It cannot remotely erase copies the recipient already downloaded before that point.
- Source: `apps/web/src/app/app/applicant/[id]/sharing/page.tsx:544`
- Bengali now: স্থগিত বা প্রত্যাহার করলে <em>ভবিষ্যতের</em> সব অ্যাক্সেস সঙ্গে সঙ্গে বন্ধ হয়ে যায়। তার আগে প্রাপক যে কপি ডাউনলোড করে ফেলেছেন, তা দূর থেকে মুছে ফেলা যায় না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (grant acceptance and transitions in packages/services/src/sharing.ts:412-520; nothing in the product can reach a copy already downloaded)
- Reason: Matches; the downloaded-copy limit is kept

### SG-ca2ed1e2

- English: Sharing requires consent, an exact reviewed scope and recipient acceptance. AI suggestions never update your profile until you approve them.
- Source: `apps/web/src/components/document-wallet-browser.tsx:406`
- Bengali now: শেয়ার করতে সম্মতি, পর্যালোচনা করা সুনির্দিষ্ট পরিসর এবং প্রাপকের গ্রহণ দরকার। আপনি অনুমোদন না করা পর্যন্ত এআই-এর পরামর্শ কখনো আপনার প্রোফাইল হালনাগাদ করে না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (sharing consent required, packages/services/src/sharing.ts:211; grants start PENDING_ACCEPTANCE, :412; AI values wait as field proposals until approved, packages/services/src/export.ts:161-166)
- Reason: Matches

### SG-d4cc824c

- English: Vercel hosts the application. {fileStorage} stores private files. Cloudflare R2 stores encrypted backup archives when backups are configured. Neon stores application records. Neon Auth handles sign-in. Resend handles application email when configured. Authentication email uses the configured sign-in provider's mail service. These services can process information outside your country. This notice does not claim a particular data location or a completed compliance review.
- Source: `apps/web/src/app/privacy/page.tsx:34`
- Bengali now: Vercel অ্যাপ্লিকেশনটি হোস্ট করে। {fileStorage} ব্যক্তিগত ডকুমেন্ট সংরক্ষণ করে। ব্যাকআপ কনফিগার করা থাকলে Cloudflare R2 এনক্রিপ্ট করা ব্যাকআপ আর্কাইভ সংরক্ষণ করে। Neon অ্যাপ্লিকেশনের রেকর্ড সংরক্ষণ করে। Neon Auth সাইন ইন পরিচালনা করে। কনফিগার করা থাকলে Resend অ্যাপ্লিকেশনের ইমেইল পরিচালনা করে। অথেনটিকেশনের ইমেইল কনফিগার করা সাইন ইন সেবার মেইল সেবা ব্যবহার করে। এই সেবাগুলো আপনার দেশের বাইরেও তথ্য প্রক্রিয়া করতে পারে। এই নোটিশ কোনো নির্দিষ্ট ডেটা অবস্থানের কথা বলে না, এবং কমপ্লায়েন্স পর্যালোচনা সম্পূর্ণ হয়েছে এমন দাবিও করে না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (provider list; {fileStorage} is chosen from configuration at apps/web/src/app/privacy/page.tsx:11-18; production configuration is not readable from code)
- Reason: LATIN_LEFTOVER is by design (provider names); no data-location or compliance claim added

### SG-e38ca3f4

- English: Acknowledging this notice does not grant marketing permission, enable optional AI processing or share records with an agency. Sharing and optional processing require their own choices and applicable permissions. We do not request marketing consent during registration.
- Source: `apps/web/src/app/privacy/page.tsx:44`
- Bengali now: এই নোটিশ পড়েছেন বলে জানালে মার্কেটিংয়ের অনুমতি দেওয়া হয় না, ঐচ্ছিক এআই প্রক্রিয়াকরণ চালু হয় না এবং কোনো এজেন্সির সঙ্গে রেকর্ড শেয়ার করা হয় না। শেয়ার করা ও ঐচ্ছিক প্রক্রিয়াকরণের জন্য আলাদা পছন্দ এবং প্রযোজ্য অনুমতি লাগে। নিবন্ধনের সময় আমরা মার্কেটিংয়ের সম্মতি চাই না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (apps/web/src/app/auth/sign-up/page.tsx:104-110: a single acknowledgement, no marketing choice at registration)
- Reason: Matches

## MEDIUM consequence (20)


### SG-08f0ee22

- English: Privacy and sharing are governed by actual product permissions.
- Source: `apps/web/src/app/page.tsx:461`
- Bengali now: গোপনীয়তা ও শেয়ারিং প্রোডাক্টের প্রকৃত অনুমতি দিয়ে নিয়ন্ত্রিত হয়।
- Changed in this review. Earlier Bengali: গোপনীয়তা ও শেয়ারিং পণ্যের প্রকৃত অনুমতি দ্বারা নিয়ন্ত্রিত হয়।
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: UNCLEAR (পণ্য reads as goods or merchandise)
- What the code does: UNVERIFIABLE (a general statement; sharing gates at packages/services/src/sharing.ts:211 and :412 support it)
- Reason: প্রোডাক্ট is the everyday word for a software product

### SG-32685596

- English: privacy notice
- Source: `apps/web/src/app/auth/sign-up/page.tsx:107`
- Bengali now: গোপনীয়তা নোটিশ
- Changed in this review. Earlier Bengali: গোপনীয়তা বিজ্ঞপ্তি
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (links to /privacy, titled Privacy Notice at apps/web/src/app/privacy/page.tsx:6 and :21)
- Reason: Same document must carry the same name as the page title (গোপনীয়তা নোটিশ)

### SG-6344adc3

- English: Please use made-up details, or documents with all personal information permanently blacked out. Real applicant details are not accepted yet.
- Source: `apps/web/src/app/page.tsx:614`
- Bengali now: অনুগ্রহ করে বানানো তথ্য ব্যবহার করুন, অথবা এমন ডকুমেন্ট ব্যবহার করুন যাতে সব ব্যক্তিগত তথ্য স্থায়ীভাবে কালো করে ঢেকে দেওয়া হয়েছে। আসল আবেদনকারীর তথ্য এখনো গ্রহণ করা হয় না।
- Changed in this review. Earlier Bengali: অনুগ্রহ করে বানানো তথ্য ব্যবহার করুন, অথবা এমন ডকুমেন্ট ব্যবহার করুন যাতে সব ব্যক্তিগত তথ্য স্থায়ীভাবে কালো করে ঢেকে দেওয়া হয়েছে। আসল আবেদনকারীর তথ্য এখনো নেওয়া হয় না।
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES in its own mode (apps/web/src/app/page.tsx:612-616 shows it only while the public beta is not open), but it conflicts with the unconditional Terms and Privacy text (DECISION_QUEUE D5)
- Reason: নেওয়া হয় না became গ্রহণ করা হয় না (same meaning; clears GLOSSARY_TERM_MISSING)
- Needs a decision: YES: which statement governs while registration is closed (DECISION_QUEUE D5)

### SG-9794512d

- English: Only provide information and files you are authorized to use. Keep your sign-in details private. You control whom you share your records with; creating an account gives no agency automatic access. Do not try to access another person's records or misuse the service.
- Source: `apps/web/src/app/terms/page.tsx:23`
- Bengali now: শুধু সেই তথ্য ও ডকুমেন্ট দিন যা ব্যবহারের অনুমতি আপনার আছে। আপনার সাইন ইনের তথ্য গোপন রাখুন। আপনার রেকর্ড কার সঙ্গে শেয়ার করবেন তা আপনিই ঠিক করেন; অ্যাকাউন্ট তৈরি করলে কোনো এজেন্সি স্বয়ংক্রিয়ভাবে অ্যাক্সেস পায় না। অন্য কারও রেকর্ডে অ্যাক্সেস নেওয়ার চেষ্টা করবেন না, বা সেবাটির অপব্যবহার করবেন না।
- Changed in this review. Earlier Bengali: শুধু সেই তথ্য ও ডকুমেন্ট দিন যা ব্যবহারের অনুমতি আপনার আছে। আপনার সাইন ইনের তথ্য গোপন রাখুন। আপনার রেকর্ড কার সঙ্গে শেয়ার করবেন তা আপনিই ঠিক করেন; অ্যাকাউন্ট তৈরি করলে কোনো এজেন্সি স্বয়ংক্রিয়ভাবে অ্যাক্সেস পায় না। অন্য কারও রেকর্ড দেখার চেষ্টা করবেন না, বা সেবাটির অপব্যবহার করবেন না।
- Fidelity: MEANING_CHANGE. Right or duty changed: User duty narrowed: do not try to access another person's records became do not try to view them. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a duty placed on the user; nothing to check in code)
- Reason: Corrected to অ্যাক্সেস নেওয়ার চেষ্টা

### SG-cd9b2402

- English: Read and acknowledge the terms and privacy notice before creating your account.
- Source: `apps/web/src/app/auth/sign-up/page.tsx:18`
- Bengali now: অ্যাকাউন্ট তৈরি করার আগে শর্তাবলি ও গোপনীয়তা নোটিশ পড়ুন এবং তা স্বীকার করুন।
- Changed in this review. Earlier Bengali: অ্যাকাউন্ট তৈরি করার আগে শর্তাবলি ও গোপনীয়তা বিজ্ঞপ্তি পড়ুন এবং তা স্বীকার করুন।
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (links to /privacy, titled Privacy Notice at apps/web/src/app/privacy/page.tsx:6 and :21)
- Reason: Same document must carry the same name as the page title (গোপনীয়তা নোটিশ)

### SG-150cef4b

- English: Export everything, review your consent history, or delete your account.
- Source: `apps/web/src/app/app/privacy/page.tsx:127`
- Bengali now: সবকিছু এক্সপোর্ট করুন, আপনার সম্মতির ইতিহাস দেখুন, অথবা আপনার অ্যাকাউন্ট মুছে ফেলুন।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (the privacy page offers export, consent history and account deletion, apps/web/src/app/app/privacy/page.tsx:127-214)
- Reason: Matches

### SG-175e0c07

- English: Changes are recorded as new versions. Review your history and request export or deletion, subject to legal retention.
- Source: `apps/web/src/components/public-trust-story.tsx:94`
- Bengali now: পরিবর্তনগুলো নতুন সংস্করণ হিসেবে রেকর্ড করা হয়। আপনার ইতিহাস দেখুন এবং এক্সপোর্ট বা মুছে ফেলার অনুরোধ করুন; আইনি কারণে রেখে দেওয়ার নিয়ম প্রযোজ্য।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (profile changes are stored as fact versions and exported with full history, packages/services/src/export.ts:133-136; deletion is a request with a grace window, packages/services/src/deletion.ts:139-175)
- Reason: সংস্করণ is right here: profile facts have real versions (guardrail C7 keeps a real version)

### SG-245bc9ba

- English: Each traveller below has their own case, checklist, documents and privacy. Their readiness is not a submission, and nothing is sent until you share it yourself.
- Source: `apps/web/src/app/app/trips/trip-overview.tsx:237`
- Bengali now: নিচের প্রত্যেক ভ্রমণকারীর নিজস্ব ভিসা ফাইল, চেকলিস্ট, ডকুমেন্ট ও গোপনীয়তা আছে। তাঁদের প্রস্তুতি মানে কিছু জমা দেওয়া নয়, আর আপনি নিজে শেয়ার না করা পর্যন্ত কিছুই পাঠানো হয় না।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (nothing is shared without a grant the person creates, packages/services/src/sharing.ts:211)
- Reason: Readiness kept distinct from submission (জমা)

### SG-32099ee2

- English: Consent wording and settings were reviewed and are not placeholders.
- Source: `apps/web/src/lib/commercial-readiness.ts:142`
- Bengali now: সম্মতির ভাষা ও সেটিংস পর্যালোচনা করা হয়েছে এবং এগুলো নমুনা বা অস্থায়ী লেখা নয়।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (an attestation claim switched on by an environment variable, apps/web/src/lib/commercial-readiness.ts:121-166; code cannot show the review or check took place)
- Reason: Past tense and scope kept; no stronger claim

### SG-320edc52

- English: Erasure was checked against the live storage provider and removed the stored files.
- Source: `apps/web/src/lib/commercial-readiness.ts:124`
- Bengali now: স্থায়ীভাবে মুছে ফেলার কাজটি চালু স্টোরেজ সরবরাহকারীর সঙ্গে মিলিয়ে পরীক্ষা করা হয়েছে এবং সংরক্ষিত ডকুমেন্টগুলো সরানো হয়েছে।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (an attestation claim switched on by an environment variable, apps/web/src/lib/commercial-readiness.ts:121-166; code cannot show the review or check took place)
- Reason: Past tense and scope kept; no stronger claim

### SG-38dd0a48

- English: Turn on the consent above to continue. <Link>Read the Privacy Policy</Link>.
- Source: `apps/web/src/app/app/trip-invitations/accept/page.tsx:175`
- Bengali now: চালিয়ে যেতে উপরের সম্মতি চালু করুন। <Link>গোপনীয়তা নীতি পড়ুন</Link>।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES for the consent gate (apps/web/src/app/app/sharing-invitations/accept/page.tsx:110 needs CORE_PROCESSING and SHARING); the link says Privacy Policy but opens /privacy, titled Privacy Notice (DECISION_QUEUE D4)
- Reason: Translated as written (গোপনীয়তা নীতি); naming conflict is a source issue
- Needs a decision: YES: one name for the privacy document (DECISION_QUEUE D4)

### SG-51753f4c

- English: Glance: your three rights, each one tap away, and the export downloads.
- Source: `apps/web/src/lib/ccd/depth-words.ts:67`
- Bengali now: এক নজরে: আপনার তিনটি অধিকার, প্রতিটি মাত্র এক ট্যাপ দূরে, এবং এক্সপোর্ট ডাউনলোড।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (the privacy page offers export, consent history and account deletion, apps/web/src/app/app/privacy/page.tsx:127-214)
- Reason: Matches

### SG-576fe5a5

- English: The published terms and privacy notice were reviewed for commercial use.
- Source: `apps/web/src/lib/commercial-readiness.ts:166`
- Bengali now: প্রকাশিত শর্তাবলি ও গোপনীয়তা নোটিশ বাণিজ্যিক ব্যবহারের জন্য পর্যালোচনা করা হয়েছে।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (an attestation claim switched on by an environment variable, apps/web/src/lib/commercial-readiness.ts:121-166; code cannot show the review or check took place)
- Reason: Past tense and scope kept; no stronger claim

### SG-5a3c84ab

- English: Review and turn on the required consent above to continue. <Link>Read the Privacy Policy</Link>.
- Source: `apps/web/src/app/app/sharing-invitations/accept/page.tsx:113`
- Bengali now: চালিয়ে যেতে উপরের আবশ্যক সম্মতি পর্যালোচনা করে চালু করুন। <Link>গোপনীয়তা নীতি পড়ুন</Link>।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES for the consent gate (apps/web/src/app/app/sharing-invitations/accept/page.tsx:110 needs CORE_PROCESSING and SHARING); the link says Privacy Policy but opens /privacy, titled Privacy Notice (DECISION_QUEUE D4)
- Reason: Translated as written (গোপনীয়তা নীতি); naming conflict is a source issue
- Needs a decision: YES: one name for the privacy document (DECISION_QUEUE D4)

### SG-6af435cd

- English: Account creation is free. Available features depend on your role, permissions, safety checks and capacity limits. Access may be restricted to prevent abuse or protect records. Features and availability may change while the beta is being completed.
- Source: `apps/web/src/app/terms/page.tsx:29`
- Bengali now: অ্যাকাউন্ট তৈরি বিনামূল্যে। কোন ফিচার পাওয়া যাবে তা আপনার ভূমিকা, অনুমতি, নিরাপত্তা পরীক্ষা এবং সক্ষমতার সীমার ওপর নির্ভর করে। অপব্যবহার ঠেকাতে বা রেকর্ড সুরক্ষিত রাখতে অ্যাক্সেস সীমিত করা হতে পারে। বিটা সম্পূর্ণ করার সময় ফিচার ও সেবার প্রাপ্যতা বদলাতে পারে।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (general terms of availability)
- Reason: Matches; may and can kept as possibility

### SG-8311d1f1

- English: Export your data, review consent history, or delete your account.
- Source: `apps/web/src/app/app/account/page.tsx:129`
- Bengali now: আপনার তথ্য এক্সপোর্ট করুন, সম্মতির ইতিহাস পর্যালোচনা করুন, অথবা আপনার অ্যাকাউন্ট মুছে ফেলুন।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (the privacy page offers export, consent history and account deletion, apps/web/src/app/app/privacy/page.tsx:127-214)
- Reason: Matches

### SG-8d5be455

- English: Consent is required before we can continue.
- Source: `packages/i18n/src/messages.ts:22`
- Bengali now: চালিয়ে যাওয়ার আগে সম্মতি দেওয়া আবশ্যক।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (core processing consent gates record creation, packages/services/src/applicants.ts:154 and packages/services/src/missions.ts:288)
- Reason: Matches

### SG-94155715

- English: Invite-only test version. Please use made-up details, or documents with all personal information permanently blacked out.
- Source: `apps/web/src/components/pilot-banner.tsx:33`
- Bengali now: শুধু আমন্ত্রিতদের জন্য পরীক্ষামূলক সংস্করণ। অনুগ্রহ করে বানানো তথ্য ব্যবহার করুন, অথবা এমন ডকুমেন্ট ব্যবহার করুন যার সব ব্যক্তিগত তথ্য স্থায়ীভাবে কালো করে ঢেকে দেওয়া হয়েছে।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (apps/web/src/components/pilot-banner.tsx:31-50 shows it in controlled_pilot mode)
- Reason: সংস্করণ is right for a product release (guardrail C7)

### SG-a73edff1

- English: How much you used each AI feature today. Only the number is kept, never what was read. Everything in VisaStack works without these features.
- Source: `apps/web/src/app/app/privacy/page.tsx:253`
- Bengali now: আজ আপনি প্রতিটি এআই ফিচার কতবার ব্যবহার করেছেন। শুধু সংখ্যাটি রাখা হয়, কী পড়া হয়েছে তা কখনো রাখা হয় না। এই ফিচারগুলো ছাড়াও VisaStack-এর সবকিছু কাজ করে।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES for the counter (packages/services/src/ai-feature-settings.ts:856-860: counts only); but AI reading results are stored and exported elsewhere (packages/services/src/export.ts:161-166), so a broad reading of never what was read is not true (DECISION_QUEUE D6)
- Reason: Translation faithful; scope of the English is a source issue
- Needs a decision: YES: should the sentence be scoped to the count (DECISION_QUEUE D6)

### SG-f86300fe

- English: Complimentary during public beta. No payment method is required. Fair-use safeguards and your privacy permissions still apply.
- Source: `apps/web/src/app/app/account/plan/page.tsx:425`
- Bengali now: পাবলিক বিটা চলাকালে বিনামূল্যে। কোনো পেমেন্ট পদ্ধতি লাগে না। ন্যায্য ব্যবহারের সুরক্ষা এবং আপনার গোপনীয়তার অনুমতি এখনও প্রযোজ্য।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (billing and fair-use text; billing behaviour belongs to the commercial queue)
- Reason: Matches

## LOW consequence (42)


### SG-175bd1b6

- English: Place a Legal Hold
- Source: `apps/web/src/app/app/admin/privacy/page.tsx:267`
- Bengali now: আইনি হোল্ড আরোপ করুন
- Changed in this review. Earlier Bengali: আইনি হোল্ড বসান
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: UNCLEAR (বসান is colloquial, literally to seat something; an ordinary reader may not read it as placing a legal hold)
- What the code does: MATCHES (apps/web/src/app/app/admin/privacy/page.tsx:267 and collection-review-forms.tsx:142 place a hold)
- Reason: Formal verb আরোপ করুন is the usual Bangladeshi wording for imposing a legal restriction

### SG-8510dfb6

- English: Place a Legal Hold
- Source: `apps/web/src/app/app/agency/[orgId]/collection/collection-review-forms.tsx:142`
- Bengali now: আইনি হোল্ড আরোপ করুন
- Changed in this review. Earlier Bengali: আইনি হোল্ড বসান
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: UNCLEAR (বসান is colloquial, literally to seat something; an ordinary reader may not read it as placing a legal hold)
- What the code does: MATCHES (apps/web/src/app/app/admin/privacy/page.tsx:267 and collection-review-forms.tsx:142 place a hold)
- Reason: Formal verb আরোপ করুন is the usual Bangladeshi wording for imposing a legal restriction

### SG-0926bf14

- English: To turn on a calendar link, first turn on "Let Me Share with Others" in your privacy settings.
- Source: `packages/services/src/calendar-feeds.ts:38 packages/services/src/calendar-feeds.ts:39`
- Bengali now: ক্যালেন্ডার লিংক চালু করতে আগে আপনার গোপনীয়তা সেটিংসে “আমাকে অন্যদের সঙ্গে শেয়ার করতে দিন” চালু করুন।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (packages/services/src/calendar-feeds.ts:38; the quoted setting name matches the drafted label of SG-cb3783f5)
- Reason: Matches

### SG-0f271b50

- English: Terms of Use
- Source: `apps/web/src/app/terms/page.tsx:10 apps/web/src/app/terms/page.tsx:5`
- Bengali now: ব্যবহারের শর্তাবলি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-1267b7e2

- English: Consent History Entries
- Source: `apps/web/src/app/app/privacy/page.tsx:214`
- Bengali now: সম্মতির ইতিহাসের এন্ট্রি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-173ca489

- English: Privacy and Control
- Source: `apps/web/src/app/layout.tsx:93`
- Bengali now: গোপনীয়তা ও নিয়ন্ত্রণ
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-1abfaa0c

- English: Minor Travel Consent
- Source: `packages/core/src/catalogue/documents.ts:1986`
- Bengali now: অপ্রাপ্তবয়স্কের ভ্রমণের সম্মতিপত্র
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (catalogue document type name, packages/core/src/catalogue/documents.ts; no behaviour)
- Reason: Document type name matches; T113 অপ্রাপ্তবয়স্ক used for Minor

### SG-24b30457

- English: Privacy & Consent
- Source: `apps/web/src/app/app/privacy/page.tsx:123 apps/web/src/app/app/privacy/page.tsx:26`
- Bengali now: গোপনীয়তা ও সম্মতি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-26149f4d

- English: Privacy Notice
- Source: `apps/web/src/app/privacy/page.tsx:21 apps/web/src/app/privacy/page.tsx:6`
- Bengali now: গোপনীয়তা নোটিশ
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-2e193dd2

- English: Permissions You Control on Home
- Source: `apps/web/src/app/app/privacy/page.tsx:276`
- Bengali now: হোমে আপনার নিয়ন্ত্রণে থাকা অনুমতি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-2fc3e71c

- English: Consent History
- Source: `apps/web/src/app/app/privacy/page.tsx:205`
- Bengali now: সম্মতির ইতিহাস
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-36d107b3

- English: Privacy and Consent
- Source: `apps/web/src/app/app/applicant/[id]/documents/add/reading-switch.tsx:86`
- Bengali now: গোপনীয়তা ও সম্মতি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-45dfd82e

- English: A legal hold is due for review
- Source: `packages/services/src/email-design.ts:434`
- Bengali now: একটি আইনি হোল্ডের পর্যালোচনার সময় হয়েছে
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (packages/services/src/legal-hold.ts:556 and packages/services/src/email-design.ts:434 raise a review when the review date passes)
- Reason: Matches

### SG-4fa1082f

- English: privacy controls
- Source: `apps/web/src/app/privacy/page.tsx:50`
- Bengali now: গোপনীয়তা নিয়ন্ত্রণ
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-5a84f019

- English: Privacy
- Source: `apps/web/src/app/auth/auth-ui.tsx:50`
- Bengali now: গোপনীয়তা
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-5b13921f

- English: {percent} ({replacedWithin14Days} of {reminded})
- Source: `apps/web/src/app/app/admin/lifecycle-measures.tsx:21 apps/web/src/app/app/admin/lifecycle-measures.tsx:34`
- Bengali now: {percent} ({reminded}-এর মধ্যে {replacedWithin14Days})
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-621fc37f

- English: Privacy & Consent
- Source: `apps/web/src/app/app/account-menu.tsx:43 apps/web/src/lib/ccd/approved-changes.ts:833`
- Bengali now: গোপনীয়তা ও সম্মতি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-64083da5

- English: Helps us improve - not required
- Source: `apps/web/src/app/app/privacy/deletion-panel.tsx:168`
- Bengali now: আমাদের উন্নতিতে সাহায্য করে - আবশ্যক নয়
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (apps/web/src/app/app/privacy/deletion-panel.tsx:168: the reason is optional)
- Reason: Matches

### SG-68ef0500

- English: terms of use
- Source: `apps/web/src/app/auth/sign-up/page.tsx:106`
- Bengali now: ব্যবহারের শর্তাবলি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-6e328b4a

- English: Parental Consent
- Source: `packages/core/src/catalogue/documents.ts:1974`
- Bengali now: পিতা-মাতার সম্মতি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (catalogue document type name, packages/core/src/catalogue/documents.ts; no behaviour)
- Reason: Document type name matches; T113 অপ্রাপ্তবয়স্ক used for Minor

### SG-81494c50

- English: Read the Terms of Use
- Source: `apps/web/src/app/privacy/page.tsx:63`
- Bengali now: ব্যবহারের শর্তাবলি পড়ুন
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-842d0db1

- English: Your Information and Access
- Source: `apps/web/src/app/terms/page.tsx:21`
- Bengali now: আপনার তথ্য ও অ্যাক্সেস
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-881da04d

- English: Review Your Consent History
- Source: `apps/web/src/app/app/privacy/page.tsx:147`
- Bengali now: আপনার সম্মতির ইতিহাস পর্যালোচনা করুন
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-8c4aa9ee

- English: Open Privacy
- Source: `apps/web/src/app/app/admin/security/page.tsx:70`
- Bengali now: গোপনীয়তা কার্যক্রম খুলুন
- Fidelity: MINOR_DRIFT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (button under the card titled Privacy Operations, opens /app/admin/privacy, apps/web/src/app/app/admin/security/page.tsx:65-70)
- Reason: Adds কার্যক্রম from the card title; acceptable, no change

### SG-937ef42c

- English: return to account creation
- Source: `apps/web/src/app/privacy/page.tsx:64`
- Bengali now: অ্যাকাউন্ট তৈরির ধাপে ফিরে যান
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-a5969851

- English: Erasure
- Source: `apps/web/src/app/app/admin/privacy/page.tsx:276 apps/web/src/app/app/admin/privacy/page.tsx:49 apps/web/src/app/app/privacy/page.tsx:189`
- Bengali now: স্থায়ীভাবে মুছে ফেলা
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-a9386af5

- English: Legal hold review overdue
- Source: `packages/services/src/legal-hold.ts:556`
- Bengali now: আইনি হোল্ডের পর্যালোচনার সময় পেরিয়ে গেছে
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (packages/services/src/legal-hold.ts:556 and packages/services/src/email-design.ts:434 raise a review when the review date passes)
- Reason: Matches

### SG-b4494703

- English: Free Public Beta, at Your Own Risk
- Source: `apps/web/src/app/terms/page.tsx:14`
- Bengali now: বিনামূল্যের পাবলিক বিটা, নিজের ঝুঁকিতে
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-badccd42

- English: Browse: what an export holds, and your consent history.
- Source: `apps/web/src/lib/ccd/depth-words.ts:68`
- Bengali now: দেখুন: এক্সপোর্টে কী থাকে, এবং আপনার সম্মতির ইতিহাস।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-ca2dfc29

- English: Access, Export and Deletion
- Source: `apps/web/src/app/privacy/page.tsx:48`
- Bengali now: অ্যাক্সেস, এক্সপোর্ট ও মুছে ফেলা
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-d313473c

- English: Privacy and Consent
- Source: `apps/web/src/app/app/account/whatsapp/page.tsx:95 apps/web/src/app/app/help/page.tsx:48`
- Bengali now: গোপনীয়তা ও সম্মতি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-d8372380

- English: Turn sharing back on in your privacy settings, then try again.
- Source: `apps/web/src/components/grant-expiry/extend-grant-action.ts:26`
- Bengali now: আপনার গোপনীয়তা সেটিংসে শেয়ারিং আবার চালু করুন, তারপর আবার চেষ্টা করুন।
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (extending a grant needs current sharing consent, packages/services/src/sharing.ts:665-669)
- Reason: Matches

### SG-dcd858fe

- English: Services That Process Information
- Source: `apps/web/src/app/privacy/page.tsx:33`
- Bengali now: যেসব সেবা তথ্য প্রক্রিয়া করে
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-e0e720e4

- English: Privacy
- Source: `apps/web/src/app/app/account/page.tsx:127 apps/web/src/app/app/account/whatsapp/page.tsx:85 apps/web/src/app/app/admin/privacy/page.tsx:147 apps/web/src/app/layout.tsx:131`
- Bengali now: গোপনীয়তা
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-eb83b33d

- English: return to account creation
- Source: `apps/web/src/app/terms/page.tsx:41`
- Bengali now: অ্যাকাউন্ট তৈরির ধাপে ফিরে যান
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-ede39d2a

- English: Read the Privacy Notice
- Source: `apps/web/src/app/terms/page.tsx:40`
- Bengali now: গোপনীয়তা নোটিশ পড়ুন
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-f1fbea6a

- English: Legal Hold Reminder
- Source: `apps/web/src/app/app/admin/email/labels.ts:28`
- Bengali now: আইনি হোল্ডের রিমাইন্ডার
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: MATCHES (email label for the hold review reminder; packages/services/src/legal-hold.ts:556 raises the review)
- Reason: Matches

### SG-f229b451

- English: Open Privacy
- Source: `apps/web/src/app/app/account/page.tsx:132`
- Bengali now: গোপনীয়তা খুলুন
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-f620e9cd

- English: Free Access and Availability
- Source: `apps/web/src/app/terms/page.tsx:27`
- Bengali now: বিনামূল্যে অ্যাক্সেস ও প্রাপ্যতা
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-f63408c5

- English: Privacy and Control
- Source: `apps/web/src/app/trust/page.tsx:14`
- Bengali now: গোপনীয়তা ও নিয়ন্ত্রণ
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-f6deaf53

- English: Sharing Consent
- Source: `packages/i18n/src/messages.ts:19`
- Bengali now: শেয়ার করার সম্মতি
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

### SG-fd3b8956

- English: Request Large Export (With Files)
- Source: `apps/web/src/app/app/privacy/large-export-panel.tsx:92`
- Bengali now: ডকুমেন্টসহ বড় এক্সপোর্টের অনুরোধ করুন
- Fidelity: EXACT. Right or duty changed: NO. Clarity: CLEAR
- What the code does: UNVERIFIABLE (a label or heading; it makes no behaviour claim)
- Reason: Meaning, register and glossary terms match the English

## Newly drafted groups (185)

Drafted in this pass from the English, the glossary and the owner decisions of 2026-11-12. Not reviewed by a person. One group (a message key, not English) is left empty for an owner decision.

| Group | English | Bengali draft | Source |
|---|---|---|---|
| SG-b59f4053 | an active legal hold blocks deletion | চালু আইনি হোল্ড থাকায় মুছে ফেলা যাবে না | `packages/services/src/deletion.ts:172` |
| SG-8b5d1ded | legal hold is already released | আইনি হোল্ড আগেই তুলে নেওয়া হয়েছে | `packages/services/src/legal-hold.ts:274` |
| SG-0a1efaac | legal hold not found | আইনি হোল্ড খুঁজে পাওয়া যায়নি | `packages/services/src/legal-hold.ts:273` |
| SG-bef1ff49 | placing a legal hold requires reauthentication | আইনি হোল্ড আরোপ করতে আবার পরিচয় প্রমাণ করতে হবে | `packages/services/src/legal-hold.ts:171` |
| SG-f23c5e1a | releasing a legal hold requires reauthentication | আইনি হোল্ড তুলে নিতে আবার পরিচয় প্রমাণ করতে হবে | `packages/services/src/legal-hold.ts:263` |
| SG-8ba1df80 | Account settings, consent, shared access and privacy requests are available from your account menu. Signing out ends this session. | অ্যাকাউন্ট সেটিংস, সম্মতি, শেয়ার করা অ্যাক্সেস ও গোপনীয়তা সংক্রান্ত অনুরোধ আপনার অ্যাকাউন্ট মেনুতে আছে। সাইন আউট করলে এই সেশন শেষ হয়। | `apps/web/src/app/app/help/page.tsx:44` |
| SG-ee2dd871 | Choose a case, all current cases or none. | একটি ভিসা ফাইল, বর্তমানের সব ভিসা ফাইল, অথবা কোনোটিই না বেছে নিন। | `apps/web/src/lib/ai-consent-choices.ts:224` |
| SG-d8e3ac0e | Choose at most {AI_FILE_CHOICES_MAX} files under Original Files. | “মূল ডকুমেন্ট” অংশে সর্বোচ্চ {AI_FILE_CHOICES_MAX}টি ডকুমেন্ট বেছে নিন। | `apps/web/src/lib/ai-consent-choices.ts:240` |
| SG-72cc1f61 | Choose how long the app may read. | অ্যাপটি কত সময় ধরে পড়তে পারবে তা বেছে নিন। | `apps/web/src/lib/ai-consent-choices.ts:233` |
| SG-0a178114 | Consent granted. | সম্মতি দেওয়া হয়েছে। | `apps/web/src/app/app/actions.ts:37` |
| SG-75ad9966 | consent may only be changed by the account owner | শুধু অ্যাকাউন্টের মালিকই সম্মতি বদলাতে পারেন | `packages/services/src/consent.ts:123` |
| SG-f337eb92 | Consent revoked. | সম্মতি প্রত্যাহার করা হয়েছে। | `apps/web/src/app/app/actions.ts:37` |
| SG-381440dc | Family members, sponsors and the people you visit. | পরিবারের সদস্য, স্পনসর এবং আপনি যাঁদের কাছে যাচ্ছেন। | `apps/web/src/lib/ai-consent-labels.ts:27` |
| SG-d964ea7e | Files you ticked stay ticked, and you can untick them. | যেসব ডকুমেন্টে টিক দিয়েছেন সেগুলোতে টিক থেকে যাবে, আর আপনি টিক তুলে দিতে পারবেন। | `apps/web/src/lib/ai-consent-labels.ts:70` |
| SG-7ff19ad0 | Income, savings and who pays for the trip. | আয়, সঞ্চয় এবং ভ্রমণের খরচ কে দিচ্ছেন। | `apps/web/src/lib/ai-consent-labels.ts:26` |
| SG-23fb9644 | List of My Documents | আমার ডকুমেন্টের তালিকা | `apps/web/src/lib/ai-consent-labels.ts:43` |
| SG-370d106b | Name, date of birth, nationality and contact details. Numbers show only their last three characters. | নাম, জন্মতারিখ, জাতীয়তা ও যোগাযোগের তথ্য। নম্বরগুলোর শুধু শেষ তিনটি অক্ষর দেখানো হয়। | `apps/web/src/lib/ai-consent-labels.ts:22` |
| SG-9b1e7df8 | Needs List of My Documents, so the app can find each file. | “আমার ডকুমেন্টের তালিকা” দরকার, যাতে অ্যাপটি প্রতিটি ডকুমেন্ট খুঁজে পায়। | `apps/web/src/lib/ai-consent-labels.ts:62` |
| SG-cf70452b | No documents can be shared as files yet. | এখনো এমন কোনো ডকুমেন্ট নেই যার পুরোটা শেয়ার করা যায়। | `apps/web/src/lib/ai-consent-labels.ts:68` |
| SG-68370f7c | Original Files need List of My Documents, so the app can find each file. Turn it on, or untick the files. | “মূল ডকুমেন্ট”-এর জন্য “আমার ডকুমেন্টের তালিকা” দরকার, যাতে অ্যাপটি প্রতিটি ডকুমেন্ট খুঁজে পায়। এটি চালু করুন, অথবা ডকুমেন্টগুলোর টিক তুলে দিন। | `apps/web/src/lib/ai-consent-choices.ts:247` |
| SG-1dbdbe0f | Passport and visa details and their dates. | পাসপোর্ট ও ভিসার তথ্য এবং সেগুলোর তারিখ। | `apps/web/src/lib/ai-consent-labels.ts:24` |
| SG-da40c9e7 | Passports and Travel Documents | পাসপোর্ট ও ভ্রমণের ডকুমেন্ট | `apps/web/src/lib/ai-consent-labels.ts:11` |
| SG-d617070e | Passports, identity, money and health documents are protected and never shared with AI apps. | পাসপোর্ট, পরিচয়, অর্থ ও স্বাস্থ্য সংক্রান্ত ডকুমেন্ট সুরক্ষিত থাকে এবং কখনো এআই অ্যাপের সঙ্গে শেয়ার করা হয় না। | `apps/web/src/lib/ai-consent-labels.ts:60` |
| SG-3d87edad | Past Refusals and Declarations | আগের প্রত্যাখ্যান ও ঘোষণা | `apps/web/src/lib/ai-consent-labels.ts:16` |
| SG-fbd3c08b | Past trips, where you lived and where you worked. | আগের ভ্রমণ, কোথায় থাকতেন এবং কোথায় কাজ করতেন। | `apps/web/src/lib/ai-consent-labels.ts:25` |
| SG-fe5bbae6 | Prepare a Safe Copy on the document’s page. Until then the app gets nothing for this file. | ডকুমেন্টের পৃষ্ঠায় একটি নিরাপদ কপি তৈরি করুন। ততক্ষণ পর্যন্ত এই ডকুমেন্টের কিছুই অ্যাপটি পায় না। | `apps/web/src/lib/ai-consent-labels.ts:65` |
| SG-bd2f6493 | Schools, degrees and certificates. | স্কুল, ডিগ্রি ও সনদ। | `apps/web/src/lib/ai-consent-labels.ts:28` |
| SG-6263c0a0 | Sensitive: health details. Allow only if the app needs them. | সংবেদনশীল: স্বাস্থ্যের তথ্য। অ্যাপটির দরকার হলে তবেই অনুমতি দিন। | `apps/web/src/lib/ai-consent-labels.ts:31` |
| SG-0dbe9cb8 | Sensitive: past visa refusals and legal declarations. Allow only if the app needs them. | সংবেদনশীল: আগের ভিসা প্রত্যাখ্যান ও আইনি ঘোষণা। অ্যাপটির দরকার হলে তবেই অনুমতি দিন। | `apps/web/src/lib/ai-consent-labels.ts:29` |
| SG-6eb3578a | Sensitive: the app receives the whole file of each document you tick. A Safe Copy hides what you covered in black; the Original is the file exactly as you uploaded it. PDF, PNG and JPEG files up to 3 MB. | সংবেদনশীল: আপনি যেসব ডকুমেন্টে টিক দেবেন, অ্যাপটি তার প্রতিটির পুরোটা পায়। নিরাপদ কপিতে আপনি যা কালো করে ঢেকেছেন তা লুকানো থাকে; মূল ডকুমেন্ট হলো ঠিক যেভাবে আপলোড করেছিলেন সেভাবেই। PDF, PNG ও JPEG, সর্বোচ্চ ৩ MB। | `apps/web/src/lib/ai-consent-labels.ts:58` |
| SG-75f71b03 | Some capabilities need an active permission, recorded consent or a configured service. The page explains the missing requirement. Current release and service limitations are published on the status page. | কিছু সুবিধার জন্য চালু অনুমতি, রেকর্ড করা সম্মতি বা কনফিগার করা সেবা দরকার। কোনটি নেই, পৃষ্ঠাটি তা ব্যাখ্যা করে। বর্তমান রিলিজ ও সেবার সীমাবদ্ধতা স্ট্যাটাস পাতায় প্রকাশ করা আছে। | `apps/web/src/app/app/help/page.tsx:92` |
| SG-4d46294d | Text Read From My Documents | আমার ডকুমেন্ট থেকে পড়া লেখা | `apps/web/src/lib/ai-consent-labels.ts:44` |
| SG-0dd3aef5 | The app can suggest updates, save drafts and add reminders to your cases. Suggested updates change nothing until you accept them. | অ্যাপটি আপনার ভিসা ফাইলে আপডেটের পরামর্শ দিতে, খসড়া সংরক্ষণ করতে এবং রিমাইন্ডার যোগ করতে পারে। আপনি গ্রহণ না করা পর্যন্ত পরামর্শ দেওয়া আপডেটে কিছুই বদলায় না। | `apps/web/src/lib/ai-consent-labels.ts:48` |
| SG-b1e2bc1a | Tick Share This File first to choose how it is given. | কীভাবে দেওয়া হবে তা বেছে নিতে আগে “এই ডকুমেন্ট শেয়ার করুন”-এ টিক দিন। | `apps/web/src/lib/ai-consent-labels.ts:67` |
| SG-e4165b88 | Travel, Home and Work History | ভ্রমণ, বসবাস ও কাজের ইতিহাস | `apps/web/src/lib/ai-consent-labels.ts:12` |
| SG-4fbca601 | Unknown consent type. | অজানা ধরনের সম্মতি। | `apps/web/src/app/app/actions.ts:26` |
| SG-5cd4a77d | Until I Turn It Off | আমি বন্ধ না করা পর্যন্ত | `apps/web/src/lib/ai-consent-labels.ts:39` |
| SG-82270d99 | You confirm it is you before an Original is allowed. | মূল ডকুমেন্টের অনুমতি দেওয়ার আগে আপনি নিশ্চিত করবেন যে এটি আপনিই। | `apps/web/src/lib/ai-consent-labels.ts:64` |
| SG-87e7b2f4 | Your choice is kept for when it is turned on again. | আবার চালু হলে ব্যবহারের জন্য আপনার পছন্দটি রেখে দেওয়া হয়। | `apps/web/src/lib/ai-consent-labels.ts:51` |
| SG-554aa6a7 | <Link>Read the Terms of Use</Link> or <Link>return to account creation</Link>. | <Link>ব্যবহারের শর্তাবলি পড়ুন</Link> অথবা <Link>অ্যাকাউন্ট তৈরির ধাপে ফিরে যান</Link>। | `apps/web/src/app/privacy/page.tsx:62` |
| SG-29931c8d | <strong>Deletion pending.</strong> Your account and all owned data are scheduled for permanent deletion on {when}. Cancel any time before then to keep your account. | <strong>মুছে ফেলা অপেক্ষমাণ।</strong> আপনার অ্যাকাউন্ট ও আপনার মালিকানাধীন সব তথ্য {when} তারিখে স্থায়ীভাবে মুছে ফেলার জন্য নির্ধারিত আছে। অ্যাকাউন্ট রাখতে চাইলে তার আগে যেকোনো সময় বাতিল করুন। | `apps/web/src/app/app/privacy/deletion-panel.tsx:83` |
| SG-6a6955fa | <strong>This deletes your entire account.</strong> There is no partial deletion - every traveller on your account goes with it. <ul/> | <strong>এতে আপনার পুরো অ্যাকাউন্ট মুছে যাবে।</strong> আংশিকভাবে মুছে ফেলার কোনো উপায় নেই - আপনার অ্যাকাউন্টের প্রত্যেক ভ্রমণকারীও এর সঙ্গে মুছে যাবে। <ul/> | `apps/web/src/app/app/privacy/deletion-panel.tsx:139` |
| SG-acf01c97 | Deletion scheduled for {when}. You can cancel any time before then. | {when} তারিখে মুছে ফেলা নির্ধারিত হয়েছে। তার আগে যেকোনো সময় আপনি বাতিল করতে পারেন। | `apps/web/src/app/app/privacy/actions.ts:52` |
| SG-d8b4b363 | Preparing your export. This can take a few minutes. | আপনার এক্সপোর্ট তৈরি হচ্ছে। এতে কয়েক মিনিট লাগতে পারে। | `apps/web/src/app/app/privacy/actions.ts:90` |
| SG-b10c4f28 | Schedule permanent deletion of your account and all owned data? You will have a 7-day grace window to cancel. | আপনার অ্যাকাউন্ট ও মালিকানাধীন সব তথ্য স্থায়ীভাবে মুছে ফেলার সময় নির্ধারণ করবেন? বাতিল করার জন্য আপনি ৭ দিনের অপেক্ষার সময় পাবেন। | `apps/web/src/app/app/privacy/deletion-panel.tsx:174` |
| SG-3d2a95ab | Signed-in users can use <Link>privacy controls</Link> to review available consent choices, export their account information or request deletion. Deletion is a process, not an immediate promise to erase every record: legal holds and required audit retention can restrict it. Revoking sharing stops future permitted access; it cannot recall copies someone has already downloaded. | সাইন ইন করা ব্যবহারকারীরা <Link>গোপনীয়তা নিয়ন্ত্রণ</Link> ব্যবহার করে সম্মতির যেসব পছন্দ আছে তা পর্যালোচনা করতে, নিজের অ্যাকাউন্টের তথ্য এক্সপোর্ট করতে বা মুছে ফেলার অনুরোধ করতে পারেন। মুছে ফেলা একটি প্রক্রিয়া, প্রতিটি রেকর্ড সঙ্গে সঙ্গে স্থায়ীভাবে মুছে ফেলার প্রতিশ্রুতি নয়: আইনি হোল্ড এবং আবশ্যক অডিট রেকর্ড রেখে দেওয়ার নিয়ম এটি সীমিত করতে পারে। শেয়ার প্রত্যাহার করলে ভবিষ্যতের অনুমতিপ্রাপ্ত অ্যাক্সেস বন্ধ হয়; কেউ আগে ডাউনলোড করে ফেলা কপি এতে ফেরত আনা যায় না। | `apps/web/src/app/privacy/page.tsx:49` |
| SG-b1b40624 | Turn each permission on or off under <Link>Permissions You Control on Home</Link>. | <Link>হোমে আপনার নিয়ন্ত্রণে থাকা অনুমতি</Link> অংশে প্রতিটি অনুমতি চালু বা বন্ধ করুন। | `apps/web/src/app/app/privacy/page.tsx:274` |
| SG-7d20f7d1 | Version {SIGNUP_PRIVACY_VERSION}. This beta notice awaits legal review. | সংস্করণ {SIGNUP_PRIVACY_VERSION}। এই বিটা নোটিশ আইনি পর্যালোচনার অপেক্ষায় আছে। | `apps/web/src/app/privacy/page.tsx:22` |
| SG-5f48080c | Want a copy first? <a> Download your export </a> before deleting - it will not be possible afterward. | আগে একটি কপি চান? মুছে ফেলার আগে <a> আপনার এক্সপোর্ট ডাউনলোড করুন </a> - পরে আর তা সম্ভব হবে না। | `apps/web/src/app/app/privacy/deletion-panel.tsx:148` |
| SG-0d0027cc | <Link>Read the Privacy Notice</Link> or <Link>return to account creation</Link>. | <Link>গোপনীয়তা নোটিশ পড়ুন</Link> অথবা <Link>অ্যাকাউন্ট তৈরির ধাপে ফিরে যান</Link>। | `apps/web/src/app/terms/page.tsx:39` |
| SG-4baf5be8 | Version {SIGNUP_TERMS_VERSION}. These beta terms await legal review. | সংস্করণ {SIGNUP_TERMS_VERSION}। এই বিটা শর্তাবলি আইনি পর্যালোচনার অপেক্ষায় আছে। | `apps/web/src/app/terms/page.tsx:11` |
| SG-2a073212 | I am worried about my privacy | আমি আমার গোপনীয়তা নিয়ে চিন্তিত | `apps/web/src/app/app/applicant/[id]/documents/manage/request/messages.ts:17` |
| SG-3fd32cc9 | Privacy and Data Requests | গোপনীয়তা ও তথ্য সংক্রান্ত অনুরোধ | `apps/web/src/app/app/help/page.tsx:127` |
| SG-2e43f107 | We have to keep it because of a legal requirement. | একটি আইনি বাধ্যবাধকতার কারণে আমাদের এটি রাখতে হবে। | `packages/services/src/lifecycle/removal-requests/requests.ts:404` |
| SG-be531cca | Adoption order, home study, consent | দত্তক আদেশ, হোম স্টাডি, সম্মতি | `packages/core/src/catalogue/purposes.ts:391` |
| SG-7a70216e | AI Extraction Consent | এআই দিয়ে তথ্য বের করার সম্মতি | `packages/i18n/src/messages.ts:17` |
| SG-32f95e47 | AI OCR Consent | এআই OCR সম্মতি | `packages/i18n/src/messages.ts:18` |
| SG-bb26b48c | changing a retention policy requires reauthentication | রেখে দেওয়ার নীতি বদলাতে আবার পরিচয় প্রমাণ করতে হবে | `packages/services/src/retention.ts:53` |
| SG-a1fe652c | Core Processing Consent | মূল প্রক্রিয়াকরণের সম্মতি | `packages/i18n/src/messages.ts:16` |
| SG-eb919849 | Evidence of family ties, custody and consent. | পারিবারিক সম্পর্ক, হেফাজত (কাস্টডি) ও সম্মতির প্রমাণ। | `packages/core/src/catalogue/layers.ts:118` |
| SG-812c2808 | For your privacy, VisaStack does not take documents in WhatsApp. Add them in VisaStack, where they are checked and kept private. | আপনার গোপনীয়তার জন্য VisaStack WhatsApp-এ ডকুমেন্ট নেয় না। VisaStack-এ সেগুলো যোগ করুন, যেখানে সেগুলো পরীক্ষা করা হয় এবং গোপন রাখা হয়। | `packages/services/src/channels/whatsapp-replies.ts:109` |
| SG-5d200bba | Issuer Contact Consent | ইস্যুকারীর সঙ্গে যোগাযোগের সম্মতি | `packages/i18n/src/messages.ts:21` |
| SG-630b77f1 | Marketing Consent | মার্কেটিংয়ের সম্মতি | `packages/i18n/src/messages.ts:20` |
| SG-1de7419b | running retention purge requires reauthentication | মেয়াদ শেষে মুছে ফেলা চালাতে আবার পরিচয় প্রমাণ করতে হবে | `packages/services/src/retention.ts:159` |
| SG-3b2f1526 | This copy must be kept for a legal requirement. | একটি আইনি বাধ্যবাধকতার কারণে এই কপিটি রাখতে হবে। | `apps/web/src/app/app/applicant/[id]/documents/manage/delete/messages.ts:39` |
| SG-8353718a | this document has a retention purge in progress and cannot be modified until it completes | এই ডকুমেন্টটি মেয়াদ শেষে মুছে ফেলার প্রক্রিয়ায় আছে, তাই তা শেষ না হওয়া পর্যন্ত এতে কোনো পরিবর্তন করা যাবে না | `packages/services/src/documents.ts:369` |
| SG-fa428b87 | Turning it on allows both. To choose them one at a time, use <a>Privacy and Consent</a>. | এটি চালু করলে দুটোরই অনুমতি দেওয়া হয়। একটি একটি করে বেছে নিতে <a>গোপনীয়তা ও সম্মতি</a> ব্যবহার করুন। | `apps/web/src/app/app/applicant/[id]/documents/add/reading-switch.tsx:84` |
| SG-18f35b62 | Not for real personal data. | আসল ব্যক্তিগত তথ্যের জন্য নয়। | `apps/web/src/components/pilot-banner.tsx:40` |
| SG-ece02514 | Privacy | গোপনীয়তা | `apps/web/src/lib/navigation.ts:113` |
| SG-89e05319 | Privacy & Consent | গোপনীয়তা ও সম্মতি | `apps/web/src/lib/navigation.ts:47` |
| SG-dbc60d2c | Privacy Operations | গোপনীয়তা কার্যক্রম | `apps/web/src/lib/workspace-navigation.ts:114` |
| SG-31bc4338 | Test build. Not for real personal data. | পরীক্ষামূলক বিল্ড। আসল ব্যক্তিগত তথ্যের জন্য নয়। | `apps/web/src/components/pilot-banner.tsx:39` |
| SG-c87bb1a1 | Paid until {formatBillingDate}. Fair-use safeguards and your privacy permissions still apply. | {formatBillingDate} পর্যন্ত পরিশোধিত। ন্যায্য ব্যবহারের সুরক্ষা এবং আপনার গোপনীয়তার অনুমতি এখনও প্রযোজ্য। | `apps/web/src/app/app/account/plan/page.tsx:418` |
| SG-8cc9ef74 | <strong>{applicantDisplayName}</strong> - {reason}, scoped to {scopeLabel} (placed {formatDate}, next review {choice}, accessible to {choice}) | <strong>{applicantDisplayName}</strong> - {reason}, পরিসর: {scopeLabel} (আরোপ করা হয়েছে {formatDate}, পরবর্তী পর্যালোচনা {choice}, অ্যাক্সেস আছে: {choice}) | `apps/web/src/app/app/privacy/deletion-panel.tsx:108` |
| SG-27612c28 | Account and Privacy | অ্যাকাউন্ট ও গোপনীয়তা | `apps/web/src/app/app/help/page.tsx:42` |
| SG-575944d9 | Could not be made | তৈরি করা যায়নি | `apps/web/src/app/app/privacy/large-export-panel.tsx:56` |
| SG-2b888ade | Download a copy of your data, or ask for your account to be deleted. Both start from the privacy page. | আপনার তথ্যের একটি কপি ডাউনলোড করুন, অথবা আপনার অ্যাকাউন্ট মুছে ফেলার অনুরোধ করুন। দুটোই গোপনীয়তা পৃষ্ঠা থেকে শুরু হয়। | `apps/web/src/app/app/help/page.tsx:124` |
| SG-5ea17c19 | Each time you turn a permission on or off, it is recorded here with the date. | প্রতিবার আপনি কোনো অনুমতি চালু বা বন্ধ করলে তা তারিখসহ এখানে রেকর্ড করা হয়। | `apps/web/src/app/app/privacy/page.tsx:208` |
| SG-0fd8f216 | Loading your privacy choices | আপনার গোপনীয়তার পছন্দগুলো লোড হচ্ছে | `apps/web/src/app/app/privacy/loading.tsx:5` |
| SG-ea300f15 | View Privacy Details <Icon/> | গোপনীয়তার বিস্তারিত দেখুন <Icon/> | `apps/web/src/components/public-trust-story.tsx:111` |
| SG-d5d19ba4 | Your Data and Privacy | আপনার তথ্য ও গোপনীয়তা | `apps/web/src/app/app/help/page.tsx:122` |
| SG-467f32a9 | Your data is safe and nothing was changed. Request it again below. If it fails twice, <a>get help</a>. | আপনার তথ্য নিরাপদ আছে এবং কিছুই বদলানো হয়নি। নিচে আবার অনুরোধ করুন। দুবার ব্যর্থ হলে <a>সহায়তা নিন</a>। | `apps/web/src/app/app/privacy/large-export-panel.tsx:57` |
| SG-87a8d4d5 | Kept (Legal Requirement) | রাখা হয়েছে (আইনি বাধ্যবাধকতা) | `apps/web/src/app/app/admin/removals/page.tsx:104` |
| SG-7ee619ce | All Protections for Real Personal Data in Place | আসল ব্যক্তিগত তথ্যের জন্য সব সুরক্ষা চালু আছে | `apps/web/src/app/status/capability-names.ts:31` |
| SG-ab1a7a9b | {retentionDays} days from upload, under this platform's standard retention policy. | আপলোডের দিন থেকে {retentionDays} দিন, এই প্ল্যাটফর্মের সাধারণ রেখে দেওয়ার নীতি অনুযায়ী। | `apps/web/src/app/app/contributor-requests/accept/page.tsx:103` |
| SG-10df57ea | Read the Privacy Policy | গোপনীয়তা নীতি পড়ুন | `apps/web/src/app/app/sharing-invitations/accept/page.tsx:115` |
| SG-5c041cc3 | This document type doesn't have a specific retention period configured yet. | এই ধরনের ডকুমেন্টের জন্য এখনো কোনো নির্দিষ্ট রেখে দেওয়ার মেয়াদ ঠিক করা হয়নি। | `apps/web/src/app/app/contributor-requests/accept/page.tsx:103` |
| SG-12335425 | Turn on the consent above to join this trip. | এই ভ্রমণে যোগ দিতে উপরের সম্মতি চালু করুন। | `apps/web/src/app/app/trip-invitations/accept/words.ts:11` |
| SG-d4e5d938 | Each traveller keeps their own case, documents and privacy. Nothing is shared between travellers unless you choose it. | প্রত্যেক ভ্রমণকারীর নিজস্ব ভিসা ফাইল, ডকুমেন্ট ও গোপনীয়তা থাকে। আপনি না চাইলে ভ্রমণকারীদের মধ্যে কিছুই শেয়ার হয় না। | `apps/web/src/app/app/trips/trip-forms.tsx:355` |
| SG-ddba2530 | Plan one trip for several travellers. Each traveller keeps their own case, documents and privacy. | কয়েকজন ভ্রমণকারীর জন্য একটি ভ্রমণ পরিকল্পনা করুন। প্রত্যেক ভ্রমণকারীর নিজস্ব ভিসা ফাইল, ডকুমেন্ট ও গোপনীয়তা থাকে। | `apps/web/src/app/app/trips/(list)/page.tsx:53` |
| SG-ecd96750 | Birth certificate, parent or guardian consent and financial evidence as applicable. | জন্ম সনদ, পিতা-মাতা বা অভিভাবকের সম্মতি এবং আর্থিক প্রমাণ, যেখানে যেটি প্রযোজ্য। | `packages/core/src/starter-checklists/seed-rows.ts:1470` |
| SG-01e34e77 | Birth certificate, parental signatures and consent plus parent ID/passport copies if relevant. | জন্ম সনদ, পিতা-মাতার স্বাক্ষর ও সম্মতি, এবং প্রাসঙ্গিক হলে পিতা-মাতার পরিচয়পত্র/পাসপোর্টের কপি। | `packages/core/src/starter-checklists/seed-rows.ts:3246` |
| SG-21e2947f | Child birth certificate, school ID and parental consent as appropriate. | শিশুর জন্ম সনদ, স্কুলের পরিচয়পত্র এবং পিতা-মাতার সম্মতি, যেখানে যেটি উপযুক্ত। | `packages/core/src/starter-checklists/seed-rows.ts:2158` |
| SG-32f5aefc | Original passport and photocopy of pages containing passport and personal data; validity at least 3 months beyond planned Schengen departure and two blank pages. | মূল পাসপোর্ট এবং পাসপোর্ট ও ব্যক্তিগত তথ্যসংবলিত পাতাগুলোর ফটোকপি; শেনজেন এলাকা ছাড়ার পরিকল্পিত তারিখের পর অন্তত ৩ মাস মেয়াদ এবং দুটি খালি পাতা থাকতে হবে। | `packages/core/src/starter-checklists/seed-rows.ts:1518` |
| SG-7ba0413d | Parental consent letter for applicants under 18. | ১৮ বছরের কম বয়সী আবেদনকারীদের জন্য পিতা-মাতার সম্মতিপত্র। | `packages/core/src/starter-checklists/seed-rows.ts:1630` |
| SG-5d43545f | Parental permission/custodian consent and child’s birth certificate. | পিতা-মাতার অনুমতি/হেফাজতকারীর সম্মতি এবং শিশুর জন্ম সনদ। | `packages/core/src/starter-checklists/seed-rows.ts:2838` |
| SG-f974eb5d | Parental travel consent for applicants under 18. | ১৮ বছরের কম বয়সী আবেদনকারীদের জন্য পিতা-মাতার ভ্রমণ সম্মতি। | `packages/core/src/starter-checklists/seed-rows.ts:2718` |
| SG-c1fd1aad | Case Retention Notice | ভিসা ফাইল রেখে দেওয়ার মেয়াদের নোটিশ | `apps/web/src/app/app/admin/email/labels.ts:27` |
| SG-8f27e9ec | Existing access, audit and privacy controls. This is not a complete security-monitoring service. | বিদ্যমান অ্যাক্সেস, অডিট ও গোপনীয়তা নিয়ন্ত্রণ। এটি কোনো পূর্ণাঙ্গ নিরাপত্তা-নজরদারি সেবা নয়। | `apps/web/src/app/app/admin/security/page.tsx:27` |
| SG-f18084ab | Legal hold placed. | আইনি হোল্ড আরোপ করা হয়েছে। | `apps/web/src/app/app/admin/actions.ts:138` |
| SG-06f8fd1e | Legal hold released. | আইনি হোল্ড তুলে নেওয়া হয়েছে। | `apps/web/src/app/app/admin/actions.ts:169` |
| SG-7749ec18 | Manage Privacy Policy Controls | গোপনীয়তা নীতির নিয়ন্ত্রণ পরিচালনা করুন | `apps/web/src/app/app/admin/settings/page.tsx:95` |
| SG-38a6a98a | Nothing in the audit trail was done by {who}. Check the email, or show everyone. | অডিট ট্রেইলে {who}-এর করা কোনো কাজ নেই। ইমেইলটি দেখে নিন, অথবা সবাইকে দেখান। | `apps/web/src/app/app/admin/audit/page.tsx:151` |
| SG-890690f6 | Place Legal Hold | আইনি হোল্ড আরোপ করুন | `apps/web/src/app/app/admin/admin-forms.tsx:263` |
| SG-0ca5460f | Privacy Operations | গোপনীয়তা কার্যক্রম | `apps/web/src/app/app/admin/security/page.tsx:65` |
| SG-4f4528e1 | Retention (Days) | রেখে দেওয়ার মেয়াদ (দিন) | `apps/web/src/app/app/admin/admin-forms.tsx:147` |
| SG-6ae28fe2 | Retention days must be a positive number. | রেখে দেওয়ার দিনের সংখ্যা অবশ্যই শূন্যের চেয়ে বড় হতে হবে। | `apps/web/src/app/app/admin/actions.ts:56` |
| SG-71ea5c4c | Retention for {value} set to {retentionDays} days. | {value}-এর রেখে দেওয়ার মেয়াদ {retentionDays} দিন ঠিক করা হয়েছে। | `apps/web/src/app/app/admin/actions.ts:81` |
| SG-dcbc13ec | Retention Policy | রেখে দেওয়ার নীতি | `apps/web/src/app/app/admin/settings/page.tsx:94` |
| SG-313c0a49 | Review current staff roles and account-access references. Role changes retain their owner and reauthentication checks. | স্টাফদের বর্তমান ভূমিকা ও অ্যাকাউন্ট-অ্যাক্সেসের রেফারেন্স পর্যালোচনা করুন। ভূমিকা বদলের সময় মালিকের পরীক্ষা ও আবার পরিচয় প্রমাণ করার পরীক্ষা বহাল থাকে। | `apps/web/src/app/app/admin/security/page.tsx:33` |
| SG-7f69a3f5 | Review retention, deletion and legal-hold work through existing permissions. | বিদ্যমান অনুমতির মাধ্যমে রেখে দেওয়া, মুছে ফেলা ও আইনি হোল্ডের কাজ পর্যালোচনা করুন। | `apps/web/src/app/app/admin/security/page.tsx:67` |
| SG-3def150b | Turn each AI feature on or off, set how much each person may use it a day, and manage AI providers, their data terms and AI apps. Everything in VisaStack works without AI. | প্রতিটি এআই ফিচার চালু বা বন্ধ করুন, প্রত্যেক ব্যক্তি দিনে কতটা ব্যবহার করতে পারবেন তা ঠিক করুন, এবং এআই সরবরাহকারী, তাদের ডেটা শর্তাবলি ও এআই অ্যাপ পরিচালনা করুন। এআই ছাড়াও VisaStack-এর সবকিছু কাজ করে। | `apps/web/src/app/app/admin/ai/page.tsx:141` |
| SG-458548c5 | A time-limited bypass of this organization's commercial capacity caps and any billing suspension. Never bypasses security, consent, or release gates. | একটি নির্দিষ্ট সময়ের জন্য এই প্রতিষ্ঠানের বাণিজ্যিক সক্ষমতার সীমা ও যেকোনো বিলিং স্থগিতাদেশ পাশ কাটানোর ব্যবস্থা। এটি কখনো নিরাপত্তা, সম্মতি বা রিলিজের শর্ত পাশ কাটায় না। | `apps/web/src/app/app/admin/organizations/[orgId]/page.tsx:603` |
| SG-94ed246d | Erasure jobs that exhausted their retries are a deletion obligation not met. A job blocked by a legal hold is deliberate and only needs review when the hold lifts. | যেসব স্থায়ীভাবে মুছে ফেলার কাজ সব পুনঃচেষ্টা শেষ করে ফেলেছে, সেগুলো মানে মুছে ফেলার একটি বাধ্যবাধকতা পূরণ হয়নি। আইনি হোল্ডের কারণে আটকে থাকা কাজ ইচ্ছাকৃত, এবং হোল্ড উঠে গেলে তবেই পর্যালোচনা দরকার। | `packages/services/src/operational-signals.ts:637` |
| SG-1833e880 | Uploads that failed after a reservation, and stored files that could not be deleted. A stuck deletion is a retention obligation not yet met. | রিজার্ভেশনের পর ব্যর্থ হওয়া আপলোড, এবং যেসব সংরক্ষিত ডকুমেন্ট মুছে ফেলা যায়নি। অসম্পূর্ণ থেকে যাওয়া মুছে ফেলা মানে রেখে দেওয়ার নিয়মের একটি বাধ্যবাধকতা এখনো পূরণ হয়নি। | `packages/services/src/operational-signals.ts:380` |
| SG-f3c18793 | This reading covers environment configuration only. Existing administration settings can select a database-managed provider, and the enable switch, consent, budget and human review still govern processing. Manual case preparation stays available. | এই তথ্য শুধু এনভায়রনমেন্ট কনফিগারেশন দেখায়। বিদ্যমান অ্যাডমিন সেটিংসে ডেটাবেস থেকে পরিচালিত একটি সরবরাহকারী বেছে নেওয়া যায়, এবং চালু করার সুইচ, সম্মতি, বাজেট ও মানুষের পর্যালোচনাই প্রক্রিয়াকরণ নিয়ন্ত্রণ করে। হাতে ভিসা ফাইল প্রস্তুত করার সুযোগ চালু থাকে। | `apps/web/src/lib/provider-operations.ts:167` |
| SG-2c29d6ae | A live key does not prove independent recovery, escrow or rotation. Retain a separate tested recovery procedure before sensitive-data activation. | একটি চালু কী (key) থাকলেই স্বতন্ত্র পুনরুদ্ধার, এসক্রো বা রোটেশন প্রমাণ হয় না। সংবেদনশীল তথ্য চালু করার আগে আলাদা ও পরীক্ষিত একটি পুনরুদ্ধার পদ্ধতি রাখুন। | `apps/web/src/lib/provider-operations.ts:185` |
| SG-66303617 | {medianWorkingDays} working days ({decided} decided, {overThirtyDays} over {targetMaxDays} days) | {medianWorkingDays} কর্মদিবস ({decided}টির সিদ্ধান্ত হয়েছে, {overThirtyDays}টি {targetMaxDays} দিনের বেশি) | `apps/web/src/app/app/admin/lifecycle-measures.tsx:44` |
| SG-c6bde3c0 | {per100} ({duplicates} of {documents} documents) | {per100} ({documents}টি ডকুমেন্টের মধ্যে {duplicates}টি) | `apps/web/src/app/app/admin/lifecycle-measures.tsx:27` |
| SG-0bd1077e | Archive, Replace and Removal | আর্কাইভ, প্রতিস্থাপন ও সরানো | `apps/web/src/app/app/admin/lifecycle-measures.tsx:82` |
| SG-35833103 | Back to the Newest Holds | সবচেয়ে নতুন হোল্ডগুলোতে ফিরে যান | `apps/web/src/app/app/admin/privacy/page.tsx:262` |
| SG-daaf47e0 | Counts only, never a name or a file. Targets are a starting point, to confirm after 30 days of pilot use. Deleted items shown anywhere: none, checked on every build. | শুধু সংখ্যা, কখনো কোনো নাম বা ডকুমেন্ট নয়। লক্ষ্যমাত্রাগুলো শুরুর একটি ভিত্তি, পাইলট ব্যবহারের ৩০ দিন পর নিশ্চিত করতে হবে। কোথাও দেখানো মুছে ফেলা আইটেম: একটিও নয়, প্রতিটি বিল্ডে পরীক্ষা করা হয়। | `apps/web/src/app/app/admin/lifecycle-measures.tsx:94` |
| SG-81339891 | Document Retention Policies | ডকুমেন্ট রেখে দেওয়ার নীতি | `apps/web/src/app/app/admin/privacy/page.tsx:178` |
| SG-54884fb5 | Documents Eligible for Purge | মেয়াদ শেষে মুছে ফেলার যোগ্য ডকুমেন্ট | `apps/web/src/app/app/admin/privacy/page.tsx:321` |
| SG-6136cbfc | Erasure Jobs Needing Attention | মনোযোগ দরকার এমন স্থায়ীভাবে মুছে ফেলার কাজ | `apps/web/src/app/app/admin/privacy/page.tsx:277` |
| SG-0fa6c912 | Expiry Reminders Followed by a Replacement Within 14 Days | মেয়াদ শেষের রিমাইন্ডারের পর ১৪ দিনের মধ্যে প্রতিস্থাপন | `apps/web/src/app/app/admin/lifecycle-measures.tsx:20` |
| SG-384138fe | No active legal holds. A hold blocks deletion and retention purge for an applicant until released. | কোনো চালু আইনি হোল্ড নেই। হোল্ড তুলে না নেওয়া পর্যন্ত তা একজন আবেদনকারীর ক্ষেত্রে মুছে ফেলা ও মেয়াদ শেষে মুছে ফেলা আটকে রাখে। | `apps/web/src/app/app/admin/privacy/page.tsx:205` |
| SG-566a8591 | No decisions yet ({overThirtyDays} over {targetMaxDays} days) | এখনো কোনো সিদ্ধান্ত হয়নি ({overThirtyDays}টি {targetMaxDays} দিনের বেশি) | `apps/web/src/app/app/admin/lifecycle-measures.tsx:44` |
| SG-5fef521c | No documents are currently past their retention policy (or all are under an active legal hold). | এই মুহূর্তে কোনো ডকুমেন্ট তার রেখে দেওয়ার নীতির মেয়াদ পার হয়নি (অথবা সবগুলোতে চালু আইনি হোল্ড আছে)। | `apps/web/src/app/app/admin/privacy/page.tsx:324` |
| SG-99e565fd | No erasure jobs are failed or blocked. A job parks here only after it exhausts every retry attempt, or while it's waiting on a legal hold to clear. | কোনো স্থায়ীভাবে মুছে ফেলার কাজ ব্যর্থ বা আটকে নেই। একটি কাজ এখানে আসে কেবল সব পুনঃচেষ্টা শেষ হওয়ার পর, অথবা আইনি হোল্ড ওঠার অপেক্ষায় থাকার সময়। | `apps/web/src/app/app/admin/privacy/page.tsx:280` |
| SG-be1f817d | No older active holds. | এর চেয়ে পুরোনো কোনো চালু হোল্ড নেই। | `apps/web/src/app/app/admin/privacy/page.tsx:205` |
| SG-e664b45f | No retention policies configured. Without a policy, documents of a type are never auto-purged. | কোনো রেখে দেওয়ার নীতি ঠিক করা নেই। নীতি না থাকলে সেই ধরনের ডকুমেন্ট কখনো স্বয়ংক্রিয়ভাবে মুছে ফেলা হয় না। | `apps/web/src/app/app/admin/privacy/page.tsx:181` |
| SG-1bd94eaa | no review date set | পর্যালোচনার তারিখ ঠিক করা নেই | `apps/web/src/app/app/admin/privacy/page.tsx:227` |
| SG-0fdec215 | Not available until the removal tables are in place | সরানোর টেবিলগুলো তৈরি না হওয়া পর্যন্ত পাওয়া যাবে না | `apps/web/src/app/app/admin/lifecycle-measures.tsx:58` |
| SG-cf0aeeba | Platform Privacy | প্ল্যাটফর্মের গোপনীয়তা | `apps/web/src/app/app/admin/privacy/page.tsx:63` |
| SG-7c49c467 | Privacy Sections | গোপনীয়তার অংশগুলো | `apps/web/src/app/app/admin/privacy/page.tsx:160` |
| SG-daf842c9 | Removal Requests: Median Time to a Decision | সরানোর অনুরোধ: সিদ্ধান্তে পৌঁছাতে মধ্যমা সময় | `apps/web/src/app/app/admin/lifecycle-measures.tsx:43` |
| SG-1eb5a04c | Restores After Archive or Delete, Last 30 Days | আর্কাইভ বা মুছে ফেলার পর ফিরিয়ে আনা, গত ৩০ দিন | `apps/web/src/app/app/admin/lifecycle-measures.tsx:33` |
| SG-cefa1109 | Retention | রেখে দেওয়ার মেয়াদ | `apps/web/src/app/app/admin/privacy/page.tsx:177` |
| SG-ab2d4c94 | Retention policies, legal holds, erasure and purge. | রেখে দেওয়ার নীতি, আইনি হোল্ড, স্থায়ীভাবে মুছে ফেলা ও মেয়াদ শেষে মুছে ফেলা। | `apps/web/src/app/app/admin/privacy/page.tsx:148` |
| SG-ff268a2a | Retention Purge | মেয়াদ শেষে মুছে ফেলা | `apps/web/src/app/app/admin/privacy/page.tsx:37` |
| SG-5269d120 | review overdue since {formatDateOnly} | {formatDateOnly} থেকে পর্যালোচনার সময় পেরিয়ে গেছে | `apps/web/src/app/app/admin/privacy/page.tsx:229` |
| SG-c4e14550 | These are the oldest active holds. | এগুলো সবচেয়ে পুরোনো চালু হোল্ড। | `apps/web/src/app/app/admin/privacy/page.tsx:258` |
| SG-c0304a62 | These figures are counted over people&apos;s records, so they show only to staff with the Compliance Admin role. | এই হিসাব মানুষের রেকর্ড থেকে গোনা হয়, তাই শুধু কমপ্লায়েন্স অ্যাডমিন ভূমিকার স্টাফরাই এগুলো দেখতে পান। | `apps/web/src/app/app/admin/lifecycle-measures.tsx:86` |
| SG-ba9fc0d8 | These figures could not be read just now. No trend is inferred. | এই মুহূর্তে এই হিসাবগুলো পড়া যায়নি। কোনো প্রবণতা অনুমান করা হয়নি। | `apps/web/src/app/app/admin/lifecycle-measures.tsx:90` |
| SG-9ac5ee1f | Too Early to Say | বলার সময় এখনো হয়নি | `apps/web/src/app/app/admin/lifecycle-measures.tsx:69` |
| SG-00c793d5 | A legal hold covers this document, so it cannot be removed. Decline the request with the legal requirement reason. | এই ডকুমেন্টে আইনি হোল্ড আছে, তাই এটি সরানো যাবে না। আইনি বাধ্যবাধকতার কারণ দেখিয়ে অনুরোধটি প্রত্যাখ্যান করুন। | `apps/web/src/app/app/admin/removals/page.tsx:118` |
| SG-176c4fc1 | Choose an applicant from the list. | তালিকা থেকে একজন আবেদনকারী বেছে নিন। | `apps/web/src/app/app/admin/privacy/applicant-picker.tsx:13` |
| SG-993ccbc5 | Legal Requirement | আইনি বাধ্যবাধকতা | `apps/web/src/app/app/admin/removals/labels.ts:14` |
| SG-d70ff269 | Privacy | গোপনীয়তা | `apps/web/src/app/app/admin/removals/page.tsx:81` |
| SG-dcb82ad2 | Privacy Concern | গোপনীয়তা নিয়ে উদ্বেগ | `apps/web/src/app/app/admin/removals/labels.ts:8` |
| SG-921890d8 | The search did not work. Try again. | খোঁজা যায়নি। আবার চেষ্টা করুন। | `apps/web/src/app/app/admin/privacy/applicant-picker.tsx:128` |
| SG-1594e40c | Queue {eligibleCount} document(s) past retention for deletion? This cannot be undone once the files are confirmed deleted. | রেখে দেওয়ার মেয়াদ পার হওয়া {eligibleCount}টি ডকুমেন্ট মুছে ফেলার সারিতে রাখবেন? ডকুমেন্টগুলো মুছে ফেলা নিশ্চিত হওয়ার পর এটি আর ফিরিয়ে আনা যাবে না। | `apps/web/src/app/app/admin/purge-button.tsx:18` |
| SG-4c712b71 | Release this legal hold? Deletion/purge become possible again. | এই আইনি হোল্ড তুলে নেবেন? তাহলে মুছে ফেলা/মেয়াদ শেষে মুছে ফেলা আবার সম্ভব হবে। | `apps/web/src/app/app/admin/action-buttons.tsx:26` |
| SG-801eeb66 | By turning this on, {agencyName} confirms it has a lawful basis and a written agreement with each AI provider it connects, will use it only for travellers’ cases, and is responsible for that provider’s processing. VisaStack checks every request against each traveller’s permission and keeps a record. | এটি চালু করে {agencyName} নিশ্চিত করছে যে, যুক্ত করা প্রতিটি এআই সরবরাহকারীর ক্ষেত্রে তার আইনগত ভিত্তি ও লিখিত চুক্তি আছে, এটি শুধু ভ্রমণকারীদের ভিসা ফাইলের জন্য ব্যবহার করবে, এবং সেই সরবরাহকারীর প্রক্রিয়াকরণের দায় তার। VisaStack প্রতিটি অনুরোধ প্রত্যেক ভ্রমণকারীর অনুমতির সঙ্গে মিলিয়ে দেখে এবং একটি রেকর্ড রাখে। | `apps/web/src/lib/agency-ai.ts:31` |
| SG-7f2b9962 | Child Travel Consent | শিশুর ভ্রমণ সম্মতি | `packages/core/src/catalogue/request-synonyms.ts:121` |
| SG-68450ced | Consent for Child | শিশুর জন্য সম্মতি | `packages/core/src/catalogue/request-synonyms.ts:121` |
| SG-328af66c | Guardian Consent | অভিভাবকের সম্মতি | `packages/core/src/catalogue/request-synonyms.ts:120` |
| SG-ed18770f | Parents Consent | পিতা-মাতার সম্মতি | `packages/core/src/catalogue/request-synonyms.ts:120` |
| SG-e4b92aa5 | We have to keep this document for now because of a legal requirement, so it cannot be removed. | একটি আইনি বাধ্যবাধকতার কারণে এই ডকুমেন্টটি আপাতত আমাদের রাখতেই হবে, তাই এটি সরানো যাবে না। | `apps/web/src/app/app/applicant/[id]/documents/manage/request/actions.ts:54` |
| SG-25de1b33 | Backup prune failed. Check provider access; nothing outside the retention plan was deleted. | পুরোনো ব্যাকআপ ছেঁটে ফেলা ব্যর্থ হয়েছে। সরবরাহকারীর অ্যাক্সেস দেখে নিন; রেখে দেওয়ার পরিকল্পনার বাইরে কিছুই মুছে ফেলা হয়নি। | `packages/adapters/src/backup-prune.ts:189` |
| SG-ac337b88 | Confirm account consent before joining a trip. | ভ্রমণে যোগ দেওয়ার আগে অ্যাকাউন্টের সম্মতি নিশ্চিত করুন। | `packages/services/src/umpe-trip-companions.ts:790` |
| SG-15b11244 | Core processing consent is required | মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক | `packages/services/src/missions.ts:288` |
| SG-3cce3300 | Core processing consent is required before creating records | রেকর্ড তৈরি করার আগে মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক | `packages/services/src/applicants.ts:154` |
| SG-2ca835a3 | Core processing consent is required. | মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক। | `packages/services/src/jobs.ts:104` |
| SG-6b166e6a | Issuer contact consent is required | ইস্যুকারীর সঙ্গে যোগাযোগের সম্মতি আবশ্যক | `packages/services/src/assurance.ts:401` |
| SG-f49c0f3e | Travel Consent Given | ভ্রমণের সম্মতি দেওয়া হয়েছে | `packages/core/src/catalogue/fields/people.ts:210` |
| SG-ec2d9a5d | This app can read what you choose here. It can also suggest updates, save drafts and add reminders to your cases. Suggested updates change nothing until you accept them. You can turn it off at any time. | আপনি এখানে যা বেছে নেবেন, এই অ্যাপ তা পড়তে পারবে। এটি আপনার ভিসা ফাইলে আপডেটের পরামর্শ দিতে, খসড়া সংরক্ষণ করতে এবং রিমাইন্ডার যোগ করতেও পারবে। আপনি গ্রহণ না করা পর্যন্ত পরামর্শ দেওয়া আপডেটে কিছুই বদলায় না। আপনি যেকোনো সময় এটি বন্ধ করতে পারেন। | `apps/web/src/lib/ai-consent-labels.ts:105` |
| SG-326bb71b | This app can read what you choose here. It cannot change anything in VisaStack. You can turn it off at any time. | আপনি এখানে যা বেছে নেবেন, এই অ্যাপ তা পড়তে পারবে। এটি VisaStack-এ কিছুই বদলাতে পারে না। আপনি যেকোনো সময় এটি বন্ধ করতে পারেন। | `apps/web/src/lib/ai-consent-labels.ts:106` |
| SG-f3184404 | Core processing consent is required | মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক | `packages/services/src/documents.ts:150` |
| SG-c0641c84 | Core processing consent is required to change a profile | প্রোফাইল বদলাতে মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক | `packages/services/src/profile-sections.ts:108` |
| SG-beb70611 | Core processing consent is required to edit facts | তথ্য সম্পাদনা করতে মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক | `packages/services/src/lifecycle/profile/profile-lifecycle.ts:84` |
| SG-ab296de7 | We have to keep this file for now because of a legal requirement, so it cannot be deleted. | একটি আইনি বাধ্যবাধকতার কারণে এই ডকুমেন্টটি আপাতত আমাদের রাখতেই হবে, তাই এটি মুছে ফেলা যাবে না। | `apps/web/src/app/app/applicant/[id]/documents/manage/self-delete/actions.ts:84` |
| SG-499541f7 | That could not be undone. Try again. | এটি ফিরিয়ে আনা যায়নি। আবার চেষ্টা করুন। | `apps/web/src/components/lifecycle/undo-status.tsx:17` |
| SG-623185df | The configured private storage service | কনফিগার করা ব্যক্তিগত স্টোরেজ সেবা | `apps/web/src/app/privacy/page.tsx:18` |
| SG-782dd356 | Under {target} per 100 | প্রতি ১০০-তে {target}-এর কম | `apps/web/src/app/app/admin/lifecycle-measures.tsx:28` |
| SG-b74bd8e8 | A legal hold covers this document, so it cannot be removed. Decline the request with the reason Legal Requirement. | এই ডকুমেন্টে আইনি হোল্ড আছে, তাই এটি সরানো যাবে না। “আইনি বাধ্যবাধকতা” কারণ দিয়ে অনুরোধটি প্রত্যাখ্যান করুন। | `apps/web/src/app/app/admin/removals/actions.ts:28` |
| SG-1c15133b | No applicants match. Try another part of the name. | কোনো আবেদনকারী মেলেনি। নামের অন্য কোনো অংশ দিয়ে চেষ্টা করুন। | `apps/web/src/app/app/admin/privacy/applicant-picker.tsx:26` |
| SG-21398676 | Type at least {PICKER_MIN_CHARS} letters. | অন্তত {PICKER_MIN_CHARS}টি অক্ষর লিখুন। | `apps/web/src/app/app/admin/privacy/applicant-picker.tsx:35` |
| SG-4b142b86 | Type part of a name, or paste an applicant ID. | নামের একটি অংশ লিখুন, অথবা একটি আবেদনকারী আইডি পেস্ট করুন। | `apps/web/src/app/app/admin/privacy/applicant-picker.tsx:36` |
| SG-3f2c5577 | Confirm account and sharing consent before accepting. | গ্রহণ করার আগে অ্যাকাউন্ট ও শেয়ার করার সম্মতি নিশ্চিত করুন। | `packages/services/src/sharing-invitations.ts:241` |
| SG-9e20cc6f | Sharing consent is needed to keep sharing. | শেয়ার চালিয়ে যেতে শেয়ার করার সম্মতি দরকার। | `packages/services/src/sharing.ts:669` |
| SG-7cdea515 | Sharing consent is required before creating a grant | অ্যাক্সেস দেওয়ার আগে শেয়ার করার সম্মতি আবশ্যক | `packages/services/src/sharing.ts:211` |
| SG-db11732d | <strong>Deletion is blocked.</strong> The following traveller record {choice} an active legal hold and cannot be deleted until it is released: <ul/> | <strong>মুছে ফেলা আটকে আছে।</strong> নিচের ভ্রমণকারীর রেকর্ডে চালু আইনি হোল্ড আছে, এবং তা তুলে না নেওয়া পর্যন্ত মুছে ফেলা যাবে না: <ul/> | `apps/web/src/app/app/privacy/deletion-panel.tsx:102` |
| SG-a290edf4 | consent.issuerContact.title | (left empty: NEEDS_OWNER_DECISION) | `apps/web/src/app/app/(home)/page.tsx:111` |
