# ADR-0021: VisaStack AI Context Gateway (remote MCP, read-first with opt-in suggestions, own authorization server, one projection engine)

- **Status:** Accepted (architecture freeze, 26 Oct 2026); implementation pending (Sonnet packages S8, S13 to S16, then S20 to S22). Production activation is an owner gate.
- **Date:** 2026-10-26
- **Deciders:** Owner (26 Oct 2026 instruction: let people connect ChatGPT, Claude and other AI apps to authorised VisaStack context; read-only first; scoped, timed, revocable, audited; no second chatbot; no second projection engine); architecture session
- **PRD/Spec link:** WP-V5 (`docs/upgrades/programme/WORK-PACKAGES.md`, selected-output service and "AI context" output); ADR 0017 (per-case sharing exceptions); `docs/architecture/permission-model.md`

## Context

- No OAuth server, user API token or connector exists today. Sign-in is Neon Auth (managed Better Auth). Its managed service exposes only a fixed plugin set: VisaStack cannot turn it into an OAuth provider, and it has no two-step sign-in either.
- Standards checked on 26 Oct 2026. The MCP authorization specification (2025-11-25, and the 2026-07-28 revision) is OAuth 2.1 for remote MCP servers:
  - protected resource metadata (RFC 9728) and a 401 carrying a `resource_metadata` pointer;
  - PKCE S256;
  - resource indicators (RFC 8707) with audience-bound tokens;
  - issuer identification (RFC 9207);
  - client registration preferring Client ID Metadata Documents (CIMD), with Dynamic Client Registration deprecated in 2026-07-28;
  - Streamable HTTP, which became stateless in 2026-07-28 (no `initialize` handshake or session header).

  What the two main clients require:
  - **Claude** (claude.ai, Desktop, mobile, Claude Code): CIMD when the authorization server advertises `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported`, otherwise DCR. It requires a 401 to start sign-in, uses the first `authorization_servers` entry, adds `offline_access` when listed, and expects rotating refresh tokens, form-encoded `/token` and responses within 10 s. Redirect URIs are `https://claude.ai/api/mcp/auth_callback`, plus a port-agnostic loopback for Claude Code.
  - **ChatGPT**: the same OAuth 2.1 flow, with CIMD recommended and DCR and predefined clients also supported. It uses PKCE and RFC 9207, and checks access on every call.

  The OpenAI and SSLCOMMERZ documentation hosts did not resolve from this session's network, so S13 re-reads the official OpenAI page for exact redirect URIs and the CIMD host.
- The record model already carries provenance: fact status (`DECLARED, EXTRACTED_PENDING, APPLICANT_CONFIRMED, DOCUMENT_SUPPORTED, AGENCY_REVIEWED, CONFLICTED, STALE, SUPERSEDED`), method, source document version, `effectiveFrom`/`validUntil`, approval time, evidence links and conflicts.
- The field catalogue already classifies every field: ten layers (`identity, travel_documents, timelines, money, people, declarations, health, qualifications, purpose_packs, country_packs`), kinds with protection floors (`identifier`, `national_identifier`, `legal_history`, `health_detail`, `special_category`, `biometric` are SENSITIVE or RESTRICTED), and fourteen document groups.

## Decision

### 1. Standard and endpoint

One remote MCP server inside the existing web app at `https://vs.obsidianglobal.studio/mcp` (Next.js route handler).

- **Transport:** Streamable HTTP, stateless, through the official MCP TypeScript SDK pinned to an exact version that serves protocol 2025-11-25 and 2026-07-28.
- **No-session rule:** no per-session server state; every request is authenticated and authorized on its own.
- **No other connectors:** no per-provider integrations and no chat window in VisaStack.

### 2. Authorization server: VisaStack itself, minimal and standard

The issuer is `https://vs.obsidianglobal.studio`. It sits in the same app and uses the existing Neon Auth session for sign-in.

Endpoints and metadata:

- `/.well-known/oauth-protected-resource/mcp` (also served at the root path), with `resource` = the exact MCP URL, `authorization_servers` = [issuer], and `scopes_supported`.
- `/.well-known/oauth-authorization-server` with:
  - `response_types_supported: ["code"]` and `grant_types_supported: ["authorization_code", "refresh_token"]`;
  - `code_challenge_methods_supported: ["S256"]`;
  - `token_endpoint_auth_methods_supported: ["none"]` and `client_id_metadata_document_supported: true`;
  - `authorization_response_iss_parameter_supported: true`;
  - `scopes_supported` including `offline_access`, plus the revocation endpoint.
- `/oauth/authorize`: a VisaStack page. It signs the person in if needed, then shows the consent screen in section 5.
- `/oauth/token`: form-encoded; `authorization_code` with PKCE S256 required, and `refresh_token`.
- `/oauth/revoke`: RFC 7009.

Rules:

- **`resource` parameter:** required, and must equal the MCP URL. Tokens are bound to it and the MCP route rejects any other audience.
- **Issuer on redirect:** the `iss` parameter is returned on every authorization response.
- **Client registration:** CIMD preferred; Dynamic Client Registration is also offered (see Extensions).
  - **Fetching the client document:** the `client_id` is an HTTPS URL fetched with strict SSRF rules: HTTPS only, public addresses only, no redirects, 5 s timeout, 64 KB cap, JSON only, cached for 24 h.
  - **Matching:** the document's `client_id` must equal the URL.
  - **Redirects:** the `redirect_uri` must match a listed one exactly. The only exception is loopback `http://localhost` and `http://127.0.0.1` callbacks, matched without the port.
  - **Allowlist:** the client's host must be on an **allowlist of supported AI apps**. It starts with the hosts Claude and ChatGPT publish, verified in S13, and is kept in one code constant. Unknown apps see "This AI app is not supported yet".
- **Tokens:** opaque, 256-bit random values, stored only as SHA-256 hashes, so a database read leaks no usable token.
  - Codes: single-use, 60 s, and bound to client, redirect URI, PKCE challenge, resource and connection.
  - Access tokens: 60 minutes.
  - Refresh tokens: rotate on every use. Reusing an old one revokes the whole connection's token family. They never outlive the connection.
- **Speed and errors:** every endpoint answers in well under 10 s. Error codes follow RFC 6749 (`invalid_grant` on a dead refresh token).

### 3. The connection is the owner's own delegated, narrowed authority (not a sharing grant)

An AI connection lets a person's own AI assistant read that person's own record. That is OAuth delegation of the owner's authority, narrowed by scope. It is not sharing with a third-party VisaStack recipient.

Reusing the `grants` table would make the policy engine and every agency and recipient code path treat an external app as a recipient. That is more surface and more risk than benefit. Therefore:

- **New table `ai_connections`** holds:
  - who: `id`, `account_id` (the owner), `applicant_id` (one record per connection; a guardian connects each managed record separately);
  - which app: `client_id` (CIMD URL), `client_name`, `client_host`;
  - what it may read: `scopes text[]`, `case_mode` (`NONE | ONE | ALL_CURRENT`), `mission_id`, `reveal_identifiers`;
  - when: `created_at`, `expires_at`, `revoked_at`, `revoked_reason`, `last_used_at`.
- **New table `ai_connection_tokens`** holds: `connection_id`, `kind` (`CODE | ACCESS | REFRESH`), `token_hash` (unique), PKCE fields, `expires_at`, `consumed_at`, `family_id`, `revoked_at`.
- **One migration**, run only with the owner's word. All code must tolerate the tables being missing.
- **Every MCP call runs one gate function, `withAiConnection(token, tool, fn)`:**
  1. Resolve the token hash to a live connection: not expired, not revoked, account active.
  2. Call `requireAccess(tx, accountPrincipal(owner), 'VIEW_METADATA', { applicantId }, { purpose: 'ai_connection' })`. This fails closed if the person no longer owns the record.
  3. Hand the resulting proof and the connection's **Selection** to the composer.
- **No new policy actor kind and no new gate are invented.** A guard test fails if any MCP tool reads data without `withAiConnection`.
- **One place for the person to see access.** The Sharing area lists AI connections beside people and agencies ("AI Connections").
- **Revoking is immediate:** tokens are looked up per request, so access ends on the very next call.
- **Erasure:** account erasure revokes and deletes the connections.

### 4. One projection engine: WP-V5's selected output is the context composer

WP-V5 builds `packages/services/src/selected-output.ts`. It is one server-authorized projection:

```
buildSelectedOutput(proof: AuthorizedApplicant<'VIEW_METADATA'>, selection: Selection, options) => SelectedOutput
```

The four WP-V5 outputs and the AI gateway are renderers over it:

- agency brief and handover;
- trip essentials;
- confirmed-information sheet;
- `renderAiContext` (compact JSON).

No second engine.

**`Selection`** (shared vocabulary for outputs and AI connections):

- `layers`: catalogue layer keys;
- `cases`: none, one, or all current;
- `documentList`: whether to include the list of documents (kind, group, dates, expiry, status, reference code);
- `documentText`: which document groups may have their extracted text included;
- `revealIdentifiers`;
- `depth`: `brief | standard | full`.

**`SelectedOutput`** has these parts:

- `person`: identity basics in scope;
- `cases[]`: destination, purpose, dates, state in plain words, checklist name and version with its review date and whether its rules are maintained, readiness (satisfied, needs attention, missing, with requirement labels), and next actions from the existing attention projection;
- `profile[layer]`;
- `documents[]`;
- `expiry[]`;
- `omitted`: counts per reason (not granted, restricted, conflicted, unconfirmed).

Every value carries provenance:

- `value`, or `masked` (last 3 characters), or absent;
- `status` in plain epistemic words: `self_declared`, `suggested_not_confirmed`, `confirmed_by_traveller`, `supported_by_document`, `reviewed_by_agency`, `conflicted`, `out_of_date`, `replaced`;
- `method`;
- `effectiveFrom`, `validUntil`, `updatedAt`;
- `evidence[]`: document reference code `D-XXXXXX`, kind and date (never storage keys or URLs);
- `relevance`: `required_by_case` or `context`.

**Rules, enforced inside `buildSelectedOutput`.** These are absent from the response, not hidden by a client:

- A layer not in the selection is absent.
- Values with status `SUPERSEDED` are absent.
- `EXTRACTED_PENDING` values appear only at `depth: full`, labelled `suggested_not_confirmed`.
- A `CONFLICTED` value is replaced by a conflict marker.
- `identifier` fields are masked unless `revealIdentifiers` is on. `national_identifier` fields are masked unless `revealIdentifiers` is on and `identity` is granted.
- `legal_history` fields only appear with the `declarations` layer. `health_detail` fields only appear with the `health` layer. `special_category` and `biometric` fields never go to an AI connection in V1.
- Document text:
  - appears only for a granted document group;
  - is capped at 20,000 characters per call;
  - is never given for document types restricted by the platform's document protection switches.
- Original files are returned only through the Original Files extension (S20), per ticked document; never by the five read tools.
- Agency notes, agency tasks, agency-internal anything, other people's records, grants, audit data and storage locations are never read by the composer.
- **Case relevance.** When a case is selected:
  - the case's checklist requirements define the `required_by_case` fields and document kinds;
  - identity basics and relevant expiry are added;
  - other granted layers appear only at `standard` or `full` depth.

### 5. Consent and scopes (what the person chooses)

The consent screen shows:

- the AI app's name;
- its web address host, prominently, with an extra warning for loopback-only clients;
- the record being connected;
- the choices below;
- the sentence: "This app can read what you choose here. It cannot change anything in VisaStack. You can turn it off at any time."

| Choice (shown) | Selection | Default |
|---|---|---|
| Personal Details | `identity` (identifiers masked) | On |
| Passports and Travel Documents | `travel_documents` | On |
| Cases | `cases`: one case (picker) / all current cases / none | One case if opened from a case, else all current |
| List of My Documents | `documentList` | On |
| Travel, Home and Work History | `timelines` | Off |
| Money | `money` | Off |
| Family and Sponsors | `people` | Off |
| Education and Qualifications | `qualifications` | Off |
| Past Refusals and Declarations | `declarations` | Off, warning tone |
| Health | `health` | Off, warning tone |
| Text Read From My Documents | `documentText` for the granted groups | Off, warning tone |
| Full Document Numbers | `revealIdentifiers` | Off, warning tone |
| How Long | 1 hour, 24 hours, 7 days, 30 days, Until I Turn It Off | 30 days |

Original Files and Suggest Changes are added to this screen by the extensions below (S20, S21). Scopes travel in the token as OAuth scopes (`visastack.identity`, `visastack.money` and so on), but the **stored connection** is the authority. The token's scopes are informative only, and changing access in VisaStack takes effect on the next call.

### 6. Tools (read-only, five)

Every tool:

- carries the annotations `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`;
- declares an `outputSchema`, returns `structuredContent` and a short text summary;
- refuses with a plain message when something is not granted, never an empty success: "Not shared with this AI app. You can change this in VisaStack under Sharing, AI Connections."

| Tool | Input | Returns |
|---|---|---|
| `prepare_context` (flagship) | `case_reference?` (`C-XXXXXX`), `focus?` (any of `overview, readiness, documents, expiry, history, money, family`), `depth?` | `renderAiContext(buildSelectedOutput(...))` narrowed by focus and case |
| `list_cases` | none | cases in scope: reference, title, destination, dates, state, readiness summary |
| `get_profile_section` | `section` (a granted layer) | that layer's values with provenance |
| `list_documents` | `group?` | the document list (no contents) |
| `get_document_text` | `document_reference` (`D-XXXXXX`) | extracted text, only with Text Read From My Documents and a granted group |

Other candidate tools are dropped. Readiness, expiry and travel history are covered by `prepare_context` foci and `get_profile_section`. Fewer, stronger tools.

### 7. Limits, audit, telemetry

- **Rate limits:** per connection, 60 calls a minute and 2,000 a day, using the existing rate-limit table. Responses are capped at 50 KB.
- **Audit events:**
  - Events: `AI_CONNECTION_CREATED`, `AI_CONNECTION_CHANGED`, `AI_CONNECTION_REVOKED`, `AI_CONTEXT_SERVED`, `AI_CONTEXT_DENIED`.
  - Metadata: connection id, client host, tool, layers returned, case id, counts, depth and denial reason.
  - **Never** values, task text, document text or tokens.
- **Product events:** `AI_CONNECTOR_CONNECTED`, `AI_CONTEXT_REQUESTED`, `AI_CONTEXT_DENIED`, `AI_CONNECTOR_REVOKED`.
- **Last used:** `last_used_at` is written at most once a minute.
- **Readiness and enablement:**
  - Readiness gains an `aiConnector` capability: `disabled` unless `AI_CONNECTOR_ENABLED=true`.
  - In controlled-pilot mode the connector works on synthetic records for acceptance.
  - Enabling it for real users is an owner gate tied to the real-data gate.

## Consequences

- **Positive:**
  - One standard serves ChatGPT, Claude and later clients.
  - The AI never touches the database. It gets compact context with provenance, built by the same engine as the shareable outputs.
  - Revocation is instant.
  - Nothing changes in VisaStack without the person: the read tools change nothing, and the suggestion tools only create pending suggestions, drafts and reminders.
- **Negative:**
  - VisaStack now runs a small OAuth authorization server. This is security-critical code that needs the strictest review and its own tests.
  - There is a second consent record type, deliberately not a sharing grant.
  - Offering DCR means more registered clients to expire and rate-limit.
- **Follow-ups:**
  - S8: Selection type and `buildSelectedOutput` (inside WP-V5).
  - S13: authorization server and discovery.
  - S14: MCP route and tools.
  - S15: AI Connections screens.
  - S16: audit, telemetry and acceptance.
  - S20 to S22: original files, suggestion tools and agency connectors (see Extensions); DCR is part of S13.

## Alternatives considered

- **Reuse `grants` with a new recipient type.** Rejected: it mixes an owner's own delegation with third-party sharing and widens the policy engine for no gain. The shared Selection vocabulary and single projection keep the two consistent instead.
- **A third-party authorization server (Auth0, Stytch, WorkOS).** Rejected for V1: a second identity system beside Neon Auth, another vendor and processor, and account bridging, for a small, well-specified surface.
- **Per-provider plugins (GPT Actions, Claude-only integration).** Rejected: duplicated work; MCP is what both support.
- **Personal API keys pasted into the AI app.** Rejected: not supported by consumer AI apps for user accounts, and not revocable per scope.

## Extensions built in this programme (owner, 26 Oct 2026: "AI connector now")

These follow S13 to S16 and use the same gate, Selection, composer, audit and consent page. Read-only stays the default; every extension is off until the person turns it on.

### Dynamic Client Registration (inside S13)

- `/oauth/register` (RFC 7591, `application/json`) accepts public clients only (`token_endpoint_auth_method: none`).
- `redirect_uris` must be HTTPS on an allowlisted AI-app host, or loopback (`http://localhost` or `http://127.0.0.1`, any port).
- Registrations are rate-limited per IP address (existing rate-limit table) and expire after 30 days unused. The `oauth_clients` table holds `client_id` (random), name, redirect URIs, created and last used.
- Metadata advertises `registration_endpoint`. CIMD stays preferred; the consent screen shows the redirect host either way, and warns for loopback.

### Original documents (S20)

- The consent page gains "Original Files", off by default, in warning tone. The person ticks **individual documents** (not groups) from a list. Where a safe copy exists (ADR 0022), the choice per document is "Safe Copy" (default) or "Original".
- A new tool, `get_document_file(document_reference)`, returns an MCP embedded resource (base64, with its MIME type) only for a ticked document, from its latest usable version.
  - Only `CLEAN` versions, at most 10 MB.
  - Never a type restricted by the document protection switches.
  - Never a storage URL.
- Each call writes `AI_CONTEXT_SERVED` with `fileServed: true` and the variant.
- `ai_connections` gains `document_ids uuid[]` and `document_variants jsonb` (migration with S20).

### Suggestion tools: write only as proposals and drafts (S21)

- The consent page gains "Suggest Changes", off by default. It reads: "The app can suggest updates and save drafts. Nothing changes until you approve it in VisaStack."
- The tools:
  - `suggest_profile_update(section, field, value, reason)`: creates a **pending field suggestion** through the deterministic-run pattern of ADR 0019, with model version `connector:<client host>` and zero cost. It appears in the normal review labelled "Suggested by <app name>". A field outside the granted layers is refused.
  - `save_draft(case_reference, kind: cover_letter | personal_statement | note_to_self, text)`: saves a draft in `generated_outputs` (or a draft notes table if none fits), marked "Draft from <app name>". It is never sent anywhere.
  - `add_reminder(case_reference?, title, due_date)`: creates a task owned by the person on their own case or record.
- Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.
- Limits: 20 writes a day per connection, and text inputs are capped.
- Audit: each write records kind and counts only.
- **No tool deletes, submits, shares, acknowledges, changes permissions, changes case status or pays.** Those stay out (deferred register H15 now lists only these destructive or outward actions).

### Agency AI connectors (S22)

- A traveller decides, per grant, whether an agency may use AI tools on what they share. This is a new permission `AI_ASSIST`, added to the `permission_action` enum (migration), off by default and shown in the grant form as "Let This Agency Use AI Tools on What I Share". Existing grants keep it off. This is a change to the permission semantics that the owner approved on 26 Oct 2026; record it in `docs/architecture/permission-model.md`.
- An agency owner or admin turns on "AI Connections for This Agency" (an organization setting). Members can then connect an AI app for that organization: `ai_connections` gains `organization_id` and `kind` (`OWNER | AGENCY`).
- **Data path:** `withAiConnection` resolves an agency connection to `requireAccess(tx, accountPrincipal(member), 'VIEW_METADATA', { applicantId } or { missionId }, { actingFor: { organizationId }, purpose: 'ai_connection' })`. Only applicants whose grant to that organization includes `AI_ASSIST`, and only cases the member can see (`listVisibleMissionsForMember`), are reachable.
- The Selection is the intersection of the grant's own scope (categories, documents, case, per-case exceptions) and the connection's choices.
- The agency's own notes and tasks on those cases may be included, since they are the agency's own data. Another organization's data never is.
- Tools: `list_cases` and `prepare_context` (plus `list_documents` and `get_document_text` if the grant allows). There are no agency write tools in V1.
- The traveller sees "AI Tools Allowed" on that agency's grant card. Revoking the grant or removing `AI_ASSIST` cuts access on the next call.
