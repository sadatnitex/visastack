# AI app suggestion tools (S21)

What the three suggestion tools do, their limits, how a person approves what an app left, and how to turn them off. Decision record: ADR 0021, amendment of 30 Oct 2026.

## What they do

A person who connected an AI app (Claude, ChatGPT) and ticked **Suggest Changes** lets that app leave three kinds of thing in VisaStack, only when the person asks the app for it:

| Tool | What it leaves | Where the person sees it |
|---|---|---|
| `suggest_profile_update` | A suggested value for one profile detail, with the app's reason, about the profile itself or about one of the person's documents | My Profile, "Suggestions from AI Apps" (profile suggestions); the document's own review on Documents (document suggestions) |
| `save_draft` | A draft (title and plain text), optionally kept with one case | Sharing, "Drafts from AI Apps" |
| `add_reminder` | A task with a due date on one of the person's own open cases | The case page, Tasks, labelled "Added by <app name>" |

A suggested update changes nothing until the person accepts it. A reminder is added to the case at once, and the person gets VisaStack's usual notices before it is due. A draft is never sent, shared, submitted or used for anything; drafts stay until the person deletes them, also after a case's retention purge. No tool deletes, submits, shares, acknowledges, changes a permission or a case's state, or pays.

Privacy:

- Drafts and AI-added reminders are private to the person. Agencies never see or change them, even on a case they manage.
- A suggestion is never accepted in bulk, never counted as AI use or spend, and never stops the automatic reading of a document.
- The audit records the kind of thing left and the app's address, never the value, reason, title or text.

## Limits

- 15 a day per person, across all their apps and all three tools together, and 15 a day per connection (UTC day windows, `AI_WRITE_ACCOUNT_DAY` and `AI_WRITE_CONNECTION_DAY` in `packages/services/src/rate-limit.ts`).
- The limit that applies is the smaller of the plan's (FREE tier: 15) and the Daily Limit per Person set on the AI Features page. The admin limit can only lower it.
- Only a write that actually saves something counts. The same suggestion again from the same app is answered without writing or counting.
- An app already at either limit is refused before any expensive work (listing documents or resolving a case); the count itself is taken only when something is saved.
- Text limits: field name 64 characters, value and reason 500, draft title and reminder title 120, draft text 20,000. A due date is a real day from today (in the person's own time zone) up to five years ahead.
- Which details: only in a section the person granted; never protected (RESTRICTED) details such as national numbers, legal history or health detail; never special-category or biometric details; a document number only with Full Document Numbers.

## How a person approves

- **Profile suggestions:** My Profile, "Suggestions from AI Apps" (Home shows them as "Suggestions from AI Apps Waiting for You"). Each card shows "Suggested by <app> (<address>)", the app's reason in its own words and the value. The person can change the value, then **Accept**, or **Skip**. When it differs from a confirmed value they choose which is right. An accepted value is saved as confirmed by the person, entered by hand, with no source document.
- **Document suggestions:** the same card in the document's review on Documents.
- **Drafts:** Sharing, "Drafts from AI Apps": **Show Draft**, **Copy Draft**, **Delete Draft**. Drafts stay until the person deletes them, also after a case's retention purge, and they are in the account export.
- **Reminders:** the case's Tasks: **Start**, **Done**, **Cancel**, as for any task.

## How to turn it off

1. **For everyone (platform owner):** Admin, Settings, **AI Features** (`/app/admin/ai`), untick **On for Everyone** for AI App Suggestions, Save, then confirm with a fresh sign-in. What was typed is kept for 15 minutes in a signed cookie for that page only, so the form comes back filled with "Your change was not saved yet."; choose Save again. A link can never fill the form. AI App Suggestions is **off by default** until the owner turns it on there.
   - The tools then refuse with "This AI feature is turned off right now. Everything else works as usual. Nothing was saved."
   - The consent box stays visible, turned off and unticked, with the same sentence. A link can never pre-tick it, and while the feature is off nobody can turn it on for an app.
   - On Change Access, an app that already had Suggest Changes keeps it ("Your choice is kept for when it is turned on again."), and the person can still untick it. Change Access always starts this box from what the connection has stored, never from a link, also after its fresh sign-in check.
   - Pending suggestions, drafts and reminders stay where they are, and every other feature keeps working.
   - Turning it on again loses nothing, including a person's earlier Suggest Changes choice.
2. **For one app (the person):** Sharing, AI Connections, **Change Access**, untick Suggest Changes; or **Turn Off** the connection. The next call is refused.
3. **The whole connector:** `AI_CONNECTOR_ENABLED` (see the AI connector notes in `docs/operations/current-platform.md`).

## Before it works in production

- Migration 0105 must run (owner action O8). Before it, the tools answer "not available yet", the AI Features page says it is not available yet, and nothing else changes.
- Then the platform owner turns AI App Suggestions on in AI Features.

## Account export

- Drafts, tasks, which tasks an AI app added, and AI connections (never tokens) are in the account export.
- Every CSV cell is formula-safe (`csvCell` in `@visastack/core`): text starting with `=`, `+`, `-`, `@`, a tab or a carriage return (also after spaces) is prefixed with an apostrophe, so it opens as text. Some spreadsheets show that apostrophe.

## Checks

- Service tests: `packages/services/src/ai-tools/suggestion-tools.test.ts`, `tool-guard.test.ts`, `packages/services/src/ai-feature-settings.test.ts`, `packages/services/src/ai-suggestions.test.ts`.
- Migration test: `packages/db/src/ai-suggestions-migration.test.ts`.
- What an app sees: `apps/web/src/lib/mcp-endpoint.test.ts` (tools/list, server instruction).
