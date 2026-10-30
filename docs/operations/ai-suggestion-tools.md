# AI app suggestion tools (S21)

What the three suggestion tools do, their limits, how a person approves what an app left, and how to turn them off. Decision record: ADR 0021, amendment of 30 Oct 2026.

## What they do

A person who connected an AI app (Claude, ChatGPT) and ticked **Suggest Changes** lets that app leave three kinds of thing in VisaStack, only when the person asks the app for it:

| Tool | What it leaves | Where the person sees it |
|---|---|---|
| `suggest_profile_update` | A suggested value for one profile detail, with the app's reason, about the profile itself or about one of the person's documents | My Profile, "Suggestions from AI Apps" (profile suggestions); the document's own review on Documents (document suggestions) |
| `save_draft` | A draft (title and plain text), optionally kept with one case | Sharing, "Drafts from AI Apps" |
| `add_reminder` | A task with a due date on one of the person's own open cases | The case page, Tasks, labelled "Added by <app name>" |

Nothing in the record changes until the person accepts a suggestion. A draft is never sent, shared, submitted or used for anything. No tool deletes, submits, shares, acknowledges, changes a permission or a case's state, or pays.

Privacy:

- Drafts and AI-added reminders are private to the person. Agencies never see or change them, even on a case they manage.
- A suggestion is never accepted in bulk, never counted as AI use or spend, and never stops the automatic reading of a document.
- The audit records the kind of thing left and the app's address, never the value, reason, title or text.

## Limits

- 15 a day per person, across all their apps and all three tools together, and 15 a day per connection (UTC day windows, `AI_WRITE_ACCOUNT_DAY` and `AI_WRITE_CONNECTION_DAY` in `packages/services/src/rate-limit.ts`).
- The limit that applies is the smaller of the plan's (FREE tier: 15) and the Daily Limit per Person set on the AI Features page. The admin limit can only lower it.
- Only a write that actually saves something counts. The same suggestion again from the same app is answered without writing or counting.
- Text limits: field name 64 characters, value and reason 500, draft title and reminder title 120, draft text 20,000. A due date is a real day from today (in the person's own time zone) up to five years ahead.
- Which details: only in a section the person granted; never protected (RESTRICTED) details such as national numbers, legal history or health detail; never special-category or biometric details; a document number only with Full Document Numbers.

## How a person approves

- **Profile suggestions:** My Profile, "Suggestions from AI Apps". Each card shows "Suggested by <app> (<address>)", the app's reason in its own words and the value. The person can change the value, then **Accept**, or **Skip**. When it differs from a confirmed value they choose which is right. An accepted value is saved as confirmed by the person, entered by hand, with no source document.
- **Document suggestions:** the same card in the document's review on Documents.
- **Drafts:** Sharing, "Drafts from AI Apps": **Show Draft**, **Copy Draft**, **Delete Draft**.
- **Reminders:** the case's Tasks: **Start**, **Done**, **Cancel**, as for any task.

## How to turn it off

1. **For everyone (platform owner):** Admin, Settings, **AI Features** (`/app/admin/ai`), untick **On** for AI App Suggestions, Save, then confirm with a fresh sign-in. AI App Suggestions is **off by default** until the owner turns it on there.
   - The tools then refuse with "This AI feature is turned off right now. Everything else works as usual. Nothing was saved."
   - The consent box stays visible, turned off, with the same sentence.
   - Pending suggestions, drafts and reminders stay where they are, and every other feature keeps working.
   - Turning it on again loses nothing, including a person's earlier Suggest Changes choice.
2. **For one app (the person):** Sharing, AI Connections, **Change Access**, untick Suggest Changes; or **Turn Off** the connection. The next call is refused.
3. **The whole connector:** `AI_CONNECTOR_ENABLED` (see the AI connector notes in `docs/operations/current-platform.md`).

## Before it works in production

- Migration 0104 must run (owner action O8). Before it, the tools answer "not available yet", the AI Features page says it is not available yet, and nothing else changes.
- Then the platform owner turns AI App Suggestions on in AI Features.

## Checks

- Service tests: `packages/services/src/ai-tools/suggestion-tools.test.ts`, `tool-guard.test.ts`, `packages/services/src/ai-feature-settings.test.ts`, `packages/services/src/ai-suggestions.test.ts`.
- Migration test: `packages/db/src/ai-suggestions-migration.test.ts`.
- What an app sees: `apps/web/src/lib/mcp-endpoint.test.ts` (tools/list, server instruction).
