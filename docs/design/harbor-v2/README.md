# VisaStack C1 — Harbor Blue Frozen Design System v2.0

**Start:** open `START_HERE_Visual_Explorer.html`. The frozen C1 reference remains authoritative. Harbor Blue is the selected production palette. **Nothing here changes the live site.**

## Five-minute orientation

1. **Visual:** `05_visual_previews/C1_HARBOR_HOMEPAGE.html` shows Harbor over the unchanged Concept 1 structure; `05_visual_previews/C1_HARBOR_1440.png` and `_390.png` show actual Chromium renders. The interactive `START_HERE_Visual_Explorer.html` includes viewport previews, tokens, component/route registers and approval gates.
2. **Identity:** `01_tokens/HARBOR_TOKENS.json` controls all brand-related colors. `HARBOR_C1_COLOR_ONLY.css` is the restricted landing override; `HARBOR_SEMANTIC_TOKENS.css` provides role names for application use.
3. **Geometry:** `00_authority/CONCEPT1_FROZEN.html` with immutable SHA-256 is the *only approved pixel authority* for the public C1 homepage. `01_tokens/C1_GEOMETRY_LOCK.json` enumerates concrete source rules.
4. **Full application:** `03_component_contracts/COMPONENT_REGISTER.md` covers 60 components and states; `04_route_contracts/ROUTE_REGISTER.md` maps 30 major surfaces. They are **not** an assertion of 30 existing live URLs or approved page mockups. Each new app page requires owner-approved high-fidelity baseline.
5. **App extension proposal (NOT APPROVED):** `03_component_contracts/APP_EXTENSION_MEASUREMENTS_PROPOSAL.md`, `01_tokens/HARBOR_APP_EXTENSION_CANDIDATE.css` and `05_visual_previews/APP_EXTENSION_SPECIMEN_PROPOSED.html` illustrate explicit proposed operational component measurements; do not promote to production without signed screen baselines.
6. **Implementation:** give Codex/Claude Code this entire folder and `07_agent_handoff/COPY_PASTE_MASTER_CODEX_CLAUDE_PROMPT.md`. Never give only a creative one-liner.

## What is actually verified

- Source SHA-256 remains `894253b7a9d8ebb56abd522d8237a8768476ad98555f779e5efced815d522a10`.
- Harbor primary `#1D4C98` / ink `#13243D` / deep stage `#0B1A30` / canvas `#FFFFFF` / alternate `#F7F9FE`.
- Source-versus-Harbor browser parity: 136 DOM nodes, 32 geometry/type/style properties, four viewport widths, **zero theme-induced layout differences**.
- Harbor token samples meet tested 4.5:1 minimum contrast, including action 8.27:1, heading 15.59:1, body 6.34:1.
- **Known source bug:** 768px horizontal overflow. We did not secretly correct it in frozen reference. A documented narrow repair is needed in production.

## What is NOT verified

- No current live repository inspection or UI deployment was completed as part of this design-system artifact.
- The uploaded C1 has an illustrative `V` symbol, not guaranteed to be the approved VisaStack mark.
- C1 HTML is a specimen, not a production routing/auth/data implementation.
- No pixel-authoritative visual baseline yet exists for every traveler, agency or admin screen. Those patterns are specified as gated extensions, not invented layouts.
- The QA report tests *source/theme parity*, not authenticated flows, performance, legal eligibility, security, or completeness of product implementation.

## Run QA

From the package directory with Python, Playwright, tinycss2 and a Chromium executable available:

```bash
python 06_quality_gates/verify_harbor_lock.py
```

The QA command is intentionally read-only against the C1 source and writes deterministic reports/snapshots. Production CI must separately validate live routes, state screenshots and server-side authorization.

## No-drift workflow

Read-only repo audit → install C1/Harbor lock → landing-only implementation → exact visual/property diff → mobile/a11y narrow fixes with approval → traveler screen designs and owner approval → agency screen designs and owner approval → admin screen designs and owner approval → route/state regression. If any unknown source value is not visually defined, **do not allow the AI coding model to decide it autonomously**.

## Files

- `00_authority` — immutable source, SHA manifest, previous constitution and screenshot.
- `01_tokens` — Harbor raw/semantic tokens, geometry lock and color-safe CSS.
- `02_specification` — normative v2 constitution.
- `03_component_contracts` — 60 component patterns/states and authority classification.
- `04_route_contracts` — 30 route archetypes + U01–U10 product upgrade mapping.
- `05_visual_previews` — standalone Harbor HTML + viewport renders.
- `06_quality_gates` — reproducible parity test, report, production adoption guidance and visual approval ledger template.
- `07_agent_handoff` — master implementation prompt, AGENTS and CLAUDE instructions.

**Version discipline:** Palette is approved. Frozen C1 landing source is approved as the visual reference. Each *application extension* must be individually approved before it may override production geometry.
