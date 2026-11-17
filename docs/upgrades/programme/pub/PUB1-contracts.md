# PUB1 contracts: the public site's shared parts

For PUB2 (Home), PUB3 (How It Works, Privacy and Trust), PUB4 (Countries, For Agencies) and PUB5 (verification). Build only from these parts; a change to a signature needs a DECISION to the Guardian. Rules behind them: ADR 0029.

All files live in `apps/web/src/components/public-site/`. Import each file directly (there is no barrel, so a client component never pulls in server-only parts).

| Part | File | Use |
|---|---|---|
| `progressFor({top,height}, vh, offset?)`, `stepFor(p, steps)`, `startScenes(root, {reduce, saveData})`, `SCENES_BOOT_SCRIPT` | `scene-engine.ts` | The scroll engine. Pure, dependency-free, about 1.3 KB gzipped (limit 2 KB). Reads every box, then writes `--p` and `data-step` (the step only when it changes) on `[data-scene]`. The stage pins below the sticky header (`--pub-nav-offset`); the engine reads that line from the stage. The root layout runs `SCENES_BOOT_SCRIPT` (nonce'd) in the head so `html[data-scenes="live"]` is set before the first paint; `stop()` undoes everything. |
| `<ScenesRuntime />` | `scenes-runtime.tsx` | Client. Render once on a page that has scenes. Render it inside the page, not a shared layout (it also restarts on every navigation). Still (no engine) with reduced motion, data saver, below 760 px wide or below 600 px high; restarts when any of those change. Renders nothing. |
| `<Scene name len={1..4} steps finalStep? labelledBy?>` | `scene.tsx` | One scene. The server writes the finished step (`finalStep`, default the last), so no JavaScript still reads complete. Style steps with `[data-step="n"]` and continuous motion with `var(--p)`. |
| `<Chapter tone="dark"\|"light" id? labelledBy?>`, `tonesAlternate(tones)` | `scene.tsx` | A designed section. Tones alternate down a page; test your page's tone list with `tonesAlternate`. A dark chapter carries `data-pub-depth` (its navy glow). |
| `<PublicButton href variant="primary"\|"secondary">` | `public-button.tsx` | 44 px target, chapter colours. Words: today's button labels only. `/app` renders a plain link (it leaves for sign-in). |
| `<DepthGlow />` | `public-picture.tsx` | A soft brand glow behind a hero picture; place it inside a positioned parent. |
| `<StoryCard title body example? level? raised?>` | `story.tsx` | Flat card. `example` adds the Example tag; `raised` adds the approved shadow. |
| `<ExampleTag />` | `story.tsx` | On every illustrative figure, name, date or country list. |
| `<StatusChip status>` | `story.tsx` | `received`, `reviewed`, `suggested`, `confirmed`, `saved`, `shared`, `accessEnded`. The only way to show these words: Received is not Reviewed, Suggested is not Confirmed, Saved is not Shared. |
| `<HeadlineWords>` | `story.tsx` | Headline words in tints of the brand blue. |
| `<ReadinessRing done total size? countLabel?>` | `readiness-ring.tsx` | The product's progress ring, always with "Completeness only. Not an approval." |
| `<FlagRing codes label pageLang?>` | `flag-ring.tsx` | Server only (`import 'server-only'`). Flags from `public/flags`, lazy, named from the public destination catalogue. At most 12 flags (`FLAG_RING_MAX`); each flag's place (`--i`) and the ring's count (`--n`) come from public-site.css, never inline styles (the UI ratchet forbids them). Switch the lit flag with `[data-step]` and `li:nth-child()`. |
| `<PublicPicture src alt width height eager?>` | `public-picture.tsx` | Self-hosted only (throws otherwise), sized, lazy unless `eager`. |
| `<PassportTilt nationality? width? label?>` | `public-picture.tsx` | The real Bangladesh cover (`/pictures/passport-bd.png`) resting raised; tilts with `--p` while its scene moves. |
| `publicText(text, pageLang)` | `public-text.tsx` | English words with no catalogue entry yet; marked `lang="en"` on a Bangla page. |
| `PUBLIC_NAV`, `LIVE_ROUTES`, `publicNavLinks(live?, {signedIn?})` | `public-nav.ts` | The header's five pages. Until /countries ships, a signed-in person's Countries link opens /app/countries (the home picker is for visitors). When your unit ships `/how-it-works`, `/countries` or `/for-agencies`, add the path to `LIVE_ROUTES` in the same PR; the header then links to it. |

## Styles

- `public-site.css` is flat. Tone tokens (`--pub-canvas`, `--pub-ink`, `--pub-ink-soft`, `--pub-accent`, `--pub-words-from`, `--pub-words-to`, `--pub-edge`, `--pub-edge-strong`, `--pub-card`, `--pub-button`, `--pub-button-ink`, `--pub-focus`) are set by the chapter; read only these in your own rules. Outside any chapter every use falls back to the light tone: write `var(--pub-x, <light value>)`, never a bare `var(--pub-x)` (the guard checks each fallback equals the light block). No `:root` rules. Each block starts with a `/* WP-PUB<n> ...` marker line. A pinned stage is one screen high: keep each step's content within one screen at 760 x 600.
- `public-scenes.css` is the ONE depth file. The last part of every selector carries `[data-pub-depth]` itself (never inside `:not()`), so put the attribute on the element that gets the depth; colours only from tokens (mix with black or transparent); movement only `transform` and `opacity`, driven by `--p`, inside `@media (prefers-reduced-motion: no-preference)` and under `html[data-scenes="live"]:not([data-save-data])`; no timed transitions or keyframes. `public-site-guards.test.ts` fails otherwise.
- No colour literal in either file. No `data:` or `blob:` pictures. No em dash.

## Budget

`node scripts/programme/check-public-budget.mjs` after `pnpm --filter @visastack/web build`, and with `--base http://localhost:3100` against a running build: per-route first-load JavaScript at most 10 KB gzipped over main's baseline (a new page is held to Home's figure), engine at most 2 KB, pictures at most 150 KB per page, nothing from another origin.
