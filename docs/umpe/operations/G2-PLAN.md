# G2 plan: rules gap closure (R02, R05, R08, S08, R12, R18, R22)

Branch `umpe/g2-rules` from `origin/umpe/int-w4` 698f65f5. All changes additive.

## Data (one appended schema block, two side tables, one enum value)
- `pack_requirement_details` (one row per pack requirement, cascade): `category`, `accepted_form`,
  `translation_needed`, `original_needed`, `statement_period_months`, `valid_months_after_travel`,
  `effective_since`. Side table, so no existing select or insert of `pack_requirements` changes and
  Pack Studio keeps working before the migration (only the new fields wait).
- `pack_route_conditions` (one row per pack, cascade): `consular_posts text[]`, `travel_from`,
  `travel_until`. Same reason.
- `requirement_provenance` gains `FIELD_OBSERVATION` (from the core list, no schema.ts edit).
- Readers tolerate both tables missing (cached presence check, existing pattern).
- Manifests: details stay outside the checksum, like `maxAgeDays` and `notes` (format 1 and 2 bytes
  untouched); edits are refused unless the version is DRAFT, so a published version stays fixed.

## Core
- `requirement-categories.ts`: 11 canonical categories (annex section 1), accepted forms, labels,
  format lines with note fallback. Test: disjoint from sharing categories and profile packs.
- `requirement-necessity.ts`: FIELD_OBSERVATION, label "Observed in VisaStack Cases",
  `isOfficialProvenance`, field observations only Recommended or Optional.
- Catalogue: "Past Applications" section, repeating `past_application` record (country, visa type,
  date applied, post, outcome with Pending, Withdrawn, Unknown). No table; read by no matcher.

## Services
- `packs.ts`: details and route conditions read/write (admin only, audited, DRAFT only for details).
- `pack-matching.ts`: consular post and travel start compared only when the pack declares them;
  unknown case value gives `needs` and never auto-links; mismatch excluded; undeclared unchanged.
- `source-monitor.ts`: `latestSourceFetches(urls)` reader (last FETCHED or NOT_MODIFIED).
- `notification-sweep.ts`: `caseExpiryConflicts(proof, missionId)`: chosen documents expiring
  before travel end (plus declared months), active cases only.

## Web
- Pack Studio: category and format fields on the requirement form, a details form per draft row,
  a route conditions form per pack. Register forms in a11y-forms.test.tsx.
- Case page: checklist rows grouped by category inside each state group; Sources list with Checked
  and In Effect Since; one Needs Attention item for documents expiring before the trip ends;
  welcome note says which case detail is needed. Package panel: format line per item.

## Tests (services, core, web) per the brief; two guards proven red; full check; reviews; hand-back.
