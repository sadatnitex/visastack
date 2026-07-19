# AI Gateway

Authority: Build Spec §8, §10; PRD §8, §10. The gateway is **server-only**
and **provider-neutral**, calling the **OpenAI Responses API** with strict
**Structured Outputs**. Standard model: **GPT-5.6 Terra** at the lowest
reasoning level that passes evaluation.

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
