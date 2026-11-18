# R1 shared picture kit: contract

Owner: R1 builder (Home rebuild). Consumers: R2 to R5 (How It Works, Privacy and Trust, Countries, For Agencies). Written before the build so the other pages can compose by name. Anything marked "may change" changes only by a message to the Guardian.

Location: `apps/web/src/components/public-site/kit/`. Import from `kit/index.ts` (named exports only). Stylesheet: `kit/kit.css`, loaded by the kit itself (each component imports it), flat only (no gradient, shadow or translucent surface; depth stays in `public-scenes.css` behind `[data-pub-depth]`). Colours are globals.css tokens only: navy `--chapter-bg` / `--text` family, accent `--accent` and `--brand-tint-N`, `--ok` only for done or on. No cyan, mint or `#3c7bf0`.

## Rules every part follows

1. Server components, typed props, no client JavaScript, except `RiseIn` and `ShareSheet mode="timed"` (small client parts).
2. State comes from the nearest `.pub-scene[data-step]` (the existing engine writes `data-step` and `--p`). The server writes the FINISHED step, so no JavaScript, reduced motion, data saver and phones show every picture complete and still.
3. A part that follows a scene takes no `step` prop. A part used outside a scene (a still picture, another page's own timing) takes `step` and then ignores the scene.
4. Words inside a picture are English Example text. The page passes `pageLang`; on a Bangla page the figure is marked `lang="en"` (WCAG 3.1.2). Every part that shows made-up figures renders the Example tag itself (`example` prop, default true).
5. Every control or pointer target is 44 px at least. Nothing in a picture is a control unless stated.
6. Truthful words only: `Suggested` is not `Confirmed`, `Saved` is not `Shared`, a ring is completeness (the words "Completeness only. Not an approval." travel with every ring that counts a case).

## Parts

```ts
type Tone = 'light' | 'dark';
type DocKind = 'passport' | 'photo' | 'flight' | 'insurance' | 'itinerary' | 'bank' | 'hotel' | 'invitation';
// DocKind is the set the Document pictures already draw (components/pictures DocumentPicture).

SegmentRing({ filled: number; total?: number /* 8 */; label?: string; tone?: Tone; size?: number /* px, 96 */;
              steps?: readonly { filled: number; label?: string }[]; pageLang?: string })
```
Eight arcs with gaps, clockwise from the top. The centre reads `filled/total` in a readable ink on both tones (dark tone: white numerals on the navy chapter; the ring never sits on a light tint). `steps` makes it follow a scene: one group per scene step, the one matching `data-step` shows. `label` is the words beside it, for example `5 of 8 Ready`; it is rendered as text next to the ring and the SVG itself is `aria-hidden`.

```ts
DocumentDeck({ docs: readonly { kind: DocKind; name: string }[]; hero?: DocKind /* centre */; pageLang?: string })
```
Five drawings. Scene-driven: scattered at progress 0, fanned into a deck around the hero at progress 0.85 and later (CSS from the scene's `--p`, transform and opacity only). Still (no scene or finished): the fanned deck. Pictures come from `DocumentPicture`, so no new artwork and no data or blob images.

```ts
ScanPhone({ fields: readonly { label: string; value: string }[]; step?: 0 | 1 | 2; pageLang?: string })
```
A phone: step 0 camera with a scan line over the passport, step 1 fields appear with the `Suggested` chip, step 2 the chips flip to `Confirmed`. Finished = step 2. Footer line `Example record.`; the part renders its own Example tag.

```ts
CountryChecklistPanel({ countries: readonly { code: string; name: string; have: readonly boolean[] }[];
                        items: readonly { kind: DocKind; label: string }[]; active?: number; pageLang?: string })
```
Tabs with real flags (`/flags/<code>.svg`, self-hosted), a `SegmentRing` for the active country, and one row per item with `Reused` or `To add`. `have[i]` pairs with `items[i]`. Follows a scene whose steps equal `countries.length`; `active` pins one country for a still use.

```ts
JourneyTrack({ stages: readonly { name: string; icon: IconName; actor: 'You' | 'Agency' | 'Embassy'; note: string }[];
               current?: number; pageLang?: string })
```
A node track that fills as the scene advances (scene steps = `stages.length`), and one card below naming who acts. Stage names must be the product's real stage words (the page passes them) or the part is tagged Example. Finished = the last stage current.

```ts
ShareSheet({ mode: 'scroll' | 'timed'; step?: 0 | 1 | 2 | 3 | 4; pageLang?: string })
```
Five steps: 0 nothing leaves, 1 choose a document and part, 2 add what the agency needs, 3 set an end date, 4 `Access ended` overlay. `scroll` follows the scene (5 steps); `timed` cycles every 2.2 s by itself (client part, still under reduced motion: step 4 shown finished, no timer). `step` pins one still state. "Saved is not Shared": the toggles say `Not shared` until switched on.

```ts
CasesTable({ rows: readonly { name: string; code: string; country: string; filled: number; missing: number | 'Complete'; status: string }[];
             pageLang?: string })
```
Rows with a flag, `SegmentRing` (size 46), the missing count and a status word. Example tag included. Rows rise in through `RiseIn`.

```ts
ClosingBand({ title: ReactNode; sub: ReactNode; actions: ReactNode; passport?: boolean /* true */; nationality?: string /* 'BD' */ })
```
A dark chapter closing band: title, one sentence, the page's own buttons (`PublicButton`), the real Bangladesh passport PNG floating (`PassportTilt`). The page owns the labels and links; the band never invents them.

```ts
RiseIn({ children: ReactNode; delay?: number /* 0-0.4 s */; as?: 'div' | 'li' | 'article' })
```
Shared rise-in on scroll. Visible with no JavaScript, reduced motion, data saver, phones (it only hides while `html[data-scenes="live"]`, which the early mark sets before the first paint).

## Scene engine change (R1)

- `Scene` takes an optional `fit` (default true): the stage is sized by its steps, never a bare `100svh` with an empty bottom. Pinned stages are centred (`align-content: center`) and the scroll length is `max(len, steps * 0.75)` screens. Pages keep calling `<Scene name len steps>` unchanged.
- Existing parts stay as they are: `Scene`, `Chapter`, `FlagRing`, `CountryFlag`, `ExampleTag`, `StatusChip`, `StoryCard`, `HeadlineWords`, `PublicButton`, `PassportTilt`, `DepthGlow`.

## Page composition rule (all five pages)

Header, then chapters in the order the reference shows, then footer. Dark and light chapters alternate. A pinned chapter carries one `h2`; a still chapter carries one `h2`. No other stack of cards between them.

## Gallery

`/dev` is not used. Each part has a fixture in `kit/fixtures.tsx` (named exports, plain data) that its unit test renders and the fidelity spec reads, so the kit has one example of every state.
