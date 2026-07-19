# Threat Model (skeleton)

Authority: Build Spec §14, §19; PRD §14, §17. This is the living threat
model required as a Foundation-phase deliverable. It is completed and
**approved before public launch** (release gate, Build Spec §19).

> Status: skeleton — to be expanded to a full STRIDE/data-flow analysis with
> a security control matrix during the Foundation phase.

## Assets (most sensitive first)

Applicant identity documents & bytes · biometric/MRZ data · financial
statements · medical-travel data · profile facts & history · access grants ·
audit log · auth credentials/sessions · AI prompts/outputs · secrets/keys.

## Trust boundaries

Browser ↔ server · server ↔ Neon · server ↔ S3 (quarantine vs clean) ·
server ↔ SQS/workers · server ↔ AI Gateway ↔ OpenAI · app ↔ WorkOS ·
tenant ↔ tenant.

## Primary threats & required controls

| Threat | Control (spec) |
|--------|----------------|
| Cross-tenant access/discovery | Default-deny policy engine; service-layer row/object authz; isolation tests (100% gate) |
| Malicious upload (malware, macro, archive bomb, spoofed MIME) | Quarantine bucket; magic-byte + MIME/ext checks; malware/active-content scan; CDR; isolated conversion |
| Data exfiltration via links | No permanent public URLs; short-lived operation-specific signed URLs; `Cache-Control: no-store` |
| Privilege escalation / agency self-upgrade | Platform-approval gate; membership ≠ resource access; step-up for sensitive actions |
| Session/credential compromise | One identity/session system; passkeys; MFA for agency/staff; session revoke-all; step-up |
| Audit tampering / silent mutation | Append-only tamper-evident audit; restricted ops fail closed; atomic approval transaction |
| Secret leakage | Managed vault + rotation; KMS envelope encryption; no secrets in URLs/logs/analytics |
| Sensitive data at rest in client | No sensitive localStorage/IndexedDB/service-worker cache; no sensitive email attachments |
| Prod data in non-prod | Synthetic/sanitized preview & dev only; never copy production data |

## Verification (Build Spec §19)

Independent penetration test with **no unresolved Critical/High**;
dependency/SAST/IaC/secret/license scans in CI; tenant-isolation, permission
matrix, upload-security, revocation, and snapshot-regression tests;
threat model formally approved.
