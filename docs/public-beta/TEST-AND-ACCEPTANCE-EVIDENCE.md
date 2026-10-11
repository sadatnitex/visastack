# Test and acceptance evidence

Frozen baseline: `698442a4124fce7f966aca2bee38b9f0e16bbd98`. Evidence below is scoped to this cloud task; production deployment and candidate CI are not inspected.

| Check | Environment / result |
| --- | --- |
| Prepared baseline suite | Same frozen source; 2844 passed, 3 live-service skips during onboarding |
| Live pooled regression | Bound preview database, read-only; 5/5 passed with cloud proxy initializer |
| Read-only public catalog diagnostic | 1/1 passed through the unbundled pooled driver; no route records printed |
| Migration 0084 | Bound database journal hash and accounts.neon_user_id confirmed read-only; no migration run |
| New auth-shell regression before fix | Local synthetic sessions; all 6 tests failed against old code |
| Focused auth-shell, identity and Neon session after fix | Local synthetic sessions; 14/14 passed |
| Current lint / build / typecheck | Passed on this patch |
| Production dependency audit | Passed high-severity gate; 4 moderate advisories remain |
| Current complete workspace unit suite | 2851 passed, 2 skipped; all 175 test files passed. The two existing real-clamd adapter checks lacked a live socket; no assertions were disabled |
| Built application HTTP checks | 7/7 passed: public/sign-in/sign-up, unsigned protected redirects, readiness 200 |
| Existing Playwright HTTP security-header checks | 11/11 passed against the local production build, including fresh nonces and inline-script nonce matching; no browser launched |
| Browser public accessibility / enforced CSP | BLOCKED: no installed Chromium; cdn.playwright.dev download returned proxy 403 |
| GitHub exact-head CI / open PRs | BLOCKED by GitHub API proxy 403; native Git fetch is usable |
| Production deployment/readiness | BLOCKED by public production endpoint proxy 403 |

Acceptance matrix: `NOT_EXECUTED` means the whole user-interface journey was not run in an isolated authenticated environment, even where service tests exist. Required fixture set: Traveller A/B, Agency A owner/manager, Agency B owner, authorized contributor, administrator, unauthorized visitor, synthetic documents and consenting inboxes. Each executed row must later record exact source/environment, fixture, preconditions, positive and negative expectations, actual result and artifact.

| Journey | Required behavior | Current complete-journey result |
| --- | --- | --- |
| J01 | Register, confirm and sign in | NOT_EXECUTED |
| J02 | Secure existing-account recovery/linking | NOT_EXECUTED |
| J03 | Logout, reset, stale session and recovery | NOT_EXECUTED |
| J04 | Versioned reusable profile | NOT_EXECUTED |
| J05 | Safe document intake | NOT_EXECUTED |
| J06 | Unsafe document quarantine | NOT_EXECUTED |
| J07 | Authorized preview/download | NOT_EXECUTED |
| J08 | Complimentary agency workspace | NOT_EXECUTED |
| J09 | Accepted client invitation and access | NOT_EXECUTED |
| J10 | Evidence request and response | NOT_EXECUTED |
| J11 | Review resolution | NOT_EXECUTED |
| J12 | Maintained or manual-route mission | NOT_EXECUTED |
| J13 | Explainable mission completeness | NOT_EXECUTED |
| J14 | Exact-version acknowledgement | NOT_EXECUTED |
| J15 | Immediate grant revocation | NOT_EXECUTED |
| J16 | Cross-tenant isolation | NOT_EXECUTED |
| J17 | Delivery/retry/failure | NOT_EXECUTED |
| J18 | Consent-based AI and human approval | NOT_EXECUTED |
| J19 | Export/deletion with legal holds | NOT_EXECUTED |
| J20 | Consistent backup/restore | NOT_EXECUTED |
| J21 | Privileged assurance | NOT_EXECUTED |
| J22 | Safe full-feature complimentary use | NOT_EXECUTED |
| J23 | Usability during AI outage | NOT_EXECUTED |
| J24 | Measured capacity and cost alerts | NOT_EXECUTED |
| J25 | Future plan without identity replacement | NOT_EXECUTED |

J03 has targeted dispatch/navigation/denial regression coverage in this patch, but real session revocation/reset/renewal acceptance remains unexecuted. Readiness 200 and an empty unauthenticated Auth session response do not complete J01 or J03. No credentials, actual recipient identities or customer records are included in evidence.


The first custom HTTP harness incorrectly expected relative redirect locations and an unsigned-in denial page. Middleware correctly returned absolute Neon sign-in redirects, including denial-page protection. The corrected expectations match the existing selected-provider route contract; no guard was weakened. The final seven checks passed. Authenticated denial rendering is covered by synthetic regression tests only.

Local evidence artifacts are ignored under /workspace/.cloud-tools: beta-lint.log, beta-build.log, beta-typecheck.log, beta-audit.log, beta-tests.log, beta-verification-summary.txt, beta-http-checks.json, beta-security-headers.log and beta-browser-install.log. They are local execution evidence, not durable deployment or exact-head CI proof.

During the HTTP security-header run, /trust returned its existing safe unavailable page and logged a sanitized catalog-query failure. Header checks passed, but catalog availability did not. The root cause is not established. Readiness and the unbundled pooled transaction regression are narrower checks and do not prove every database-backed page in the Next build works. Investigate the built application's pooled connection before authenticated acceptance.

Follow-up diagnosis: the actual listPublicTrustPublished service query passed through the configured unbundled pooled driver inside SET TRANSACTION READ ONLY (1/1). Generated Next server chunks contain bundled webSocketConstructor implementations rather than an external @neondatabase/serverless require. The failure is narrowed to the built-application path; the preload config may not reach its bundled driver instance. This is a hypothesis pending built-route validation, not proof of production catalog failure. No unsupported bundle patch or network bypass was applied. Artifacts: trust-live.log and trust-live-result.json outside the checkout.

Final local verification summary: lint=0 build=0 typecheck=0 audit=0 tests=0. Commands: pnpm run lint; pnpm run build; pnpm run typecheck; pnpm audit --prod --audit-level high; pnpm -r --workspace-concurrency=2 run test --maxWorkers=2. This verifies the local patch, not exact-head remote CI or deployed behavior. Contract and adversarial reviews completed; current source and new documentation additions contain no forbidden em-dash characters.

2026-10-10 continuation against reconciled main ecced6a: current local lint, build, typecheck and high-severity audit passed; 1107 web tests and 5 pooled-driver tests passed. Sixteen explicit Node checks passed, including positive/negative synthetic smoke deployments and the URL guard's unsafe-mutation failure proof. Public HTTP header checks passed 11/11, current local smoke passed 11/11 and the built catalog's real heading was verified. The pre-catalog-check smoke script passed 10/10 against actual canonical production; that is read-only existing-production evidence, not deployment of this candidate. Two initial harness failures were corrected and rerun: Node test discovery and the local 127.0.0.1 versus localhost origin mismatch. The service/adapter/domain sources are unchanged by this continuation; earlier full-suite evidence is historical and current exact-head remote CI is still required. Local browser execution remains blocked by Chromium's Google-storage redirect; no passing browser run is claimed. J01-J25 complete authenticated acceptance remains NOT_EXECUTED.


## 2026-10-11 continuation: source guards, provider truth and recovery

The PR-07/08 working implementation passed 47 pack-service tests, including source completeness, source repair/audit, frozen approved records, stale publication and custom manual behavior. Actual removals of official approval, publication, draft freeze and measured-reading guards were rejected. Action permission/date and founder unavailable-reading tests passed during development. Full final workspace verification and immutable source CI remain required.

The current production build passed 192 browser checks and deployment smoke. A local public liveness-only probe completed 100 requests at concurrency four with no errors, median 4.59 ms and p95 11.02 ms. This is a small local diagnostic with no applicant, document, database, AI or email workload, not a production capacity or release-performance result. The broader authenticated staging journeys remain unexecuted.

Actions run 38128672220 passed the actual authenticated R2 download and isolated database restore on c18bbda2f905105fce269a72b7fc6717d9be837b. This is J20 database-only evidence, not completion of J20's consistent files/keys/audit/tombstone/revocation recovery. PR 191 existing-account guidance passed on its exact deployed revision; it does not complete every J01-J03 journey. No acceptance matrix row is silently upgraded by these narrower results.
