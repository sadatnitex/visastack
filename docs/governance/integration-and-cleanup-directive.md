# VisaStack Integration and Cleanup Directive

> Companion process directive to
> [`docs/roadmap/commercial-recovery-completion-ux-directive.md`](../roadmap/commercial-recovery-completion-ux-directive.md),
> reproduced verbatim from the engagement brief received 2026-07-31. It
> applies continuously throughout every PR in that programme, starting with
> Phase 0/PR 1. Its purpose: apply the master commercial-readiness prompt to
> the existing VisaStack codebase without rebuilding working modules,
> creating parallel implementations, or duplicating architecture — the
> codebase already carries substantial, tested functionality (Releases A–H,
> PRs #29–#53) that this programme corrects and extends, not replaces.

Apply the master commercial-readiness prompt to the existing VisaStack
codebase. Do not rebuild working modules, create parallel implementations
or duplicate architecture.

## Before editing

1. Inventory existing:
   - Services
   - Routes and server actions
   - Components
   - Hooks and utilities
   - Database tables and migrations
   - Policy rules
   - Adapters
   - Tests
   - Documentation
   - Environment variables
   - Feature flags
2. For every requested capability, classify the current implementation as:
   - Reuse unchanged
   - Repair
   - Extend
   - Replace
   - Remove
   - Merge with duplicate
   - Keep disabled

Use the existing implementation whenever it can be corrected safely.

## Cleanup rules

Remove or consolidate only when proven safe:

- Duplicate services, helpers and components
- Competing authorization paths
- Repeated status maps and constants
- Stale feature flags
- Orphaned environment variables
- Dead routes and server actions
- Unused adapters
- Obsolete reduced-control fallbacks
- Duplicate tests covering identical behaviour
- Stale documentation
- Old temporary UI
- Unreachable code
- Deprecated exports and dependencies

Do not remove:

- Applied migrations
- Audit history support
- Compatibility needed for existing stored data
- Working login protections
- Applicant ownership rules
- Immutable fact/version history
- Existing security tests
- Rollback paths

Never rewrite applied migration files. Add corrective migrations.

## Integration requirements

Maintain one canonical implementation for each concern:

- Authentication
- Authorization
- Consent
- Storage
- Scanning
- Jobs
- AI extraction
- Document naming
- Profile facts
- Sharing
- Agency access
- Missions
- Audit
- Retention and deletion
- Capability status
- UX status labels

All UI must call the canonical service layer. No route or server action
may reproduce business or authorization logic.

Before deleting a duplicate:

1. Find every import and runtime use.
2. Confirm the canonical replacement covers all behaviour.
3. Migrate callers.
4. Add or update regression tests.
5. Run typecheck, tests and build.
6. Delete the obsolete implementation.
7. Update documentation.

## Tracking

Create `docs/audits/integration-and-cleanup-map.md`. For each removed,
merged or retained item, record: old path, canonical path, reason,
data/migration impact, test evidence, rollback consideration.

Do not perform broad cosmetic refactors unrelated to the active PR.

Do not declare cleanup complete based on lower file count. Completion
means: no competing business logic, no duplicate security decisions, no
orphaned configuration, no broken imports, no data loss, no behavioural
regression, cleaner user journeys, full tests passing, preview deployment
verified.

Apply this directive continuously throughout every PR in the master
programme.
