# Delivery Process

Remote-first delivery through GitHub and Vercel. CI is the authority.

## Flow

1. Branch from `main` (`claude/<topic>` or `feat/<topic>`).
2. Open a **draft PR** early. The PR links the PRD clause / Build Spec
   section it implements.
3. Push commits; CI runs lint → build → typecheck → test, plus CodeQL and
   dependency review. Vercel builds a **preview deployment** per PR.
4. Mark **ready for review** when CI is green and acceptance criteria are
   met.
5. Code-owner review; resolve conversations; squash-merge to `main`.
6. Vercel promotes `main` to production per the production baseline.

## Environments

| Environment | Trigger | Data |
|-------------|---------|------|
| Preview | every PR | synthetic only — **no production data** |
| Production | merge to `main` | live |

## Secrets & configuration

- Keys live in **Vercel project environment variables** and provider
  dashboards — never in the repository. `.env.example` documents the
  *names* only.
- Rotation and KMS envelope encryption are handled per ADR-0007.

## Definition of Done

- [ ] Satisfies the linked PRD clause and Build Spec section.
- [ ] Acceptance tests written and passing.
- [ ] CI green (lint, build, typecheck, test, CodeQL, dependency review).
- [ ] No secrets or production data introduced.
- [ ] ADRs/docs updated when decisions or behavior changed.
- [ ] Preview deployment verified.
