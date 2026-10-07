# Screen preview: see every screen with realistic data

A dev tool (never part of the product) that shows what every screen looks like with data in it, before real data exists.

Run: `pnpm --filter @visastack/web preview` (seed and render, then screenshot and check, then contact sheets). Output goes to `apps/web/.preview/` (not committed): `html/` (each page), `shots/` (phone and desktop screenshots, plus dark and tablet for the busiest pages), `sheets/` (many pages on one image), `report.md` (what to look at).

## What "mock data" means here

It is assumed data, not fixed text in the product. The tool seeds a throwaway in-memory database with a made-up world through the product's real tables and rules, then renders the product's real pages (inside their real layouts) against it. The product's own code decides what each page shows, so if a page changes, or real data looks different, the preview changes with it. Nothing in the product reads from the preview.

The world (`apps/web/preview/world.ts`) is chosen to stress layouts:

- **Rahim**, a busy traveller: five people on the account (including a 56-character name and a Bangla name), nine documents (passport expiring in 27 days, insurance expired, a file held for safety, a very long file name), a partly filled profile, three cases, evidence requests in four states (one overdue), grants in four states, alerts read and unread, and a share from another traveller.
- **Shirin**, a new traveller who has consented but added nothing; **Imran**, who has not consented yet.
- **Dhaka Visa Desk**: an agency with an owner, an admin, a case manager and a reviewer, fifteen cases across seven stages, overdue tasks, open requests, unassigned cases. **Padma Travel**: a brand-new agency with nothing. **Meghna Global**: an agency waiting for verification.
- A platform administrator.

## What it checks on every page, at phone and desktop width

Sideways overflow, anything past the screen edge, clipped text, form fields not using the shared style, headings, and accessibility (including colour contrast) in the real stylesheet. It also fails when a page file exists with no scenario, so a new page cannot be missed.

## Limits

Pages are rendered once, as static pages: nothing is clicked and no script runs. Pages that need a one-off link (invitation and contributor links, snapshots, pack diffs) are listed in `NEEDS_A_TOKEN` and are not rendered. Bangla pages show Bangla letters in the right font, but most Bangla wording is not written yet (deferred).
