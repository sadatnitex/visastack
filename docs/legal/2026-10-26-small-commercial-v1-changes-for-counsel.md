# Small Commercial V1: changes for legal review (brief for counsel)

Prepared 26 Oct 2026 for VisaStack's lawyer. This is not legal advice and not final wording. It lists what VisaStack will do with personal data once the Small Commercial V1 plan is built, so that counsel can update the privacy notice (current version 2026-10-11.1), the terms (current version 2026-10-10.1) and any agency agreement. Real applicant data stays switched off until counsel's wording is approved (owner action O10).

Technical sources: ADRs 0019 to 0022 and `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md`.

## 1. Automatic document reading (ADR 0019)

| Topic | Fact |
|---|---|
| What changes | After upload, VisaStack reads documents without a button press |
| How documents are read | It reads the passport's machine-readable lines and runs on-platform text recognition, without any outside AI service |
| When outside AI is used | Only if the person has switched on "Let AI read my documents", and only when the platform readers found nothing usable |
| Data sent to the AI provider | Page images or extracted text |
| Processors | The active AI provider (OpenAI, Anthropic or Google, chosen by the platform owner, with recorded data terms); the scanning worker runs on GitHub Actions (Microsoft) |
| Result | Suggestions only. Nothing is saved to the person's record until they confirm |
| Questions for counsel | Wording of the consent switch; whether automatic reading after upload needs its own notice line; disclosure of the GitHub Actions processing location |

## 2. Payments (ADR 0020)

| Topic | Fact |
|---|---|
| Who pays | Agencies (organizations) pay invoices. Travellers are never invoiced |
| Processors | SSLCOMMERZ (Bangladesh), and possibly a second provider chosen by the owner (for example Stripe through a non-Bangladesh entity) |
| Data shared with the gateway | Invoice reference, amount, currency, the paying agency's contact name and email. VisaStack never receives full card numbers |
| Data VisaStack keeps | Transaction reference, status, amount, date, masked card or wallet type as returned, risk flag |
| Manual payments | An agency can report a bank transfer, bKash or cheque payment with a reference and an optional receipt image, which an admin confirms |
| Recurring invoices and reminders | An invoice is issued each plan period, and reminder emails are sent before and after the due date |
| Late payment | If the owner sets it, unpaid accounts move to Grace and then Suspended. Suspension limits the agency's workspace and never deletes or hides travellers' own records |
| Refunds | Through the provider, confirmed before they are recorded |
| Tax | No tax lines on invoices yet; tax handling is outside VisaStack until rules are defined |
| Questions for counsel | Payment terms and late-payment clause; refund policy; whether invoices need statutory content in Bangladesh; disclosure of gateway processors and any cross-border transfer |

## 3. AI Connections: people connect ChatGPT, Claude or another AI app (ADR 0021)

| Topic | Fact |
|---|---|
| What it is | A person can connect an outside AI app to parts of their own VisaStack record |
| Who controls it | The person signs in on VisaStack's own page and chooses what the app may read: personal details, travel documents, cases, document list, history, money, family, education, refusals and declarations, health, text read from documents, full document numbers, and, per document, original files |
| Defaults | Minimal. Anything sensitive is off and marked with a warning |
| Duration | 1 hour, 24 hours, 7 days, 30 days, or until turned off. It can be turned off at any time, with immediate effect |
| What leaves VisaStack | Only the chosen parts, as compact structured text with labels such as "confirmed by you" or "supported by a document". Original files only when ticked individually; a masked safe copy by default where one exists |
| The AI app's role | Once data reaches the AI app, that app's own terms govern it (OpenAI, Anthropic or others). **VisaStack does not control what the AI app does with it** |
| Suggestions | If the person switches on "Suggest Changes", the AI app can propose updates, save drafts and add reminders. Nothing changes the record until the person approves it in VisaStack. The app can never delete, submit, share, acknowledge, change permissions or pay |
| Agencies | An agency may connect an AI app to client information only for travellers who switched on "Let This Agency Use AI Tools on What I Share" on that agency's access. It is off by default and can be turned off at any time |
| Record keeping | VisaStack records which app read which kind of information and when, never the contents |
| Questions for counsel | Notice and consent wording for a disclosure to a third-party AI app chosen by the person; responsibility allocation once data is in the AI app; agency terms for agencies' use of AI tools on client data (onward processing, the agency's own obligations); children's records managed by a guardian |

## 4. Real redaction ("Safe Copies") (ADR 0022)

| Topic | Fact |
|---|---|
| What it is | The record owner marks areas to hide. VisaStack produces an image-only copy with those areas blacked out, with no hidden text or file data |
| Suggestions | VisaStack may suggest areas (for example the passport's machine-readable lines), which the owner confirms |
| Who receives it | Only people or agencies given "Download Safe Copies" |
| Questions for counsel | Wording that makes clear the owner checks the result and VisaStack does not guarantee every sensitive item is hidden |

## 5. Other changes worth noting

| Change | Fact |
|---|---|
| Staff two-step sign-in | Staff accounts use an authenticator app. The data held is an encrypted secret and hashed recovery codes |
| Key management | Protected fields move to a managed key service (AWS KMS, US East region) |
| Prepare Again | A person can start a new case from a previous one. Only references to their current records are reused; earlier sharing is not carried over unless they choose |
| Hosting | Vercel (US), Neon database (AWS US East), Cloudflare R2 (EU endpoint) with a Vercel private mirror, Resend email, Neon Auth sign-in. These are unchanged except for plan upgrades |

## 6. What counsel is asked to return

1. Updated privacy notice text (new sections for sections 1 to 4 above, processors list, transfers, retention for payment records).
2. Updated terms (payments, late payment, refunds, AI Connections, safe copies disclaimer).
3. An agency addendum for AI tool use on client data.
4. Consent and screen wording for the AI Connections page and the AI reading switch.
