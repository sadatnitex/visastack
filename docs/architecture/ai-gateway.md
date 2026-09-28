# AI Gateway

Authority: Build Spec §8, §10; PRD §8, §10; extended by Commercial V1 PRD
and directive Part 8 (`docs/roadmap/commercial-v1-implementation-directive.md`).
The gateway is **server-only** and **provider-neutral**. This document
states the normative requirements below; see "Current implementation" at
the end for what is actually built today, and
[`docs/commercial-v1/known-issues.md`](../commercial-v1/known-issues.md)
item 79 for the full, continuously-updated build history.

## Hard boundaries (Build Spec §0.7)

AI **may** propose classifications, filenames, field updates, contradiction
explanations, letters, and translations. AI **may not** silently persist
facts, authenticate evidence, grant access, submit applications, or predict
approval. Deterministic parsers always run first; Terra is never the system
of record.

## Model governance

- Server-only Responses API; **no** direct browser→provider calls; **no**
  consumer ChatGPT; **no** staff copy/paste of real applicant files; **no**
  unrestricted agent loop.
- Pin a model snapshot when available; otherwise lock model ID/config and
  require regression evaluation before any change.
- Do **not** auto-downshift at launch. Luna only after task-specific
  benchmark parity; Sol / qualified human review only via explicit
  escalation for exceptional cases.

## Per-task request policy

Each task declares: purpose · allowed data classes · minimum input · schema ·
prompt/version · max tokens & cost · timeout · max retries · retention mode ·
human-approval requirement · fallback · evaluation threshold.

## Cost controls

Deterministic processing first · only relevant pages/fields · redact/minimize
non-required identifiers · cache by content/input/rule/prompt hash · never
rerun unchanged evidence · batch non-urgent evaluation · per-document/user/
org budgets · usage ledger + alerts.

## AI output contract (every proposal — Build Spec §8)

Document classification + confidence · proposed filename components +
confidence · canonical field ID · target applicant + repeating-record
id/candidate · current value · extracted raw value · normalized proposed
value · proposal type · source doc/version/page/region · evidence
excerpt/coordinates · confidence · sensitivity · observed/effective/valid
date candidates · warnings/unresolved.

**Proposal types:** `NEW` · `MATCH` · `UPDATE` · `CONFLICT` · `UNMAPPED` ·
`UNCERTAIN`.

## Privacy

Reviewed business API terms + subprocessor review · approved region/
retention · no provider training use · clear applicant disclosure + manual
no-AI path · **synthetic or irreversibly-redacted data only in dev/test.**

## Degradation

Master Profile, Vault metadata, manual editing, and permitted downloads stay
fully usable when AI is down (Build Spec §16). Manual completion is always
available.

## Current implementation (Commercial V1 Part 8)

The provider-neutral port (`AiExtractionPort`, `packages/services/src/ai.ts`)
now has real adapters for **three** providers - OpenAI, Anthropic, and
Google Gemini (`packages/adapters/src/{openai,anthropic,gemini}-extraction.ts`)
- not the single fixed model this document's normative sections describe.
Which provider/model/key is active is **admin-managed, not hard-coded**:
`/app/admin/ai-settings` (gated on `AI_SETTINGS_MANAGE` + step-up) creates
immutable, versioned configuration rows (`ai_provider_configs`; DRAFT →
ACTIVE → SUPERSEDED/DISABLED) holding an envelope-encrypted API key, a
reviewed-data-policy attestation, and durable limits (budget, per-document
budget, max attempts, max pages, cache age, max concurrent calls) - all
enforced at dispatch time, not just stored. An admin can run a synthetic
connection test and a 13-case evaluation harness (precision/recall/
hallucination/evidence-accuracy/prompt-injection-resistance, against
Build Spec §14's own thresholds) against a DRAFT before activating it, and
can roll back to the last eligible known-good version. A platform-wide kill
switch is rechecked immediately before every outbound call, including
queued jobs, per this document's own "Model governance" section above.

A second, separate port, `AiOcrPort` (`packages/services/src/ocr.ts`), exists
for image/scanned-document OCR - deliberately its own port, not a field on
`AiExtractionPort`, since it sends raw image bytes off-server rather than
extracted text, a materially different privacy posture gated by its own
`AI_OCR` consent purpose. It has a baseline OpenAI adapter
(`packages/adapters/src/openai-ocr.ts`) but is **not yet wired into the
document intake pipeline** - contract-complete, zero runtime risk, tracked
as an open item in `known-issues.md` item 79.

Still open, tracked in `known-issues.md`/`requirements-ledger.md`: the
SSRF-hardening/endpoint-denial-list module (no custom-endpoint admin field
exists yet to protect); expanding the evaluation dataset from 13 cases
toward the directive's ">=50 representative documents per task set" target;
real live-credentialed verification against any provider's paid endpoint
(structurally blocked in every sandbox this programme has run in, for lack
of real API keys); and wiring OCR into a live call site.
