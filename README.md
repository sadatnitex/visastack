# VisaStack

Universal, pack-composable visa and immigration platform. Applicants and
verified agencies turn documents into structured, permission-aware profiles
through a governed, AI-assisted workflow — with an equivalent no-AI manual
path.

> **Status:** Phase 0 — foundation. The product contract is the revised
> 3-page PRD plus the companion Build Specification. A feature is not
> complete unless it satisfies both documents and its acceptance tests.

## Principles

- **Remote-first.** No required local setup. GitHub for source and CI,
  Vercel for hosting. See [ADR-0002](docs/adr/0002-remote-first-delivery.md).
- **Universal Core + composable Packs.** A framework-agnostic domain engine,
  extended by versioned, cited, admin-approved requirement packs.
- **No silent mutation.** Every record change is an explicit, versioned,
  atomically-approved proposal.
- **Fail closed.** Permissions deny by default and audit even on denial.
- **Modular & upgradeable.** One package per concern behind a stable seam.

## Repository layout

```
visastack/
├── apps/
│   └── web/            # Next.js App Router app (deployed on Vercel)
├── packages/
│   └── core/           # Universal Core — framework-agnostic domain logic
├── docs/
│   ├── adr/            # Architecture Decision Records
│   ├── architecture/   # System overview & context
│   ├── governance/     # Delivery, branch protection, security process
│   └── roadmap/        # Phased delivery plan
└── .github/            # CI/CD, CodeQL, dependency review, governance
```

## Quickstart

```bash
pnpm install
pnpm run check          # lint + typecheck + test
pnpm run build          # build the workspace
```

Requires Node 22 (`.nvmrc`) and pnpm 10+.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Phased delivery plan](docs/roadmap/phase-plan.md)
- [Architecture Decision Records](docs/adr/)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

Proprietary and confidential. All rights reserved.
