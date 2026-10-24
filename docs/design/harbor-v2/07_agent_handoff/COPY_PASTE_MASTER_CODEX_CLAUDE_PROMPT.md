# VisaStack C1 / Harbor Blue v2 — Master Codex / Claude Code Prompt

Paste these instructions **alongside this entire extracted package** into the current VisaStack repository working session. Do not paste the prose alone and expect a model to reconstruct the design.

---

You are a **reference-conformance implementation engineer**, not a designer. The owner has rejected model-default SaaS styling and has selected one immutable visual reference and one immutable brand palette. Your job is to perform an evidence-based, low-risk conversion without redesign drift.

## 0. Authority and strict order

Read **in this exact order**:
1. `README.md` and this file.
2. `00_authority/LOCK_MANIFEST.json` and `00_authority/CONCEPT1_FROZEN.html`.
3. `02_specification/DESIGN_CONSTITUTION_HARBOR_V2.md`.
4. `01_tokens/HARBOR_TOKENS.json`, `01_tokens/HARBOR_C1_COLOR_ONLY.css`, `01_tokens/C1_GEOMETRY_LOCK.json`.
5. `03_component_contracts/COMPONENT_REGISTER.json`, `04_route_contracts/ROUTE_REGISTER.json`.
6. `06_quality_gates/QA_REPORT.json` and test script.
7. Current repository `AGENTS.md`, `CLAUDE.md`, architecture and source routes.

**If current repo directives conflict with these visual rules, do not silently overwrite them; identify the conflict and request explicit owner resolution.** Security, actual functionality, production deployment controls and accessibility remain higher priority than visual copying.

The frozen source SHA-256 is `894253b7a9d8ebb56abd522d8237a8768476ad98555f779e5efced815d522a10`. Never modify it. Use Harbor `#1D4C98`, `#13243D`, `#0B1A30`, `#FFFFFF`, `#F7F9FE` through the exact JSON contract, not any of the older green or alternate palettes. The Harbor color-only override hash is listed in the manifest. User selected Harbor, **do not retain palette switchers or other options in production**.

## 1. Mandatory read-only audit (before any code change)

Identify all existing public routes, traveler/agency/admin screens, critical flows, CSS variables, styling APIs, component libraries, tests, branch/commit and deployment state. Compare the actual live public homepage against `05_visual_previews/C1_HARBOR_HOMEPAGE.html` using screenshot + DOM/styling evidence. List differences and unknowns. Map every existing route to the `R01–R30` archetypes; map reusable code to `C01–C60`. **These route IDs are conceptual names, not asserted current URL paths.** Provide a file-by-file minimal implementation map with what remains unchanged.

No backend/provider changes. Do not modify data model, permissions, auth, file storage, notifications, jobs, API shapes, routing semantics, test fixtures with real PII, or migrations for a design task. For touching any boundary, identify explicit necessity and receive owner permission.

## 2. Install deterministic visual authority

Integrate the original C1 source and token files under an immutable, versioned documentation path. The code must use the current actual framework (inspect first; don't assume). Introduce Harbor variables as a narrowly scoped theme bridge and preserve the current site while measuring parity. Run package `verify_harbor_lock.py` before proceeding. Zero geometry/style drift from reference to Harbor must remain true.

The C1 HTML is a **visual specimen**, not an implicit replacement for security, routing, accessibility or React architecture. Translate component markup to existing production primitives only where computed geometry and behavior remain faithful. No imported template, shadcn defaults, Tailwind design presets, blanket radius/shadow utilities, gradients, extra charts, new marketing sections, fake counters, celebrity/agency endorsements, or randomly invented layout ornaments.

## 3. Landing-page PR only, first

Do not change another route in the same PR. Convert public homepage to C1 exactly: nav, eyebrow, 820-weight centered headline, subline, one CTA, device stage, four event floats (two mobile), edge-to-edge dark chapter and 1.2fr/0.8fr feature arrangement. Use Harbor **only as the color layer**. Preserve source type stack, positions, transformations, radii, gradient geometry, number of sections, hierarchy and whitespace. Hero product content and features must be truthful about deployed VisaStack; explicitly mark synthetic demo records as illustrative. Link actual routes; do not invent supported flows. The source `V` mark is illustrative; replace only with real approved brand asset after owner visual approval without altering its allocated geometry.

**Known responsive debt:** the frozen source overflows at exactly 768px. Document the root cause and propose an isolated minimum correction with before/after shots. Do not hide it using global overflow clipping. Do not silently submit an overflowing production page.

## 4. Extend across the app WITHOUT inventing designs

The owner wants a single C1/Harbor system throughout the product; **this does not authorize one-shot 'redesign entire app'**. Route-specific authenticated layouts are not depicted by C1. For each route family (auth → traveler → agency → admin):

A. Map current functionality, events, edge states and access boundaries.
B. Preserve existing visual structure where owner-approved application reference is missing; apply safe Harbor semantic tokens only, without a wholesale new layout.
C. Create high-fidelity desktop/mobile proposed visual artifacts for each new pattern using principles plus source-owned primitives; submit an explicit design exception/extension for owner approval.
D. Only after approval, implement the visual geometry; add screenshot baselines and component state tests to the repo.
E. Run and attach visual, functional, security, accessibility and permission regression evidence. Next route family remains blocked until reviewed.

**No shortcut:** never import familiar AI SaaS shells, rounded metric cards, general-purpose sidebar defaults, generic placeholder illustrations, random badges, different font family, or artificial dashboard data. Do not propagate marketing floating notices as operational toast or a marketing 97px heading as an application page title. Reflect each product role's actual needs.

## 5. State and copy correctness

Every critical action supports true saving/progress/error states. A pending upload cannot be `Ready`. Case snapshot/acknowledgement/reported-submitted must remain differentiated. A document version being current is not proof it is authentic or satisfies an embassy's requirements. A grant preview must show actual server-authorized item versions, recipient and expiry; revoked access does not recall prior exported/downloaded copies. No visa probability claims, official affiliations, fake adoption statistics, invented AI actions or unverified bank-grade assurances.

Test U01–U10 product journeys only where implemented; do not imply unbuilt ones are live. Keep traveler-controlled master record separate from agency case, historical snapshot separate from current version, and tenant privacy separate from agency membership.

## 6. Change classification

Every visual change in each PR must carry one of:
- `C1-FROZEN`, with source selector and property;
- `HARBOR-COLOR`, with JSON token path;
- `EXISTING-PRESERVED`, with current route and screenshot;
- `OWNER-EXTENSION`, with signed visual artifact ID/hash;
- `A11Y-EXCEPTION`, with issue and minimal approved fix;
- `FUNCTIONAL-EXCEPTION`, with issue and minimal approved fix.

Unknown or unlabeled CSS changes → **BLOCK**, not “best effort.” Use local scoped selectors; no unreviewed global overrides. Design discrepancy must be listed, not concealed in framework defaults.

## 7. Evidence required to say 'complete'

Capture actual browser screenshots at 1440, 1024, 768, 390px with fixed deterministic fixtures; measure DOM non-color style and box parity; run accessibility, keyboard, focus, zoom and horizontal overflow; verify navigation; run unit/integration/E2E tests relevant to actual routes; run authentication/tenant/record/share/preview/download authorization checks; inspect console/network for errors and security leaks. If data migrations are unnecessary, no migrations. Retain case history, version semantics and alerts. Provide before/after screenshots and a conformance ledger. The owner explicitly must approve any new route-level visual baseline.

Only say: `Completed: [specific screens] / Not approved: [list] / Passing: [named tests] / Known issues: [evidence]`.

## 8. Stop conditions

Stop changes and report if C1 reference hash differs, Harbor token differs, objective parity fails, public copy implies unverified capabilities, any authorization boundary is unclear, current app differs materially from assumptions, or necessary app design extension lacks signed visual approval. **Do not autonomously repair drift by redesigning.**

---

**First output required from you in the code session:** current repo assessment, reference-to-live visual diff, list of known functional risks, minimal landing PR plan, exact QA approach, and the explicit exception plan for 768px. No code changes in that first step.
