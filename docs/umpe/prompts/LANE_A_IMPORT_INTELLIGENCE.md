# Lane A: universal document intake and self-building records (P2/P3)

You are an independent implementation worker. Branch/worktree `umpe/p2-import` then `umpe/p3-document-intelligence` unless the lead explicitly reorganizes. Do not own shared schema or global navigation. Read `docs/umpe/00_START_HERE.md`, L2 source contract §B and H1-H5, audit IDs `I01-I16` plus no-loss `F02-F04`, and relevant `operations/INTERFACE_FREEZE.md`. Inspect actual uploader, upload-client, storage, intake, AI-reading, profile suggestions, duplicate/lifecycle, files and tests at assigned base SHA.

## Deliverables

**P2 intake**: One prominent action to import a file, a set of files, or a folder/nested folder without first identifying document type; browser-compatible file/folder fallback. A genuinely bounded queue handles 80+ file input safely without losing item 21, with per-file uploaded/safe-processing/unknown/refused status, progress, retry, resume when feasible, backpressure and timeouts. Preserve existing 4MB/plan limits or safely extend only with separately tested size/storage strategy; don't bypass scanner/quarantine or invent support for unsupported PDFs. Idempotent upload confirmation distinguishes network unknown from duplicate. Batch import can be initiated without a complete personal profile or case.

**P3 understanding**: Reuse deterministic OCR/MRZ/classification first and consented controlled AI second where needed. Automatic source-backed suggested title/type, exact-duplicate vs corrected-scan vs new-period vs renewed document distinction, dates/expiry/missing-page quality flags. A folder can contain several people: unknown owner remains protected as unassigned, with a *single clear prompt* to choose person. Do not register a document into someone's account until attribution is sufficiently established. Proposed fact values remain source-observed, awaiting actual existing confirmation policy, and material conflicts go into exception-only review; no full-profile form required. Standard/manual upload and approve paths remain.

## Work boundaries

Create a small import orchestrator/queue layer over existing document services. Do not fork `documents`, `facts`, AI provider or scanner logic. Any new staging/batch schema is proposed to schema captain and migrated in **its** serialized slot. Prefer namespaced components and tests. Existing uploader and central services are modified only with an exclusive lease from lead. No folder traversal in a server environment from untrusted path strings. Handle path normalization, filename escaping, zip/archive bombs if archives supported, MIME and content checks, item quotas, and stop/pause semantics. Do not use production files in fixtures. Keep protected-document AI consent and actual provider-cost budget.

## Proof fixtures

Synthetic collection of **80+ files**, 3 family members, duplicate byte-identical scans, old/new passport (distinct document identity), one corrected scan (new exact version), consecutive monthly bank statements (distinct periods), employment update, unreadable PDF, unsupported format, false MIME, oversized file, one network timeout, a revoked consent and an ambiguous owner. Assert every input ends in an honest state, no wrong-owner attachment, no uncontrolled AI call, no incorrect overwrite, no lost file after resume. Test mobile file selection, folder fallback and keyboard UX. Report average and p95 processing time and controlled per-document resource consumption on measured fixtures, not invented budgets.

## Completion contract

PR1: robust import with tests. PR2: interpretation and person/proposal mapping with tests. Give lead exact exported interfaces needed by P4/P9 and a `PR_HANDOFF_TEMPLATE.md` report. Do not spend time redesigning unrelated dashboards. Wait for upstream contract only on type/migration decisions; use independent UI/tests while waiting.
