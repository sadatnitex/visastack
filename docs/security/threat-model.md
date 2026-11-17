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


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.

## Passkeys and sign-in links (Q8, 17 Nov 2026)

Appended; earlier sections are unchanged. Decision record: `docs/adr/0028-passkeys-and-sign-in-links.md`.

| Threat | Control |
|---|---|
| A passkey used to get into an account | A passkey never signs anyone in. It only records that the current sign-in (hash of the Neon session id) was confirmed. |
| A stolen sign-in adds its own passkey | Adding or removing a passkey needs the password typed in the last five minutes. |
| A passkey confirmation reused later or elsewhere | Bound to the session hash, so a new sign-in finds nothing; counts for five minutes only. The challenge cookie (one per purpose) is signed, two minutes long, bound to account and sign-in, and cleared when read. The database refuses the same challenge twice, a challenge older than the passkey's last use, and a counter that goes backwards. |
| A passkey weakens staff protection | Staff (platform role or organization membership) are excluded: password plus authenticator code, unchanged. |
| A passkey stretches a session | The absolute 7-day and 12-hour limits never read passkeys. |
| Guessing with passkey attempts | Own per-account limit (`PASSKEY_CONFIRM`); failed password floods cannot block it. |
| The sign-in link form shows who has an account | Same steps, same Neon call and same answer for every valid address; no account lookup. |
| Sign-in links used to flood an inbox | Email sending limits per address and per network address, refused if the counter cannot be read. |
| A sign-in link skips invitation or agreement | The link lands on `/auth/link-return`, then `/auth/notice-check`, the same checks as a new Google sign-in. |
| Someone sends their own sign-in link to a victim (login CSRF) | Only a browser holding the signed "link pending" cookie set when it asked can finish; any other link sign-in is ended at once. |
| A link used to get a staff sign-in | The landing ends any staff link sign-in and asks for the password; the re-check page never offers staff a link. |
| Personal data in logs | Audit rows hold kinds and counts only; no credential id, key, address or session hash. Link failures log status codes only. |

