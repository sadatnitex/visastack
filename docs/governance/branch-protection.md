# Branch Protection & Repository Settings

`main` is protected and always deployable. These settings are applied in
the GitHub repository (Settings → Branches / Code security). This document
is the source of truth for what they should be.

## Required on `main`

- **Require a pull request before merging** — no direct pushes.
- **Require approvals:** at least 1 (via CODEOWNERS).
- **Require review from Code Owners.**
- **Dismiss stale approvals** when new commits are pushed.
- **Require status checks to pass before merging:**
  - `CI / Lint · Build · Typecheck · Test`
  - `CodeQL`
  - `Dependency Review`
- **Require branches to be up to date before merging.**
- **Require conversation resolution before merging.**
- **Require linear history** (squash or rebase merges only).
- **Do not allow force pushes or deletions.**

## Code security (Settings → Code security and analysis)

- **Secret scanning:** enabled, with **push protection**.
- **Dependabot alerts + security updates:** enabled.
- **CodeQL:** default or the workflow in `.github/workflows/codeql.yml`.
- **Private vulnerability reporting:** enabled (see `SECURITY.md`).

## Merge strategy

- Squash merge preferred to keep `main` history linear and readable.
- PR titles follow conventional style (`feat:`, `fix:`, `docs:`, `chore:`).

> Note: these are repository-admin settings, not code. They must be set in
> the GitHub UI/API by a repository administrator; this file records the
> intended configuration so drift is reviewable.
