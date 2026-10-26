# Provider cost and capacity register

2026-10-11. Application configuration and synthetic tests do not establish provider billing, available free capacity or a promise of zero cost. Review the actual account dashboard and current terms before activation or an upgrade.

| Provider | Evidence currently available | Missing operational reading | Upgrade boundary |
| --- | --- | --- | --- |
| Vercel | Exact deployments, aliases, readiness and protected routes verified | Current function, bandwidth, concurrency and plan usage | Upgrade existing project; retain domains and secret scope |
| Neon | Existing database and encrypted database-only restore verified | Current compute/storage/transfer limits and safe branch capacity | Upgrade same project; preserve identities, Auth and database references |
| Cloudflare R2 | Encrypted archive capture and isolated database restore verified | Total objects/bytes, request counts, egress and billed/free allowance | Retain private EU bucket, keys and adapter contract |
| Cloudflare Workers | Optional fixed-origin scheduler and local security tests | Management access, deployed cadence, actual execution count and plan limits | Separate management access from R2 object keys |
| Resend | Auth SMTP send history and application adapter tests | New branded receipt, application sender/provider, signed events, daily/monthly account headroom | Preserve queue IDs, sender domain and reconciliation |
| GitHub Actions | Actual encrypted backup and isolated restore runs | Available runner minutes and scanner dispatch backlog cost | Measure before frequent polling; keep intake opt-in disabled initially |
| AI provider | Existing optional adapter, cost cap and manual path | Approved actual model/privacy relationship, key, prices, token usage and invoice | Consent, human review and budget remain required |

Optional scheduler estimates: default five-minute notification triggers plus hourly sweeps produce 288 invocations and 312 endpoint requests per day. Enabling intake polling raises requests to 600 and may start Actions runners on empty queues. These are schedule estimates, not measured billing or verified plan compatibility. Existing daily fallback and upload-driven processing remain.

Record each future reading with provider/account identifier, date, unit, used amount, allowance, reset period, warning/hard-stop and artifact. Never include access keys or connection strings. An unavailable reading is unavailable; a configured key is not operational acceptance. Application evidence bytes exclude archive and backup overhead. Application AI cost units do not independently establish a current invoice.

Founding access remains complimentary. Do not assign a paid plan or collect charges as a provider upgrade. Use [the upgrade procedure](../operations/free-to-scale-upgrades.md) and verify actual capacity, rollback and user access. This register does not authorize a paid service.

## AI provider data terms, 2026-10-25

The live record is in Admin, AI Settings (Record Data Terms on each configuration), kept with its
history and audit trail. This table is the team's reading of the public terms on 2026-10-25, to
check before entering it there. "Unverified" means the primary page could not be opened on that
date; read it before relying on the answer. Switching steps: [Switch AI Provider](../operations/runbooks/switch-ai-provider.md).
Legal background: [AI processing review](../legal/ai-processing-review-2026-10-25.md).

| Provider and plan | Plan | May train on inputs | Retention | Region | Terms address | Checked |
| --- | --- | --- | --- | --- | --- | --- |
| Google Gemini API, unpaid quota | Free | Yes (unverified) | Not stated (unverified) | Any country where Google has facilities (unverified) | https://ai.google.dev/gemini-api/terms | 2026-10-25, unverified |
| Google Gemini API, paid | Paid | No (unverified) | "Limited period" for abuse checks (unverified) | Any country where Google has facilities (unverified) | https://ai.google.dev/gemini-api/terms | 2026-10-25, unverified |
| OpenAI API | Paid (usage billed) | No by default since 2023-03-01, unless the organisation opts in to data sharing | Up to 30 days abuse logs; zero retention by approval | United States by default | https://developers.openai.com/api/docs/guides/your-data | 2026-10-25 |
| Anthropic API | Paid (usage billed) | No (Commercial Terms) | Set by the DPA (30 days reported, unverified) | United States by default (unverified) | https://www.anthropic.com/legal/commercial-terms | 2026-10-25 |

Fields recorded per configuration: plan (Free or Paid), may train on inputs (Yes, No, Not Known),
retention in days, region, terms address, date checked, short note. A "No" needs the terms
address. No record reads as "Not Known".

The platform setting "Only Use AI Providers That Do Not Train on Inputs" is off by default (owner
decision 2026-10-25). Off: AI runs on the active provider whatever its terms, and admins are
warned while real applicant data is on. On: only configurations recorded as "No", with the terms
address, are used. Turn it on before charging starts or before any real applicant document can
reach AI, whichever comes first. Moving to a paid plan changes who controls the data afterwards,
not only the bill.
