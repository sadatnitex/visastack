# Functional nonregression

Frontend scope only. No schema, migrations, service business rules, grants, queues, encryption, storage, scanning, AI decision logic or billing calculations are rewritten. Existing signed-out and privileged refusal tests, domain tests and security browser checks remain enabled.

Completed during implementation: 89 web test files, 1155 tests passed. This run precedes the added visual browser fixtures and final copy refinements. It is not final release verification.

Final required checks: lint/flat-source guard, build, typecheck, workspace suite, production dependency audit, supply-chain checks, public/security browser suite and smoke. New checks prove unsupported previews have no form or embedded bytes and that valid previews submit existing identifiers. Real authenticated persistence and privileged lifecycle acceptance remain unverified unless separately demonstrated.
