# External penetration test record

Register row H01 in `docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md` names this folder as the place for the result of an external penetration test. This file is that place.

## Status (2026-10-29)

No external penetration test has been run. The owner may defer the readiness gate under H01 (`COMMERCIAL_READINESS_DEFER_EXTERNAL_PENETRATION_TEST=H01`, owner action O17) until a trigger in the H01 row arrives. While no result is recorded below, do not set `COMMERCIAL_READINESS_ATTEST_EXTERNAL_PENTEST`.

## What a completed test must record here

Add a dated section per test, append-only:

- Date of the test and of the report, and the tester (company, not individual names unless they agree).
- Scope: the web app, the API and the AI connector, the deployed commit tested and the environment (never production data).
- Every finding with its severity and its status: fixed (with the fixing pull request and the retest date) or accepted (with the owner's written reason).
- The retest result. The attestation may be set only when no Critical or High finding is open after the retest.

The full report itself stays outside the repository if it contains exploit detail; record here where it is kept and who may read it.
