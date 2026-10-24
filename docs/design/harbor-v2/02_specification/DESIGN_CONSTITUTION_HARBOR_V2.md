# VisaStack C1 / Harbor Blue — Design Constitution v2.0

**Authority class:** Normative implementation contract; source-backed where marked `FROZEN`, proposed where marked `EXTENSION / APPROVAL REQUIRED`.

**Owner-selected design:** the uploaded Flighty-inspired Concept 1, **not** generic Flighty aesthetics, a mood board, or an invitation to improvise. Frozen HTML SHA-256: `894253b7a9d8ebb56abd522d8237a8768476ad98555f779e5efced815d522a10`.

**Chosen color direction:** Harbor Blue (`#1D4C98` primary, `#13243D` ink, `#0B1A30` dark stage, `#FFFFFF` canvas, `#F7F9FE` quiet surface).

**Scope:** public experience, marketing, account journeys, traveler personal record, cases, document wallet, notices, agency workspace, administrator surfaces, sharing permissions, versions, and future approved extensions. This contract fixes a *single visual language*; it does not claim that one landing-page reference automatically gives pixel-approved layouts for every application workflow.

## 1. Hierarchy of authority

1. **Safety, data ownership, truthful copy, privacy, accessibility, and working backend**: non-negotiable. Do not reproduce a defect if it compromises access, truth, or data security.
2. **Immutable `00_authority/CONCEPT1_FROZEN.html`**: pixel-level authority for C1 landing elements. Do not rewrite it, even to insert Harbor directly.
3. **`01_tokens/HARBOR_TOKENS.json` + `HARBOR_C1_COLOR_ONLY.css`**: brand/color authority. No primary green, alien purple, or arbitrary accent may remain as a brand signal after conversion. Semantic success/warning/error colors remain semantically separate.
4. **Signed extension images + component contracts**: authority for application screens *after owner approval*. Until then, spec is a candidate pattern library, not license for bulk UI rewriting.
5. **Actual production architecture and user needs**: content and supported operations; terminology changes may require reflow, but never silent layout adaptation.
6. **Developer / framework / model defaults**: no authority over visual decisions. Do not substitute a prebuilt visual library, re-theme with defaults, or generate “premium/Apple-like SaaS” styling.

### Classifications used in this package
- `FROZEN`: proved or quoted directly from the C1 HTML / approved Harbor colors; copy source selectors and values.
- `DERIVED`: a color/state alias or a conservative transformation of C1 principles; mechanically specified, but not directly shown in C1.
- `PROPOSED`: new product component or route structure requiring high-fidelity owner approval before production styling.
- `UNKNOWN`: not verified on the current live repository; a coding agent must inspect rather than assume.

## 2. C1 graphic grammar — frozen signatures

### 2.1 Composition / proportions `FROZEN`

**Header → eyebrow → single oversized centered headline → one concise explanation → one dominant CTA → low-key assurance line → hero device plus exactly four contextual event panels → full-bleed dark chapter → split title/copy → asymmetrical feature panels → minimal footer.**

Public hero composition is **centered and product-led**. Never switch to split photo/text, passports-with-travel-props, generic globe, airline window, travel stock, interstitial logo strip, staged photography, three-benefit-card hero, usage charts, or made-up metrics.

Reference values in `01_tokens/C1_GEOMETRY_LOCK.json`, applied to matching selectors, govern: `.shell` width 1320px/48px padding, nav 78px, headline up to 97px at 820 weight and tight tracking, device 335×642px and −2.8° tilt, four fixed-position desktop notices (two mobile), dark stage 110px/100px vertical, 1.2fr/0.8fr bento with 15px gap. Mobile values are separately specified. **Neither a new SVG, hero photo, nor a different card shape is permitted merely because the model prefers it.**

### 2.2 Type `FROZEN`

`font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`; platform-rendered system font. Never replace with Inter, Poppins, Manrope, DM Sans, serif displays or loaded webfont without signed exception. This means screenshots across operating systems are not intrinsically pixel-identical; visual acceptance must control test platform and installed fonts.

Marketing hierarchy and exact values reside in `01_tokens/C1_GEOMETRY_LOCK.json`. High confidence from very large, dark headings; body is concise and secondary. Use uppercase tracked 11px eyebrow sparingly, not as a generic label on every authenticated screen.

### 2.3 Device / illustration `FROZEN`

Use actual sample VisaStack UI inside the source-specified phone, not a fabricated Apple native-app representation. The source has a device *illustration*; actual VisaStack may be a mobile responsive web app. Demo data must always be labeled illustrative. Four contextual notices are independent events that follow the fixed C1 placements and rotations. The generic notifications from icon libraries cannot replace them with another form factor. No floating cards beyond the source count.

### 2.4 Shapes `FROZEN`

- Hero CTA `.pill`: capsule `border-radius:100px`, padding `13px 23px`, 14px / 700.
- Header mark source footprint: 31×31px with 9px radius. **The actual authorized VisaStack mark must be resolved**; the letter V in source is a placeholder and cannot be called approved official artwork.
- Device: 8px rim, 48px radius; mobile 44px radius.
- Context events: 13px radius.
- Feature panels: 25px radius and 34px padding.
- Device inner controls: `.segment`, `.phonepanel`, `.fileline`, `.tag`, `.bottomnav` as source CSS, not library replacements.

These distinct radii are intentional. Do **not** turn them into one universal 12px token and claim parity. New application components require purpose-specific approved geometry before inclusion in the shared library.

### 2.5 Color `FROZEN HARBOR`

| Role | Hex | Applied to |
|---|---|---|
| Primary action | `#1D4C98` | Singular dominant CTA, action links/selected cues |
| Primary hover | `#143B7A` | CTA hover, active action response |
| Ink | `#13243D` | Headline, major copy, approved source body ink |
| Body text | `#516174` | Explanations and supporting body |
| Muted | `#647386` | Timestamps/secondary metadata when contrast sufficient |
| Dark chapter | `#0B1A30` | Full-bleed product chapter |
| Canvas | `#FFFFFF` | Predominant light hero |
| Quiet surface | `#F7F9FE` | Light alternates/panels |
| Positive | `#176E52` | Confirmed/completed only with truthful qualifiers |
| Warning | `#92512F` | Expiring/action pending, with explicit status text |
| Error | `#A32935` | Failed/error/blocked, never decorative |

Dark section uses white heading with legible de-emphasized body. **Do not recolor the entire page blue.** Harbor blue is a system accent, not a major hero fill. No green/teal branded CTAs, purple smart-feature panels, inconsistent orange highlights, or random linear gradients in product workspaces. C1's approved gradient geometry remains, **only its hue is translated** by the Harbor-only override.

### 2.6 Interaction `FROZEN + DERIVED`

Existing reference is primarily a static prototype, not a functioning app. Approved behavior is therefore limited to visual affordances and links. For real components: semantic buttons/links, focus-visible, reduced-motion respected, immediate action feedback, truthful progress, reversible confirmation where possible, and keyboard access. Motion may support state change, not decorate. Prohibit continuous bobbing phones, parallax-for-its-own-sake, blur/glass overlays, confetti, randomly springing panels and animated gradients.

## 3. Brand color architecture

Exactly one enabled theme in production: **Harbor**. Other palette experiments belong in research, not the shipping CSS. `HARBOR_TOKENS.json` is the single raw HEX authority; CSS custom properties are generated from it. Map all brand-driven colors through semantic token roles. Do not bulk-replace every green pixel: success remains green, warnings remain brown, errors remain red, and official flags/documents retain truthful source colors. Brand and semantic statuses must never be conflated.

Rules:

- Color-only CSS may contain `color`, `background`, `background-color`, `border-color`, `box-shadow`, `outline-color`, `fill`, `stroke`, `text-decoration-color`, and CSS custom properties only. Within backgrounds and shadows, **color stops alone** may change: geometry must remain identical.
- No changes to radius, tracking, letter spacing, font weight, box sizing, line-height, shadows' blur/offset, gradients' location/extent, section ordering, device angles, or number of cards when theme switches.
- All new application components use variables, not hardcoded blues. Borders and fills use approved neutral/supporting tokens; no personal interpretation of “pale blue”.
- Primary CTA `#1D4C98` on white text passes WCAG contrast (verified in package QA); accessibility auditing extends to all components/states.
- Official VisaStack icon/wordmark must be sourced from the real asset and checked separately for minimum size, negative space and contrast. Do not adopt an unrelated project logo.

## 4. Full interface system — boundary of what is approved

The landing page is directly reproducible from C1. The app is not. To honor the request for a *whole product*, this release includes a **controlled component taxonomy, states, interaction contracts, route archetypes and review gates** rather than fictional claim of pixel-perfect app designs. Every new route must get a high-fidelity accepted baseline. Until approved, the coding agent may integrate color tokens into existing stable components with visual diffs, but may **not** redesign shell, forms or workflows.

### 4.1 Composition within the app `DERIVED / PROPOSED`

- Separate app-shell archetypes for traveler, agency, administrator; do not reuse the landing hero as a dashboard.
- Traveler is task-first, with a primary next action and readable records. Do not promote vanity metric counters.
- Agency supports case queues, ownership, requests, exceptions and related documents; density is controlled by tasks, not stylized analytics cards.
- Administrator is explicit and auditable, with clear destructive controls and measured system state. Admin privileges never appear via client-only logic.
- Record view, revision history, comparison, permission preview and file status may require drawers, tables or panels. Their exact measurements are **proposed** until approved in a route screenshot, then added to `approved-extensions/` with a hash.

### 4.2 Content hierarchy rules `DERIVED`

The real user's goal determines the page H1. Use one primary action per decision locus, not necessarily one global button across every operational screen. Important blockers appear before minor reminders. A state indicator must answer what it means and what happens next, not just label something “Ready”. Keep draft, processing, received, reviewed, case-selected, shared, and submitted as separate states. Never equate document “current version” with official authenticity, legal sufficiency, or visa approval. Reject imaginary percentages, adoption stats, and partner endorsement logos.

### 4.3 All-state coverage requirements

For every component/screens where applicable: default, hover, focus-visible, pressed, selected, disabled **with reason**, loading with real completion semantics, saved, saving, empty, error, warning, offline/interrupted, permission denied, expired, revoked, partially completed, stale version, destructive confirmation, multi-actor update conflict. Design all real-world outcomes, not just the happy path. No loader that conceals a failed save.

### 4.4 Text / localization / density

Maintain text wrapping and dynamic data bounds for long names, destination strings, 200% browser zoom, Bangla where currently supported, and accessible labels. No design may truncate the *only* way to identify a passport, case, recipient, or due date. Mask passport identifiers and bank information by default and in previews. Preserve exact factual user-provided dates/time zones, especially expiry and events. Distinguish UTC storage from traveler-local display where appropriate.

## 5. Non-negotiable security and correctness boundaries

Visual work must not touch, rewrite or bypass: Neon Auth identity binding, tenant/case/record authorization, private storage and document gateway, time-aware fact/version history, case snapshots, grants, recipient scoping, agency membership checks, invitations, notification jobs, audit logs, exports or AI consent/approval. Do not substitute colorful “secure” badges for evidence. A revoked grant blocks future retrieval where enforced, **not** recalls copies already downloaded.

Sources of truth for supported capabilities: current checkout, schema/migrations, services and verified journeys. The historical VisaStack upgrade contract describes ten capabilities U01–U10, but code presence does not prove deployment status. The design system must not imply all ten are live.

No mandatory AI prompt during standard data entry. AI suggestions require explicit human review. No claimed visa-approval prediction or government affiliation.

## 6. Visual anti-drift policy (mandatory)

**Never instruct a model to invent styling.** Agent must label every CSS change as one of:

- `C1-FROZEN` — exact selector/property copied from approved reference;
- `HARBOR-COLOR` — named token used without altering layout;
- `EXISTING-PRESERVED` — production UI retained where no design exists;
- `OWNER-EXTENSION` — linked to owner-approved visual artifact + checksum;
- `A11Y-EXCEPTION` — smallest patch addressing a documented accessibility defect, signed off;
- `FUNCTIONAL-EXCEPTION` — smallest patch needed for truthful functioning/security, signed off.

All other labels trigger **BLOCK**. Unknown component styles cannot be “made consistent” through unreviewed global Tailwind classes or third-party UI theme defaults. The presence of a polished generated screenshot is **not** approval. No C1 design drift by model preference is acceptable; a tester can catch many objective deviations, but subjective originality still needs human review.

### Agent prohibitions

No shadcn visual presets, precomposed Tailwind UI dashboard, Material defaults, glassmorphism, multicolor pastel icons, marketing stock photos, irrelevant 3D globes, arbitrarily rounded everything, sidebars with promotional panels, arbitrary `backdrop-filter`, custom gradient heroes, illustrations invented to cover blank space, three-column feature grid, loud cards-on-cards, fictitious testimonials/statistics, dark mode introduced without approval, new typefaces, arbitrary spacing scales, emoji icons, and unrequested microinteractions.

## 7. Testing and release gates

1. Check frozen source hash and Harbor override CSS hash.
2. Verify only allowed color properties changed between source and Harbor render.
3. Compare DOM count, geometry bounding boxes (≤0.5px tolerance) and 32 key computed layout/type properties at 1440, 1024, 768, 390px; capture browser screenshots.
4. Track existing 768px navigation overflow separately; it is a **source defect**, not an acceptable production result. Fix minimally through an approved narrow exception.
5. Contrast checks for primary action, headline, body, state text; manual audits for focus and other combinations.
6. For every production route: owner-approved screenshot baseline at 1440/1024/768/390, plus real-world states. No screenshot masking except dynamic PII/timestamps narrowly documented.
7. Regression tests: keyboard, focus, zoom, mobile overflow, accessible labeling, locale, actual navigation, document status, permission denial, cross-tenant access, old-version display, stale edit conflict, retry after failure.
8. Signed outcome: visual owner + product owner + security owner for affected permission/data changes. If no signed approval, report readiness, never assert full conformance.

## 8. Known limitations and required decisions

- `FROZEN` source is not a production-ready React/Next page; it is a visual specimen.
- The original C1 includes a placeholder `V` logo; substitute real approved VisaStack mark only with documented asset and alignment sign-off.
- Source has a 768px overflow defect; must be fixed for production, explicitly recorded.
- Source marketing device implies phone-screen experience; **do not imply native iOS/Android application** without evidence.
- Exact route mappings and current implementation state are `UNKNOWN` without checking the live repository.
- A one-page frozen reference cannot rationally determine exact geometry for complex admin, intake or document editing screens. These are governed by candidate patterns and approval gates; claiming otherwise would create the AI-default drift this project rejects.

## 9. Definitions of done

**Design-system package complete:** frozen reference, Harbor tokens, color-only HTML, component/route contracts, QA scripts, testable provenance, agent instructions, human review register. **Production compliance not yet claimed.**

**Landing page production complete:** no unapproved design/property diff from C1 except brand color, real brand artwork and approved accessibility fixes; actual navigation works; no unverified claims; responsive, tested and approved.

**Whole product production complete:** every route and state mapped to an accepted owner-approved visual baseline; shared Harbor tokens enforced; no new unreferenced styles; existing security/data functions work; comprehensive checks pass. It is a future acceptance condition, not a status assertion.
