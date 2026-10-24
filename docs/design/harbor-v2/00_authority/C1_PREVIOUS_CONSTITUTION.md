# VisaStack C1 — Frozen Visual Design Constitution

**Authority:** Owner-selected `VisaStack_Flighty_Concept_1.html`, frozen byte-for-byte in `reference/CONCEPT1_FROZEN.html`.  
**Contract status:** APPROVED REFERENCE for a proposed implementation; **not** proof that the live site complies.  
**Scope:** Visual language of the approved Concept 1, with an independently replaceable brand palette; application-level extensions require the same governance.  
**Design model:** SOURCE CONFORMITY, not inspiration, imitation from memory, or independent redesign.

## 0. The problem this contract solves

Code-generation models predict conventional UI solutions. Unbounded prompts such as “make it premium,” “Flighty-inspired,” “Apple-like,” “beautiful,” “enterprise,” or “MAANG-quality” routinely produce a recognizable package: soft-glass panels, centered headlines, repetitive feature cards, icons everywhere, pill badges, gratuitous gradients, huge metrics, friendly greetings, stock imagery, and inconsistent geometry. We prohibit **unapproved inventions**, not particular shapes in isolation. Concept 1 itself has curved devices, four floating event cards, a 2×2 feature panel, and a controlled gradient: their **source-defined treatment is intentional** and therefore permitted.

**Normative rule:** Where a pattern exists in the reference, copy its geometry and behavior exactly. Where it does not exist, do not let the model decide the design autonomously. Reuse an approved primitive, make a conservative functional presentation under the same primitives, or issue a bounded design exception for owner approval.

This contract cannot mathematically prevent every subjective sign of AI-generated design. It can, however, make unapproved structural decisions explicit, testable and review-blocking.

## 1. Authority hierarchy

1. Security, accessibility, legal accuracy, and truthful product functionality are inviolable operational requirements.
2. This owner-selected Concept 1, with immutable source hash, governs visual decisions **directly depicted by the reference**.
3. Approved page-specific design extensions (once separately signed off) govern product pages absent from the source.
4. The color-only semantic token layer governs brand palettes.
5. Actual VisaStack features, naming and valid user data govern the copy and journeys; do not imply features beyond existing implementation.
6. Agent preferences, frameworks, imported component defaults, design-pattern assumptions and prior Atlas mockups have **zero design authority**.

**Conflict rule:** If a source geometry conflicts with verified usability/accessibility, **report the conflict and a minimal corrective patch**. Do not silently preserve a failure, and do not reimagine the page. A visual departure requires a versioned exception describing the before/after, reason, and screenshot diff.

## 2. The six frozen signatures of Concept 1

### Signature A — Visual hierarchy

A nearly invisible horizontal header; one narrow uppercase eyebrow; a **very large centered, almost-black sans-serif headline**; a short low-contrast supporting paragraph; a single prominent primary action; understated reassurance copy; then an **oversized illustrative product device** surrounded by small contextual UI signals. Nothing competes with the headline/product relationship.

Prohibitions: split hero with unrelated photography; serif/italic headline; travel imagery as the visual anchor; multiple hero CTAs of equal weight; trust-stat strip; fictional logo strip; decorative globe; floating location flags; colorful feature mosaics competing with the device.

### Signature B — Typographic voice

**Source font stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`. No Google Fonts, generic display-serif, Inter replacement, Poppins, Manrope, DM Sans, or arbitrary font imports without an approved exception.

| Role / reference selector | Source contract |
|---|---|
| Brand `.brand` | 22px, weight 760, tracking `-.065em`; mobile 21px |
| Nav `.links` | 13px, weight 590 |
| Eyebrow `.nudge` | 11px, weight 760, `letter-spacing:.19em`, uppercase; mobile 10px |
| Main display `.headline` | `clamp(58px,6.3vw,97px)`, weight 820, tracking `-.073em`, line-height `.99`, centered, balanced; mobile override `clamp(47px,12vw,74px)`, tracking `-.077em`, line-height `1.01` |
| Lead `.subline` | 20px, weight 400, line-height 1.44, tracking `-.02em`, max-width 660px; mobile 16px |
| Primary action `.pill` | 14px, weight 700, curved capsule, padding 13px 23px |
| Tiny reassurance `.meta` | 12px, low emphasis |
| Dark section title `.sectionhead` | 60px, weight 790, tracking `-.065em`, line-height 1.04; mobile 43px |
| Feature heading `.feature h3` | 36px, tracking `-.055em`, line-height 1.05 |
| Feature body `.feature p` | 15px, line-height 1.55 |

**Text-width rule:** do not reflow the headline by adding new words arbitrarily. Lock composition under actual finalized copy and approved line breaks. All reference screenshots use demonstration text. Production text may change only with an explicit desktop-and-mobile reflow review.

### Signature C — Geometric rhythm

- Overall `.shell`: max-width **1320px**, horizontal padding **48px**; mobile 18px.
- Header `.topnav`: height **78px**, mobile **68px**; open layout, no enclosing floating/glass bar.
- Hero `.hero-center`: centered, top padding **50px** desktop / 43px mobile.
- Display `.headline`: max width **1160px**, margin **23px auto 20px** desktop.
- Lead `.subline`: max width **660px**.
- Devices stage `.devices`: max width **1140px**, height **640px**, margin-top **50px**; mobile height **560px**.
- Dark feature stage `.darkstage`: full-bleed background, vertical padding **110px top / 100px bottom**; mobile **75px** vertical.
- Dark intro `.darkintro`: two columns `1fr 1fr` with **100px** gap, mobile one column and 10px gap.
- Feature composition `.bento`: **1.2fr : .8fr** columns, **15px** gap, mobile one column.
- Feature `.feature`: radius **25px**, min-height **280px**, padding **34px**; `.bigmock` min-height **375px**.

The reference's whitespace is part of the design, not unused space to fill with more cards, statistics, testimonials or CTAs.

### Signature D — Product-device stage

- Device `.phone`: **335×642px**, 8px bezel, **48px** radius, centered, rotated **−2.8°**; mobile **292×555px**, radius 44px.
- Inset notch/island: fixed 104×25px in source.
- App view inside phone uses compact text, segmented controls, two record panels, document rows, status labels and bottom tabs.
- Product must remain the **primary visual subject**, not a minor decoration over a travel photograph.
- Surrounding `.floatcard` elements: four total desktop; two only on mobile. Cards represent concrete UI events (document freshness, prior version, reuse, access expiry)—not broad selling propositions or fake testimonials.
- `.fc1`: left 7%, top 115px, −3°; `.fc2`: right 2%, top 214px, +3°; `.fc3`: left 5%, top 362px, +2°; `.fc4`: right 8%, top 443px, −3° relative to stage. Mobile: `.fc1` left 0/top 97px; `.fc2` right −10px/top 230px; `.fc3` and `.fc4` hidden.
- Card radius **13px**; distinct from phone radius and stage-panel radius. Rotations are source-defined and must not be randomized.

**No pseudo-iPhone factory:** A reusable, approved reference device component is allowed; no new phone mockup proportions, camera shapes, edge effects or floating notifications are invented by a model. If VisaStack remains a responsive web application, the phone denotes a mobile web view—not a falsely implied native iOS app.

### Signature E — Dark-stage contrast and story

Immediately after the expansive light hero, the page moves to an **edge-to-edge dark field**. On it: concise section label, a large title and short explanation, followed by a tightly composed 2×2 feature area. The first feature is larger, includes an angled authentic-looking record preview; the remaining features are structurally subordinate. The gradient is **confined to the approved feature**, not spread across all surfaces.

- No alternating generic sales-card row after every scroll.
- No full-width photos replacing the dark-stage composition.
- No automatic “features / solutions / why us / testimonials / numbers / FAQ” template sequence.
- Further sections, when added, need individually approved wireframes derived from the same typographic and geometric language—not a model-generated website template.

### Signature F — Restraint and micro-interactions

Use source-defined shadow sizes, border widths, state treatments and radii. A single clear CTA dominates. Other information must appear as calmly readable secondary controls. Motion is permitted only when it supports comprehension (arrival, actionable response, panel/row transitions), must respect reduced-motion preference and must never invent a new visual language.

No looping float, blob animations, excessive parallax, confetti, gradient-shimmer, spring-everywhere, or decorative glass. The exact concept source is primarily static: **animation is not a license to elaborate**.

## 3. Exact position observations — browser-rendered baseline

These are examples of measured bounding-box results in Chromium for the supplied reference, not free-standing design tokens. Use the actual HTML for authoritative computation.

| Element | 1440px viewport | 390px viewport |
|---|---|---|
| Header height | 78px | 68px |
| Hero heading | x140 y163, 1160×179.6px | x18 y146, 354×142.4px |
| Lead paragraph | x390 y362.6, 660×57.6px | x18 y305.4, 354×46.1px |
| Device stage | x150 y571.2, 1140×640px | x18 y502.5, 354×560px |
| Device transformed bbox | ≈366×658px | ≈319×569px |
| Dark stage begins | y1211.2 | y1062.5 |
| Feature grid | x108 y1551, 1224px wide | x18 y1460.9, 354px wide |

### Known reference limitation

At a **768px viewport**, the supplied baseline has horizontal overflow (desktop navigation survives until its `max-width:760px` breakpoint). This is a genuine source defect. The theme system preserves it; **that is not production approval**. An accessibility/responsive correction must be specifically proposed, documented, visually compared and approved. The fidelity gate must not silently redefine the reference to hide this issue.

## 4. Color-agnostic brand bridge

The only palette authority is `theme/BRAND_THEMES.json`, compiled through `theme/PALETTE_ONLY.css` into preview HTML. `BRAND_THEMES.json` is editable; `reference/CONCEPT1_FROZEN.html` never is.

| Color role | Meaning | Scope |
|---|---|---|
| `accent` / `accent_hover` | Product identity and primary CTA | Logo capsule, links/CTA, selected states, precise labels |
| `action_foreground` | Contrast text/icons on accent | Must meet contrast requirements |
| `ink` | Nearly-black reading and major type | On light surfaces; never use saturated brand accent for huge headlines by default |
| `body_copy` / `muted` | Supporting hierarchy | Distinct contrast grades |
| `stage` | Dark chapter transition | Should remain a deep surface irrespective of brand hue |
| `paper` / `paper_soft` | Calm white/light surfaces | Dominant canvas; not colored marketing backgrounds |
| `positive` / `warning` | Status meaning | Semantic meaning cannot be overridden into misleading states |

The palette generator changes color declarations, gradients' **hues**, tint and shadow **colors**. It cannot change the gradient position/spread, shadow geometry, radii, markup, or layout. If a new brand accent fails WCAG contrast, supply a darker accessible `accent` for actions, or a reviewed on-accent text color. “Any brand color” means any **accessible mapped palette**, not literally placing an arbitrary bright hue underneath white 14px text.

### Composition rules, independent of hue

- 75–85% of the initial viewport should read as light neutral space, not theme-color fill.
- Primary CTA color appears rarely; no secondary action is recolored merely for visibility.
- Hero text uses ink, not accent; accent is reserved for precise contextual emphasis.
- The dark stage keeps enough darkness to create a chapter change.
- The approved gradient and lime/light-accent cards translate **by role**, not by retaining unapproved purple or lime when a brand uses a different hue.
- Status green/amber/red must indicate actual state, not be confused with the brand accent.

The percentages above are **compositional guidelines**, not a claimed automated color-pixel measurement. Exact appearance is governed by snapshots and the source.

## 5. Component register — source-owned geometry

| Component | Source selector | Frozen property | Allowed substitution |
|---|---|---|---|
| Root canvas | `body.variant1` | White page, minimal chrome, text hierarchy | Palette |
| Header | `.topnav`, `.links`, `.rightlinks` | 78/68px height, flex positions, density | Text labels and destinations with reflow review |
| Brand block | `.brand`, `.mark` | Typographic proportions, 31px mark footprint | Actual approved brand mark inside same envelope; no distortion |
| CTA | `.pill` | Capsule radius, 13×23px padding, weight 700 | Action label/URL and accent token |
| Eyebrow | `.nudge` | 11px all-caps tracked voice | Exact concise terminology and color |
| Hero headline | `.headline` | weight 820, size clamp, centering, line heights | Brand-specific headline only after same-breakpoint visual check |
| Hero subline | `.subline` | 660px max, 20px body | Factual description |
| Dev-stage | `.devices` | 1140px width/640px height | Data within approved device template |
| Device | `.phone`, `.island`, `.statusbar` | Size, bezel, rotation, corner geometry | Data/brand color; not custom phone frame |
| Tab rail | `.segment` | Three compact options | Supported destinations/routes, no invented tabs |
| Document card | `.phonepanel` | Shape and compact density | Real supported record types and states |
| Document row | `.fileline`, `.fileico`, `.fileinfo` | Row alignment, icon/metadata relationships | Verified document data |
| Status token | `.tag` | Small rectangle, semantic contrast | Actual status, accessible semantic colors |
| Floating events | `.floatcard`, `.fc1`–`.fc4` | Four fixed placements/angles (2 mobile) | Real event narratives; no fictional guarantees |
| App bottom nav | `.bottomnav` | Simple compact four-section rail | Production-authenticated mobile routes |
| Dark chapter | `.darkstage`, `.darkintro` | Full bleed, split intro and spacing | Semantic palette and concise copy |
| Feature panels | `.bento`, `.feature.*` | Asymmetric 1.2/.8 two-column, source radii | Accurate demonstrations only |
| Preview card | `.miniui` | Rotated document record preview, contained | Actual selected/correct preview |
| Footer | `.foot` | Minimal, small typographic closure | Real links, legal text |

**Source-owned means frozen.** Do not replace `.floatcard` with a popular shadcn Card, the `.pill` with a default UI-button system, the source font with a framework default, or the asymmetric feature layout with grid-of-three cards.

## 6. Translation to complete VisaStack — where Concept 1 does and does not apply

**Concept 1 is a complete visual reference for the *landing page*, but it is not a design specification for every authenticated application route.** Treating a single landing-page mockup as a complete dashboard system would invite the very AI-made screens this contract is trying to eliminate.

### Approved cross-product DNA (may propagate)

- The system font stack and hierarchy principle (large clear primary heading, subordinate information) carry to other surfaces, with **task-appropriate sizes** rather than copying the 97px marketing headline.
- Quiet neutral backgrounds, sparse brand accents, component rhythm, single dominant action, deliberate information density and dark/light contextual contrast are shared.
- Document row logic, compact tabs, event reminders and status hierarchies are reusable, with factual and accessibility review.
- Role-specific complexity is legitimate: agency workspaces may be dense lists, whereas traveler surfaces should be action-first. They must share approved primitives and color roles—not identical page compositions.

### NOT authorized by Concept 1 alone

- New desktop sidebar size/geometry, permanent topbar, agency client table, document viewer, upload drawer, multi-step form, modal, permission-selection flow, admin screens, alerts inbox, or profile editor. These are **new design decisions**; they cannot be hallucinated from this landing page.
- Do not produce a 30-component “design system” from scratch or substitute shadcn/ui defaults simply because a real app requires those elements.
- Before any production implementation of an unrepresented page, supply its content map, low-fidelity layout, one high-fidelity reference at desktop/mobile, and a mapping to approved primitives. Receive owner approval; only then make it source-authoritative.

### Existing functional journeys must survive

Personal reusable record, document versions, case/mission records, task requests, reminders, cross-agency explicit grants, previous-vs-current declarations, safe exports and privacy settings are preserved. Visuals cannot misrepresent document authenticity, visa approval, immigration outcomes, agency access or security guarantees. Never introduce sensitive private data into public marketing previews.

## 7. Absolute model constraints (Codex / Claude Code)

**These instructions override any agent preference for best practices in visual styling.** Good engineering practices continue to apply to security, accessibility, testing, maintainability and performance.

The agent MUST:

1. First inspect `reference/CONCEPT1_FROZEN.html` and its SHA-256 and the screenshots. It must cite exact selectors from that source in the implementation plan.
2. Copy structural values from source CSS into scoped components; use no unapproved design-library defaults.
3. Keep visuals behind a branded palette layer. No color literals in component code when a semantic token applies.
4. Maintain approved source semantics: one headline, one primary hero action, four fixed contextual events desktop/two mobile, oversized central device, then edge-to-edge dark section and asymmetric 2×2 panel.
5. Prove responsive layout against reference on 1440, 1024, 768, and 390px viewports; acknowledge and remediate known 768 defect by approved exception.
6. Capture before/after desktop and mobile screenshots for each changed page and each affected component state.
7. Preserve existing auth, authorization, private file access, data ownership, integrity checks and backend/API behavior.
8. Name every new visual primitive and link it to an existing C1 source selector or signed exception.
9. Keep sample data explicitly illustrative and avoid fabricated partners, results, approval promises, security certifications and adoption metrics.
10. Stop before merging a design that fails parity, accessibility or owner approval. Report precise diffs; never say “100% aligned” merely because a build passes.

The agent MUST NOT:

- Redesign to “look more premium,” “modernize,” “simplify visually” or “optimize” without an owner-approved deviation.
- Import Tailwind UI/shadcn default aesthetics, Lucide hero decorations, generic glass cards, stock airport hero photographs, rounded gradient badges, triple-column benefit decks, generic app screenshot frames, testimonial carousels or invented live stats.
- Add sections just to fill a marketing-page checklist.
- Use default gradient-background hero, floating toolbar, cards-on-cards or dense marketing CTAs that do not exist in Concept 1.
- Reinterpret palette change as permission to alter typography, positioning, devices, hero structure or sections.
- Claim that code compiles or test suite passes as proof of visual excellence.

## 8. Objective acceptance and CI checks

### Reference-level (included working scripts)

`python qa/build_themed_previews.py` compiles variants by appending a palette-only stylesheet to an unchanged HTML source.  
`python qa/verify_lock.py` enforces:

- SHA-256 match of frozen source;
- palette CSS property allowlist (no layout/typography/radius/animation declarations);
- no structural DOM changes;
- bounding-box parity within **0.5 CSS px** for 136 checked body nodes;
- exact parity of **32 computed non-color style properties** per node;
- desktop/tablet/mobile viewports **1440 / 1024 / 768 / 390px**;
- no new horizontal-overflow regressions relative to source.

This is a **strong negative gate against palette-driven drift**, not a demonstration that the source is production-ready, has verified functionality, or that application pages automatically conform.

### Production-level (to add to the repository after mapping)

- Attach actual page captures (not generated concept art) and design-review sign-off to each affected PR.
- Use screenshot snapshots **for each route and important state** at desktop, tablet, mobile. First capture a signed-off baseline, then guard against unapproved diff. Dynamic timestamps, PII, user avatars, asynchronous content require fixed fixtures or narrowly masked regions.
- Compare computed style tokens for shared primitives, not only snapshots; CSS lock should reject unapproved `font-family`, `border-radius`, `box-shadow`, card grid, hero section, or custom color class usage.
- Assert mobile no horizontal overflow in production; reference's 768px known defect requires a separate surgical correction.
- Keyboard operation, focus visibility, reachable targets, sufficient color contrast, WCAG 2.2 AA where applicable, semantic headings and form labeling. Do not allow parity to be an excuse for excluding accessibility.
- Confirm functional route targets, no exposed PII in public examples, no stale data misrepresented as verified, and no access-control changes.

### PR acceptance scorecard — blocking conditions

| Question | Gate |
|---|---|
| Is the layout from frozen C1 or an owner-approved route extension? | Otherwise BLOCK |
| Did the agent introduce any unreferenced aesthetics? | Otherwise BLOCK |
| Are all brand differences generated only from allowed tokens? | Otherwise BLOCK |
| Have source geometry and non-color computed styles remained invariant when recoloring? | Otherwise BLOCK |
| Does every real interaction still work and remain authorized? | Otherwise BLOCK |
| Have required screenshots, mobile QA and accessibility evidence been attached? | Otherwise BLOCK |
| Has the owner approved any actual design deviations? | Otherwise BLOCK |

## 9. Change control and implementation sequence

**PR0 — Read-only reconnaissance.** Inspect repository architecture, routes, installed UI libraries, current CSS tokens, existing snapshots and actual user journeys. Produce a reference-to-live element map; no refactor yet.

**PR1 — Install the visual lock.** Commit source, images, theme bridge, CSS allowlist, exact parity test, agent instructions and current branded example **without wiring actual product functionality**. Record the source SHA. Review source limitation at 768px.

**PR2 — Landing-page conversion only.** Match exact C1 geometry, typography and composition at target viewports. Replace illustrative data with truthful branded content. Connect real navigation. Add explicit correction for 768px overflow if approved. Test mobile and performance. No backend edits.

**PR3 — Approve application extension archetypes.** Before changing traveler/agency/admin pages, show real screenshot inventories and 1–3 deeply resolved product screen designs for distinct task types. Agree the shared system primitives and route-specific structures. Do not copy marketing hero geometry into authenticated dashboards.

**PR4+ — Component-by-component rollout.** Protect functional journeys and implement only approved archetypes. Each change includes visual parity and interaction checks. No sweeping CSS wildcard rewrite.

## 10. Freeze protocol

- Frozen design file: `reference/CONCEPT1_FROZEN.html`.
- Frozen SHA-256: `894253b7a9d8ebb56abd522d8237a8768476ad98555f779e5efced815d522a10`.
- Palette input: `theme/BRAND_THEMES.json`.
- Allowed override layer: `theme/PALETTE_ONLY.css`.
- Compiler + checker: `qa/build_themed_previews.py`, `qa/verify_lock.py`.
- Evidence: `qa/PARITY_REPORT.json`, reference and theme screenshot files.

**The designer's responsibility is to choose; the coding agent's responsibility is to faithfully implement what was chosen.**
