# Agency brand kit: direction

Status: direction only. The first step (agency name, one accent, a logo shown properly on screen) is built. Nothing below beyond that is built yet, and no database change is made for it.

## Why

An agency decides to use VisaStack partly by how it looks to its own customers. The workspace header, the invitation a traveller receives and, next, every document an agency hands to a customer should look like the agency, with "Powered by VisaStack" always present beside it.

## What exists now

- One brand description for an agency (`apps/web/src/lib/agency-brand.ts`): name, initials, accent, the text colour that stays readable on the accent, a soft tint, and the logo address. Screens and, later, documents take their values from here, so one change of accent or logo reaches all of them.
- The logo is served by a dedicated same-origin route (`/api/branding/logo/[orgId]`, signed-in only, safety-scanned file, checked type, no-sniff and sandbox headers). The old route needed a document access token, which is why the logo showed as a broken picture.
- A mark that never shows a broken picture: logo on a white tile, or the agency's initials on its accent.

## Where it goes next (not built)

| Piece | What it is | Notes |
|---|---|---|
| Brand profile | Logo (light and dark versions), accent plus one secondary colour, contact block, address, registration line, footer text, signature | Extends the existing three organisation fields; needs a migration, so it needs the owner's go-ahead for that run |
| Document templates | Letters, checklists, cover sheets, invoices, quotation sheets, welcome packs | Each template is data (blocks with fields), not code, so an agency can arrange and rename them |
| Categories | Template groups such as Client letters, Checklists, Billing, Embassy support | Agency-defined, with a few built-in starters |
| Personalisation | Fields filled from the traveller, case and agency (name, route, dates, missing documents, consultant) | Only fields the agency is already allowed to see under its sharing grant |
| Output | PDF first, then editable download | Generated on the server from the brand profile; the generated file is stored like any other file and scanned |
| Guardrails | "Powered by VisaStack" footer always present; accent must pass the reading check; logo must pass the safety scan | Same rules as the screen |

## Decisions to take before building

1. Whether templates are shared between all staff or per person (recommended: shared, with an owner/admin who can edit).
2. Whether a generated document is saved to the traveller's vault, to the agency only, or both (recommended: agency only, with an explicit "send to traveller").
3. Languages: English only until the owner lifts the deferral.
