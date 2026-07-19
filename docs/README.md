# VisaStack Documentation

This directory is the engineering source of truth. It is versioned with the
code so that every decision, boundary, and plan is reviewable in the same PR
that changes behavior.

## Map

| Area | Path | Purpose |
|------|------|---------|
| Decisions | [`adr/`](adr/) | Architecture Decision Records — why we chose what we chose. |
| Architecture | [`architecture/`](architecture/) | System context, boundaries, data flow. |
| Roadmap | [`roadmap/`](roadmap/) | Phased delivery plan and acceptance gates. |
| Governance | [`governance/`](governance/) | Branch protection, delivery process, security. |

## Authority

The product contract lives in two documents outside this repo (to be
imported as they are finalized):

1. **The revised 3-page PRD** — the executive product contract.
2. **The companion Build Specification** — the implementation authority.

Where this documentation and those documents disagree, the PRD and Build
Specification win, and the docs here are corrected.
