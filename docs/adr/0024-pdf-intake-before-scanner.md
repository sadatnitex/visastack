# ADR-0024: PDF intake before the virus scanner is switched on

- **Status:** Accepted (owner decision, 31 Oct 2026)
- **Date:** 2026-10-31
- **Deciders:** Owner. Words: "pdf should be also configured 100% correctly without scanner, we will deploy scanner later, disregard the risks with it, as we already give disclaimer."
- **PRD/Spec link:** ADR 0011 (built-in checks are not antivirus), ADR 0012 (conservative PDF handling), ADR 0019 (automatic document reading), `docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md` H29

## Context

- The built-in checker rejected every PDF on purpose, because no hand-written parser can show a PDF is safe (ADR 0012). PDFs were therefore accepted only when a real scanner was configured, and production has none yet.
- The public pages already say that protections such as virus scanning of uploads are not switched on yet (home, sign-up, terms, privacy, status).

## Decision

1. The built-in checker admits a PDF that has a genuine PDF signature, is within the size limit and is not a disguised executable. It does this only when the caller asks (`allowPdf`); the checker's own default is unchanged and still refuses PDFs.
2. Only the applicant document intake job asks for it. Payment proofs, agency invoices and photos do not, so a PDF is still refused there. The scan record for an admitted file reads "pdf (structural check only; content unverified)". The record's yes/no field still says "safe"; the wording is the only marker, which is an accepted limit of this decision.
3. The upload form, upload route and upload action ask one question (`pdfUploadsAccepted`). It is yes for the built-in checks, `clamav` and `github_clamav`, and no for an unrecognised provider name.
4. `PDF_UPLOADS=off` (also `false`, `0` or `no`, any case) is the owner's switch to stop PDF uploads without a code change. One reading of it serves the form, the routes and the scanner.
5. When a real scanner is switched on, nothing here changes how it works: its verdict replaces the structural one.
6. The "real malware scanner" readiness gate becomes deferrable under register entry H29, the second and last deferrable gate (the first is H01). It counts only when `COMMERCIAL_READINESS_DEFER_REAL_MALWARE_SCANNER=H29` is set exactly, and it is shown as "Deferred by Owner (H29)".

## Consequences

- PDFs work for everyone now. Their content has not been checked for viruses or active content.
- The disclaimer stays on every public page until a real scanner is live.
- Removing the deferral later is one environment change and no code change.
- Real-data readiness still needs every other operational gate. This ADR only removes the scanner from that list.
