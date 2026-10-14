# Master Profile catalogue: how to read it and how to change it

For anyone (Claude, Codex, a person) who needs to add or change a field, a document type or a purpose. Read `HANDOFF.md` first for who owns what.

## Where things are

| Thing | File |
|---|---|
| Shared types, protection rules, layers, sharing categories | `packages/core/src/catalogue/types.ts` |
| Layer, purpose family, document group and proposed sharing category definitions | `packages/core/src/catalogue/layers.ts` |
| Label and key rules | `packages/core/src/catalogue/naming.ts` |
| Frozen copy of the 81 live fields | `packages/core/src/catalogue/legacy.ts` |
| New fields, one file per layer | `packages/core/src/catalogue/fields/*.ts` |
| Document types | `packages/core/src/catalogue/documents.ts` |
| Purposes | `packages/core/src/catalogue/purposes.ts` |
| Lookups (known field keys, find a document type by name or alias) | `packages/core/src/catalogue/queries.ts` |
| Generated review report | `packages/core/src/catalogue/report.ts` renders `CATALOGUE-REPORT.md` |
| Guards | `catalogue.test.ts` (core), `profile-fields-frozen.test.ts` (web), `catalogue-consistency.test.ts` (services) |

## Rules that the tests enforce

1. **Keys** are permanent. Fields: lower snake case. Documents: UPPER_SNAKE. Never reuse or rename one; add an alias instead.
2. **Labels** are Title Case for terms ("Date of Birth"); small connecting words stay lowercase. Sentences elsewhere follow standard practice.
3. **Protection** follows the kind of data, not opinion. Pick the kind in the field row; the level is derived. A national identifier is always RESTRICTED. Legal history, special categories, biometrics and health detail may not sit in the universal, professional or business categories.
4. **Sharing category (pack)** is the category a grant would name. Anything sensitive goes in a category that does not exist yet (`declarations`, `bangladesh`, `country_ids` and so on), which means no grant can reach it until Phase 2 creates the category on purpose.
5. **Live fields are frozen.** The 81 fields in `apps/web/src/lib/profile-fields.ts` must equal `legacy.ts`. A live field can only change by editing both in one commit and writing the reason in `HANDOFF.md`.
6. **Extending a live record** (for example `prior_visa`) means using its group key with no label. The new fields inherit its category and layer.
7. **Document aliases** can never equal another entry's key or alias. Other products' keys go here.
8. **Provenance** is required: `bidesh365`, `owner_vision` or `proposed` (needs sign-off), with a `sourceRef` that says where to re-check it.
9. **Document `supports`** may only name fields that exist. They are advisory proof links, not auto-fill rules.
10. The review report is generated. After any catalogue change run `pnpm --filter @visastack/core test -- -u` and commit the new `CATALOGUE-REPORT.md`.

## Add a field

1. Pick the layer file in `fields/`. Add a row to an existing block, or a new block with `layer`, `pack`, `origin`, `sourceRef`, and either a `section` (single fields) or a `group` (a repeating record, with a label).
2. Choose the helper: `text`, `date`, `choice`, `yesNo`, or `money` (an amount and its currency as two fields).
3. Pick the kind. If unsure, ask: could this identify a person to a stranger (identifier), reveal health, law, belief or biometrics (the stricter kinds), or is it a money amount?
4. Run the three test suites below. Fix what they say; do not edit a guard to make code pass.

## Add a document type

Add a `doc({...})` entry in the right group. Give it `aliases` for any other name it is known by, `supports` only if you are sure, and an honest `origin`. Leave `pack: null` if you do not know where it belongs; that behaves like unmapped types do today.

## Add a purpose

Add a `p({...})` entry. Default `handling` to `standard`. Protection, investor and similar routes are `adviser_only`; anything needing a licence check or careful wording is `adviser_review`. Never describe rules as verified.

## Checks to run

```
pnpm --filter @visastack/core test
pnpm --filter @visastack/services exec vitest run src/catalogue-consistency.test.ts
cd apps/web && ./node_modules/.bin/vitest run src/lib/profile-fields-frozen.test.ts
pnpm run lint && pnpm run typecheck
```
