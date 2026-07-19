# Acceptance Criteria (Release Gates)

Verbatim-faithful to Build Spec §19 and PRD §17. A feature is complete only
when it satisfies the PRD, the Build Spec, **and** these tests. Each item is
a check that must be automatable and enforced in CI where possible.

## Absolute (must be 100% / 0)

- [ ] 100% of profile mutations and approved name changes require authorized
  approval or explicit manual edit.
- [ ] 100% of cross-tenant attempts are denied and logged with no data
  leakage.
- [ ] 100% of preview/download/export actions require effective action
  permission at request time.
- [ ] 100% of application snapshots retain exact historic versions.
- [ ] 0 permanent public document URLs.
- [ ] 0 sensitive auth tokens / profile / document data in localStorage,
  service-worker cache, or analytics.

## AI / document benchmark (on the approved launch dataset)

- [ ] Document-type accuracy ≥ 95%.
- [ ] Precision ≥ 95% for launch-critical identity/date fields on clean
  supported documents.
- [ ] Proposed filename accepted without edit ≥ 90%.
- [ ] All low-confidence, conflicting, and restricted items are
  review-required.
- [ ] No unsupported field ID can be persisted.
- [ ] No unapproved data mutation.

## Security / reliability

- [ ] Tenant-isolation and permission-matrix tests pass.
- [ ] Upload-security tests pass: spoofed MIME, malware fixture,
  macro/active PDF, corrupt/password file, oversized image, duplicate retry,
  archive bomb.
- [ ] Independent penetration test: no unresolved Critical/High.
- [ ] Backup restore + incident tabletop pass.
- [ ] Account export/deletion passes.
- [ ] Accessibility (WCAG 2.2 AA) and English/Bangla critical paths pass.
- [ ] No production deployment if migration/rollback or smoke tests fail.

## Non-functional targets (Build Spec §16 / PRD §15)

- [ ] 99.9% monthly availability for the authenticated core.
- [ ] p95 interactive API < 800 ms (excluding file/AI jobs).
- [ ] Processing state visible within 2 s.
- [ ] Typical clean ≤10-page document processed within 90 s p95.
- [ ] RPO ≤ 15 min, RTO ≤ 4 h; restore drill before launch and quarterly.
