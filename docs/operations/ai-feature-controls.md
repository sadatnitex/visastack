# AI Feature Controls (S28)

Every AI feature in VisaStack has a switch, a plan rule and a daily limit. AI is additive: with every switch off, people still add their details, upload and check files, open cases, see readiness, share with agencies and decide earlier suggestions. Nothing they already have is removed.

Where: **Admin > Settings > AI Settings** (`/app/admin/ai`). The old address `/app/admin/ai-settings` sends people there.

- **AI Features** section: the platform owner only (`AI_FEATURES_MANAGE`). Each save needs a fresh sign-in check and is recorded in the audit (`AI_FEATURE_SETTING_UPDATED`, before and after).
- **AI Providers**, **Data Terms** and **AI Apps** sections: security admins (`AI_SETTINGS_MANAGE`), as before on the old AI Settings page.

## What each switch does

| Feature | What it does | Standard setting | Counted per | Off state |
|---|---|---|---|---|
| Automatic Reading | Reads a new file by itself after upload and suggests details | On, no daily limit | file | The upload works and opens for review; the document says "Automatic Reading is turned off right now"; Read with AI is still offered if it is on |
| Read with AI | A person asks for a file to be read (Read Again, a scan, then its details) | On, no daily limit | file | The hint replaces Read Again; earlier suggestions stay to accept or skip |
| Document Kind Suggestions | Suggests the kind of document and a name | On, no daily limit | suggestion | The hint replaces the button; the person chooses the kind themselves |
| Gap Explanations | Explains why something a case needs is missing | On, no daily limit | explanation | The hint replaces Explain This with AI; an earlier explanation stays readable |
| Consistency Checks | Compares a file with confirmed details | On, no daily limit | check | The hint replaces the button; earlier flags stay to acknowledge or dismiss |
| AI App Access | AI apps a person connected read what the person chose | On, no daily limit | request (answer given) | Apps are told plainly that AI apps cannot read VisaStack right now; connections stay listed and can be changed or turned off |
| AI App Suggestions (S21) | Apps leave suggestions, drafts and reminders | Off, 15 a day | suggestion | Unchanged from S21 |
| AI App Original Files (S20) | Apps receive ticked files | Off, 30 a day | file | Unchanged from S20 |

The hint is one sentence: "This AI feature is turned off right now. Everything else works as usual." When today's limit is used up: "You have reached today's limit for this AI feature. It starts again at 6 AM Bangladesh time. Everything else works as usual."

## The standard settings

The six features that worked before S28 are on, included in the Traveller plan and counted without a limit, so nothing changes for anyone on deploy. A feature with no saved setting uses its standard setting; so does every feature before the settings table exists (the page says so).

## Precedence: which reason wins

A feature works for a person only when all of these hold, checked in this order; the first that fails is the reason shown:

1. **Platform**: for features that call a model, the deployment can run AI (the environment switch or an active provider) and the provider kill switch is not thrown; for AI apps, connecting AI apps is switched on (`AI_CONNECTOR_ENABLED`).
2. **Storage** is in place (only S21 and S20 have their own tables).
3. **Admin switch** (AI Features section) is on.
4. **Plan**: the person's plan includes it (Plans page, `ai.<feature>` rule; no rule means the standard: included).
5. **Daily limit**: today's count is below the smaller of the plan's limit and the admin's limit.

After that the service still checks the person's own AI consent, then the spend, attempt, page and hourly limits. Those are unchanged.

## The day boundary

Each use is counted per UTC day. A day starts at midnight UTC, which is 6 AM in Bangladesh, so limits start again at 6 AM Bangladesh time. The AI Use Today card on **Privacy & Consent** shows each person their own counts and when limits start again. Only the number is kept, never what was read.

## How to set limits

- **For everyone on a plan:** Admin > Settings > Plans, open the plan, set the AI feature's daily limit (or untick it to leave it out of the plan). Today every traveller is on Traveller Free. Agency plans carry no AI rules yet (S22).
- **Lower it for everyone:** AI Settings > AI Features, type a Daily Limit per Person. A number here can only lower the plan's limit, never raise it. Leave it empty to use the plan's.
- **Turn it off for everyone:** untick On for Everyone and save.

What counts as one use:

- A model feature is counted only when a real call is about to be made: a reading served from the cache, a refusal or a fallback to the second provider is free.
- One file read by Automatic Reading counts once, even when it is read as a scan and then for its details.
- AI App Access counts each answer an app is given; a refused call is given back.

## Not changed

- `AI_ENABLED` keeps its meaning: it governs only the environment provider on a fresh install. Whether it should also stop a database-configured provider is decision O3 for the owner.
- AI Allowance (`ai_allowance_units`) stays shown only, never enforced for travellers (O5).
- No database migration. The counts use the existing `rate_limit_buckets` table; old buckets are pruned by the existing job after 48 hours.

## Round 2 changes (30 Oct 2026)

- **Plans page:** an AI feature that is on may have an empty daily limit. Empty means no plan limit; the Daily Limit per Person on AI Settings > AI Features still applies (AI App Suggestions and AI App Original Files also keep their built-in 15 and 30). A limit typed for a feature that is off is still refused. Traveller Free saves again with its six features on and no plan limit.
- **One file, one use:** a scan returns proof that it counted the file. Only that proof, for the same file, person, feature and day and used once, lets the reading of the file's details go uncounted (Automatic Reading and Read Again alike). A scan served from earlier work counts nothing and gives no proof, so the details are counted. When the details are refused for a moment (busy) after a counted scan, the scan's count is given back, so the queue's retry, or the person trying again, counts the file once.
- **Only real calls count:** a call the kill switch stops after it was counted is given back, for every kind of AI call.
- **AI App Access:** with a daily limit it is counted as the call starts (as before). With no limit it is counted after the call, in a statement of its own, so one person's calls never wait on each other.
- **AI Use Today:** all counts are read in one query, and AI App Suggestions and AI App Original Files show Limit Reached when their limit is used up.
- **Day boundary wording:** people see "Daily limits start again at 6 AM Bangladesh time." A file Automatic Reading skipped for the limit says it was not read and to choose Read Again after 6 AM Bangladesh time; it is not read again by itself.

## Round 3 changes (30 Oct 2026)

This replaces the round 2 "one file, one use" note above.

- **One file, one use, read from the database:** a scan that made a real model call is always counted and is never given back, even when the details are then refused or the job fails. The details of the same file are not counted when the file's scan record shows a counted scan for the record's owner in the current UTC day or the last 15 minutes (a scan at 23:59 UTC and its details at 00:01 count once). The counted scan is the first provider's run: never a reading served from earlier work, and never one the kill switch stopped. When the first provider times out and a second one answers, the first run stays counted and covers the details. This holds across separate clicks, Read Again, queue retries and separate server processes, with nothing kept in memory and nothing a caller can claim.
- **Giving a use back:** only once per use, marked as given back only after the database took it; a failed give-back can be tried again. It goes back to the day it was counted in.
- **AI App Access:** a count after the call that cannot be written is reported as a server error; the app still gets its answer.
- **Consent screen:** one sentence per reason, naming AI App Access: not part of your plan, turned off right now, not available yet, or today's limit reached. The line that the app can still connect stays.
