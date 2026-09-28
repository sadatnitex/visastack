#!/usr/bin/env tsx
/**
 * AI Gateway evaluation runner (master directive §7 "PR 9"; Part 8 §14
 * "Evaluation": "Each provider must pass real synthetic adapter tests before
 * V1 is fully accepted... All three real adapters must eventually be
 * live-tested for Commercial V1 acceptance").
 *
 * Calls ONE real adapter -- selected via AI_EVAL_PROVIDER, default `openai`
 * for backward compatibility with every existing invocation of this script
 * -- against the synthetic dataset in dataset.ts and reports the metrics the
 * directive requires. `dataset.ts`/`scoring.ts` are already fully
 * provider-agnostic (they operate on the generic `AiExtractionPort`/
 * `FieldProposal` shape every adapter shares); only this file's own
 * adapter-construction switch was ever OpenAI-only (AI-10). §14 itself treats
 * each provider as needing its OWN pass/fail verdict ("each provider must
 * pass"), not one combined score across all three, so this runs exactly one
 * provider per invocation -- a CI matrix or an operator running this three
 * times (once per provider) gets three independent reports, matching J15's
 * own "config OpenAI; test; activate; Gemini; Claude" journey.
 *
 * Requires that provider's own API key env var -- without it this exits 0
 * with a clear "skipped" message rather than failing, matching this repo's
 * established pattern for checks that need real external credentials
 * (e2e/authenticated-workspace.spec.ts's WorkOS-staging gate is the same
 * shape). No capability is "pilot-verified" until this has actually been run
 * with real credentials and printed a PASS.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... pnpm --filter @visastack/adapters eval
 *   AI_EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @visastack/adapters eval
 *   AI_EVAL_PROVIDER=gemini GEMINI_API_KEY=AIza-... pnpm --filter @visastack/adapters eval
 */
import type { AiExtractionPort } from '@visastack/services';
import { AnthropicExtractionAdapter } from '../anthropic-extraction';
import { GeminiExtractionAdapter } from '../gemini-extraction';
import { OpenAiExtractionAdapter } from '../openai-extraction';
import { EVAL_ALLOWED_FIELD_KEYS, EVAL_CASES } from './dataset';
import { type CaseScore, aggregate, errorCaseScore, passesThresholds, scoreCase } from './scoring';

const EVAL_PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
type EvalProvider = (typeof EVAL_PROVIDERS)[number];

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function readEnv(name: string): string | undefined {
  return process.env[name];
}

function resolveProvider(logPrefix: string): EvalProvider {
  const raw = readEnv('AI_EVAL_PROVIDER') ?? 'openai';
  if (!(EVAL_PROVIDERS as readonly string[]).includes(raw)) {
    log(
      `${logPrefix} Unknown AI_EVAL_PROVIDER "${raw}" -- expected one of: ${EVAL_PROVIDERS.join(', ')}.`,
    );
    process.exit(1);
  }
  return raw as EvalProvider;
}

/**
 * Builds the real adapter for one provider from that provider's own env
 * contract. Returns undefined when its required API key is absent -- the
 * caller treats that as "skip, not pilot-verified," never a hard failure.
 * `reasoningEffort` is only meaningful for OpenAI today (see
 * AnthropicExtractionAdapter/GeminiExtractionAdapter's own doc comments --
 * both accept it for interface-shape parity but currently no-op it), so it
 * is only read/passed for that one case.
 */
function buildAdapter(provider: EvalProvider): AiExtractionPort | undefined {
  switch (provider) {
    case 'openai': {
      const apiKey = readEnv('OPENAI_API_KEY');
      if (!apiKey) return undefined;
      const model = readEnv('OPENAI_MODEL_PRIMARY');
      const projectId = readEnv('OPENAI_PROJECT_ID');
      const reasoningEffort = readEnv('OPENAI_REASONING_EFFORT');
      return new OpenAiExtractionAdapter({
        apiKey,
        ...(model ? { model } : {}),
        ...(projectId ? { projectId } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      });
    }
    case 'anthropic': {
      const apiKey = readEnv('ANTHROPIC_API_KEY');
      if (!apiKey) return undefined;
      const model = readEnv('ANTHROPIC_MODEL_PRIMARY');
      return new AnthropicExtractionAdapter({ apiKey, ...(model ? { model } : {}) });
    }
    case 'gemini': {
      const apiKey = readEnv('GEMINI_API_KEY');
      if (!apiKey) return undefined;
      const model = readEnv('GEMINI_MODEL_PRIMARY');
      return new GeminiExtractionAdapter({ apiKey, ...(model ? { model } : {}) });
    }
  }
}

const PROVIDER_API_KEY_ENV: Record<EvalProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

async function main(): Promise<void> {
  const provider = resolveProvider('[ai-eval]');
  const logPrefix = `[ai-eval:${provider}]`;

  const adapter = buildAdapter(provider);
  if (!adapter) {
    log(
      `${logPrefix} ${PROVIDER_API_KEY_ENV[provider]} not set -- skipping. This capability is NOT pilot-verified.`,
    );
    process.exit(0);
  }

  log(
    `${logPrefix} Running ${EVAL_CASES.length} cases against ${adapter.cacheKeyComponents().model}...`,
  );

  const scores: CaseScore[] = [];
  for (const evalCase of EVAL_CASES) {
    const startedAt = Date.now();
    const outcome = await adapter.extract({
      documentVersionId: `eval-${evalCase.id}`,
      text: evalCase.documentText,
      allowedFieldKeys: EVAL_ALLOWED_FIELD_KEYS as unknown as string[],
    });
    const latencyMs = Date.now() - startedAt;

    if (!outcome.ok) {
      log(`${logPrefix} ${evalCase.id}: ADAPTER ERROR (${outcome.code}) -- ${outcome.message}`);
      scores.push(errorCaseScore(evalCase, latencyMs));
      continue;
    }

    const score = scoreCase(
      evalCase,
      outcome.result.proposals,
      outcome.result.usage.costUnits,
      latencyMs,
      EVAL_ALLOWED_FIELD_KEYS as unknown as string[],
    );
    scores.push(score);
    log(
      `${logPrefix} ${evalCase.id} (${evalCase.category}): ` +
        `tp=${score.truePositives} fp=${score.falsePositives} fn=${score.falseNegatives} ` +
        `hallucinations=${score.hallucinations} evidenceMismatches=${score.evidenceMismatches} ` +
        `unsupported=${score.unsupportedFieldProposals} cost=${score.costUnits} latency=${latencyMs}ms`,
    );
  }

  const report = aggregate(scores);
  log('');
  log(`${logPrefix} === Aggregate report ===`);
  log(`  Field precision:          ${(report.precision * 100).toFixed(1)}%`);
  log(`  Field recall:             ${(report.recall * 100).toFixed(1)}%`);
  log(`  Hallucination rate:       ${(report.hallucinationRate * 100).toFixed(1)}%`);
  log(`  Evidence-location accuracy: ${(report.evidenceAccuracy * 100).toFixed(1)}%`);
  log(`  Unsupported-field rate:   ${(report.unsupportedFieldRate * 100).toFixed(1)}%`);
  log(`  Prompt-injection resisted: ${report.promptInjectionResisted ? 'YES' : 'NO — FAILED'}`);
  log(`  Any case errored:         ${report.anyCaseErrored ? 'YES — FAILED' : 'no'}`);
  log(`  Total cost units:         ${report.totalCostUnits}`);
  log(`  Mean cost per document:   ${report.meanCostUnitsPerDocument.toFixed(2)} units`);
  log(`  Mean latency:             ${report.meanLatencyMs.toFixed(0)}ms`);

  const passed = passesThresholds(report);
  log('');
  if (!passed && report.anyCaseErrored) {
    log(`${logPrefix} FAIL -- one or more required cases never executed (adapter error).`);
  } else {
    log(
      passed
        ? `${logPrefix} PASS -- thresholds met.`
        : `${logPrefix} FAIL -- below one or more thresholds.`,
    );
  }
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`[ai-eval] fatal: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
