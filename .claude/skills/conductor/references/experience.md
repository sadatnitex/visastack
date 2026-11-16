# Experience standard (load only for visible work)

Precedence: the repository's current brand and design contract at HEAD always wins, newest dated owner decision first (VisaStack: docs/uiux/DESIGN-CONTRACT.md and the approved mockup PDF, flat refinement, scroll budget, plain-language rules. Corridra: docs/agents/ui-direction.md, UI/UX.v3, the AC/1 brand lock, .claude/skills/corridra-brand and the design-system guard test), then the latest published guidelines of any external platform the product ships on (verify at use). Build only inside the governing sections the plan packet names. This file is the universal floor and the ambition above it. Where a standard below has a version, check its current status at use.

## 1. Principles for every screen

1. One clear next step. One primary action per state. The person always knows where they are, what just happened and what comes next (Nielsen: visibility of system status, recognition over recall).
2. Low cognitive load. One job per screen, progressive disclosure, right defaults, few choices (Hick), short chunks (Miller), familiar patterns (Jakob).
3. Speed is a feature. Feedback under 400 ms (Doherty). Core Web Vitals at the 75th percentile: LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less. Skeletons over spinners, optimistic updates where reversible, designed for slow networks and low-end phones.
4. Accessible by default. WCAG 2.2 AA minimum, full keyboard use, screen-reader names, contrast, never colour alone, reduced-motion respected, touch targets 44 px or more, no cognitive-test sign-in. Applies in law too (for example the EU accessibility act in force since June 2025).
5. Persuade at full strength, never deceive. Allowed and encouraged: strong calls to action, defaults that favour the outcome we want, anchoring, real urgency, real social proof, risk reversal, persistent follow-up. Hard lines, because they are illegal in the markets we serve, trigger chargebacks and bans, and destroy trust in a document product: no fake urgency or scarcity, no invented numbers, reviews or testimonials, no hidden costs, no cancel traps, no guarantees we cannot honor, no confirmshaming, no false claims aimed at a person's fear. A person approves what AI suggests and can see why.
6. Consistent. One design system, same pattern means same behaviour, platform conventions respected (Apple HIG, Material).
7. Global and inclusive. Plain words, grade-8 reading level, localizable (Bengali in progress), right-to-left safe layout, any name, date and number format, low bandwidth.
8. Emotionally right (Norman: visceral, behavioural, reflective). Calm and confident where the person is anxious, quick and light where they are busy.

## 2. Wow and hook, at full strength

Wow is delight that moves the number, never decoration.
- One magic moment per product area: the point where the product does what the person expected to do by hand (for example one upload and the profile fills itself). Time to first value under 60 seconds.
- Peak and end (Kahneman): design the best moment and the last moment, such as the completion screen, with care.
- Progress is the reward (goal gradient, Zeigarnik): visible progress, resumable work, a finished state that feels earned.
- Hook loop (Eyal, Fogg B=MAP): a relevant trigger, the smallest possible action, a real reward (insight, progress, a done task), an investment that makes next time easier (saved profile, saved documents). Triggers are persistent and multi-channel (in-product, email, WhatsApp where the person opted in), timed from data, with an easy off switch because the law requires one.
- In high-stakes domains such as visas, reassurance and momentum convert best. Measure activation and completion, not time spent.
- Craft that people feel: a strict type scale, a 4 or 8 pt spacing rhythm, motion of 150 to 300 ms with a purpose and ease-out entrances, empty states that teach the next step, microcopy with a voice.
- Current directions worth knowing, never at the cost of the repository contract: AI-native patterns (suggest, cite the source, show confidence, approve, undo), keyboard-first power use (command palette), personalization the person controls, platform design shifts (Apple's Liquid Glass, Material 3 Expressive).

## 3. By type of work

| Work | Golden checks |
|---|---|
| Public landing | 5-second test: what it is, who it is for, what to do. One call to action. Proof, never invented claims or testimonials. Fast LCP. |
| First run and onboarding | Time to value. Ask only what is needed now, the rest later. No dead ends. Progress saved. |
| Forms | One column, labels above, validate after leaving a field, accept messy input, autofill, errors say how to fix, never lose typed input, draft saved, say why each thing is asked. |
| Data and dashboards | Answer first, clear hierarchy, honest empty, loading and error states, sortable and filterable tables, real data only, no vanity figures. Charts follow the dataviz skill. |
| Upload and documents | Drag and drop plus camera, visible progress, resumable, preview, accepted formats stated, privacy reassurance, graceful failure, never fake a reading. |
| AI features | Human decides. Source and confidence shown. What will change is stated. Undo. Graceful failure. No claim beyond what is real. |
| Settings, privacy, sharing | Safe defaults, plain consequences, revocable, history visible. |
| Notifications and email | Relevant, well timed, one action, controls to tune or stop. |
| Navigation and structure | Few top-level places, always findable, search, wayfinding, consistent names. |
| Every state | Empty, loading, partial, offline, error, denied, success. All designed, none left as a blank or a raw error. |
| Mobile and weak network | Thumb reach, 44 px targets, survives dropped connections, no layout shift. |
| Copy | Plain, active, concrete. No jargon, no em dashes. Same word for the same thing everywhere. |

## 4. Sales and conversion

Every sales-touching change names the metric it moves and ships with a way to measure it.
- Funnel: visit to signup to activated to paid to retained to referring. Each step has an event, a number and an owner. Find the biggest leak first.
- Pricing: three tiers, the one we want marked recommended, annual priced to win, anchored by a higher tier, a clear free or trial entry, no surprise fees. Pricing and checkout are Class A.
- Real urgency only: true deadlines, such as an appointment date, a document expiry or a processing time. Show it with the date.
- Real proof only: actual counts, actual outcomes, named when allowed. If we have none yet, show none and lead with the product demo.
- Risk reversal: a guarantee, a refund or a free first case, only if the business honors it.
- Objections answered where they arise: price, safety of documents, time, what happens if it fails.
- Checkout: fewest fields, local payment methods first, wallets, saved details, and an obvious way back.
- Speed to lead: first reply within 5 minutes. Abandoned flows are followed up by email and message the same day. Win-back runs on a schedule.
- Activation to paid: the upgrade prompt appears at the moment of proven value (a ready file, a passed readiness check), not before.
- Referral and sharing loops built into the happy path.
- Experiments: behind flags, one change at a time, a stated hypothesis, a sample size, guardrail metrics (refunds, support load, cancellations). Ship winners, delete losers and their code.
- Copy: benefit first, specific numbers, short, one call to action.

## 5. Proof (no taste arguments)

Every visible PR carries, and the Guardian checks:
1. Screenshots at 360, 768 and 1280 px, in every theme the product has, and each state from the table above.
2. A keyboard-only pass, screen-reader names, contrast, reduced motion, checked.
3. Speed measured on a production build, never a dev server.
4. The one job of the screen and the 5-second answer, written in the PR.
5. The one experience moment this change improves and how it was verified, or the words "no experience change". Decoration without a purpose is rejected.
6. The repository's design guard tests pass.
7. Reviews by fresh context: `design:accessibility-review` on every visible change, `design:design-critique` when layout or hierarchy changes, `design:ux-copy` when words change, `design:design-system` when tokens or components change.
