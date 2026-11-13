# Staged, not loaded

`visastack_extended_purposes_not_loadable_yet.csv` is the owner's research of 13 November 2026 for
purposes beyond tourist and business visits: 440 lines for 17 countries (study, work, family,
transit, conferences, medical and more), copied here byte for byte from the supplied bundle.

It is **staged only**. Nothing in the app reads it. It is not in the starter checklists, not in Pack
Studio and not in production, and no test or build step loads it. The starter build supports only
three purposes today (Tourist, Business, Medical), so these lines cannot be loaded without the
design change described in `extended-purposes-design-2026-11-13.md`.

Columns: country, visaRoute, repoPurposeKey (the catalogue purpose key the line would use, or a
`CONFIRM` marker where the owner must choose), appliesWhen, text, reference (layer, link, grade and
Checked on date, kept as supplied), evidenceGrade, routeKey, needsHumanCheck.

- 439 lines are grade A and 1 is grade B; 188 lines are marked for a human check.
- 103 lines carry a `CONFIRM` marker instead of a key: see the design note for the choices.
- Like every list here, these would be starter lists, not official, until an admin approves them.
