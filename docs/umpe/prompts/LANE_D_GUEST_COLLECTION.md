# Lane D: authenticated-by-request guest collection without account (P8/P9)

You start after agency issuance interface from P6 is frozen and after storage/import processing adapters from P2/P3 are available. While waiting, work read-only on threat model, fixtures and branded page component. Read L4 §3, §6-9 and acceptance A06, A09-A18, plus audit rows `A08`, `A11-A16`, `A20`; read `operations/INTERFACE_FREEZE.md`.

## P8 guest identity and branded desk

- Agency-customized, polished, responsive document collection page using the canonical agency brand helper (approved name/logo/accessibility-tested accent) and a restrained `Powered by VisaStack` mark. No generic AI-art gradients or unverified accreditation marks. Public preview is neutral and does **not** show sensitive route, name, files, checklist, previous draft or account-existence hint.
- Guest chooses continue without an account. Require request-bound recipient proof (verified email code using existing notification adapter if supported, or separately validated approved mechanism), short-lived rotating and revocable session, anti-guessing and rate-limit controls, CSRF, cookie/domain protections, no token leakage through referrer/analytics/logs, bounded link TTL. A WhatsApp-forwarded URL by itself is **not** identity. Do not invent SMS/WhatsApp outbound OTP service.
- Resume after browser exit using re-verification; allow multiple upload attempts. Guest has no permanent account/master-profile/timeline. Agency retains only lawful bounded request records and explicit receipt/retention with deletion. Guest account creation later requires independent consent to move material, not a silent email match.

## P9 request-scoped uploads and agency review

- Reuse exact approved scanner/storage/AI processing code through minimal request-scoped adapters; do **not** create a fake `applicantId` to satisfy existing document FK. Guest uploads may be 80+ mixed files in chunks, folders where browser supports, with accurate file statuses and retries and a scoped unassigned/ambiguous section.
- Match each safely processed file to exact issued requirement version; auto-propose category/person/period but ask guest to correct uncertainty. Guest can add/remove/replace, view mandatory vs recommended vs agency extras and explicit 'still missing'. Do not claim original files scanned by unconfigured malware service. Protected AI use needs explicit guest choices and safe controls.
- Explicit submit freezes selected **exact file versions**, acknowledgements, request revision and consent scope into an immutable agency-visible receipt. Agency can review, accept, request correction/replacement; a later guest revision doesn't rewrite previous reviewed receipt. Guest can reopen within authorized time, retry and resubmit. Request revocation/expiry blocks new access but follows defined lawful retention for prior agency receipt.

## Adversarial acceptance

Guest submits without row in `accounts` or `applicants`; different guest or org cannot inspect it. Forwarded WhatsApp link cannot reveal draft; invalid/replayed proof denied. Guest returns from another device with fresh verification. 80 files processed/reconciled with bad PDF and mixed person, no missing 21st upload, no improper AI calls. Agency review pinned version not newest arbitrary file; correction history preserved. Revoked link disallows new upload, receipt bounded and lawful purge works. Cross-tenant and request-scope tests must pass with real PGlite migration setup.

## Boundaries

Single schema writer; do not edit existing person/mission/permission engine without a reviewed adapter and lease. Hard-stop for unresolved legitimate identity proof or retention terms affecting real users, but continue independent synthetic-code testing. Two PRs P8/P9; security review is compulsory prior to merge.
