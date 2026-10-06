# Security Policy

VisaStack processes sensitive personal and immigration data. Security is a
release gate, not a feature — see the PRD's benchmark thresholds, the
"no silent mutation" gate, and the external penetration-test release gate.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**. Do not open a public
issue for security matters.

- Email: security contact to be published before first production release.
- Use GitHub's private vulnerability reporting (Security → Report a
  vulnerability) once enabled on the repository.

We aim to acknowledge reports within 72 hours.

## Handling principles (enforced across the codebase)

- **Least privilege & fail-closed.** Permission checks deny by default;
  restricted actions are audited even when denied.
- **No production data in test or preview environments.**
- **Encryption in transit and at rest**, with KMS-managed keys and secret
  rotation.
- **No sensitive data in browser/PWA caches or email attachments.**
- **No silent mutation.** Every record change flows through an explicit,
  versioned, atomically-approved proposal.

## Automated controls

- Checks that run on every pull request and weekly, including on this private repository:
  production dependency audit, secret scan (files and full git history), licence scan,
  rule-based static analysis, browser bundle check, prompt check, test fixture check and
  preview credential check. Each reports executed, passed, failed and skipped; see
  `docs/security/supply-chain.md`.
- CodeQL static analysis (`.github/workflows/codeql.yml`) and dependency review
  (`.github/workflows/dependency-review.yml`) run only when the repository is public, so they
  are skipped on the private repository and are not counted as evidence.
- GitHub secret scanning and push protection apply only if enabled in repository settings; this is
  not verified from code.
- Branch protection with required reviews and status checks
  (`docs/governance/branch-protection.md`).
