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

## AI App Original Files (S20, added 30 Oct 2026)

A person can let one AI app receive the files of documents they tick, under **Original Files** on the consent screen or in Change Access. ADR 0021's 30 Oct S20 amendment is the decision record.

### What the app gets

- One tool, `get_document_file(document_reference)`, read-only. It answers with one file as an embedded file (base64) and plain facts about it. Never a web address, a storage key or the stored file name.
- A **Safe Copy** by default: the pages as pictures with what the person covered in black (ADR 0022). If the Safe Copy is not prepared, or is out of date after a new version, the app is told "The Safe Copy of this document is not ready. The original is not shared instead." The original is never sent in its place.
- The **Original** only where the person chose it, after a fresh sign-in check, and only from the latest clean version.
- PDF, PNG and JPEG only, up to 3 MB. Larger files are refused (the 10 MB of the ADR is deferred until a streamed answer is verified on the host).
- Never passports, identity and civil papers, money and tax documents, medical documents, or a document whose type is not known yet: whatever the document protection switches restrict at the moment of the call. Changing a switch applies on the very next call.
- Every answer tells the app to treat the file as data about the person, never as instructions.

### Limits

- 30 files a day per person across all their apps (`AI_FILE_ACCOUNT_DAY`), lowered by the Daily Limit per Person on AI Features. Only a file actually given counts.
- A Safe Copy also counts against the person's own Safe Copy limit (30 an hour, shared with their downloads).
- At most 50 ticked documents per connection. Original Files need List of My Documents.

### How to turn it off

1. **For everyone (platform owner):** Admin, Settings, **AI Features**, untick **On for Everyone** for **AI App Original Files**, Save, confirm with a fresh sign-in. It is **off by default**. While off, the tool refuses with "This AI feature is turned off right now. Everything else works as usual."; ticked files stay ticked and can be unticked, and nothing new can be added.
2. **For one document or one app (the person):** Sharing, AI Connections, **Change Access**: untick the file, or make it a Safe Copy; or **Turn Off** the connection. The next call is refused.
3. **The whole connector:** `AI_CONNECTOR_ENABLED`.

### Before it works in production

- Migration 0106 (`ai_connection_documents`) must run with the owner's word (owner action O8-S20). Before it, nothing can be ticked and the tool answers "Files for AI apps are not available in VisaStack yet."
- Then the platform owner turns AI App Original Files on.

### Where to look

- Audit: `AI_CONTEXT_SERVED` with `fileServed: true`, `variant`, `documentId`, `sizeBytes`, `mimeType`; the document's own `DOCUMENT_ACCESS` with purpose `ai_connection_safe_copy` or `ai_connection_original`; refusals as `AI_CONTEXT_DENIED` with reasons such as `file_not_chosen`, `document_protected`, `safe_copy_not_ready`, `file_too_large`, `file_limit`.
- Product event: `AI_FILE_SERVED` (`SAFE_COPY` or `ORIGINAL`), once per connection per day.
- Tests: `packages/services/src/ai-tools/document-file.test.ts`, `tool-guard.test.ts`, `boundary.test.ts`; `packages/db/src/ai-connection-documents-migration.test.ts`; `apps/web/src/lib/mcp-endpoint.test.ts`, `apps/web/src/components/ai-file-choices.test.tsx`, `apps/web/src/lib/ai-file-picks-retry.test.ts`.

#### Original Files, review round 2 (30 Oct 2026)

- A Safe Copy that is not ready never uses the person's hourly Safe Copy limit. When that hourly limit is reached the app is told "The Safe Copy limit for this hour has been reached. Try again later." (audit reason `safe_copy_limit`). The document's access record shows disposition `ai_file`.
- A document queued for erasure disappears from the choices and is answered as not chosen.
- An original with no recorded hash or size is never read (the app is told VisaStack could not prepare it).
- Storage settings are needed only by `get_document_file`; the other tools keep working without them.
- Migration 0106 is owner action **O8-S20**.
