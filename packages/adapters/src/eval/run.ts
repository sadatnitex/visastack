#!/usr/bin/env tsx
/**
 * AI Gateway evaluation runner (master directive §7 "PR 9").
 *
 * Calls the REAL OpenAI adapter against the synthetic dataset in dataset.ts
 * and reports the metrics the directive requires. Requires OPENAI_API_KEY
 * (and AI_ENABLED=true) — without them this exits 0 with a clear "skipped"
 * message rather than failing, matching this repo's established pattern for
 * checks that need real external credentials
 * (e2e/authenticated-workspace.spec.ts's WorkOS-staging gate is the same
 * shape). No capability is "pilot-verified" until this has actually been run
 * with real credentials and printed a PASS.
 *
 * Usage: OPENAI_API_KEY=sk-... pnpm --filter @visastack/adapters eval
 */
import { OpenAiExtractionAdapter } from '../openai-extraction';
import { EVAL_ALLOWED_FIELD_KEYS, EVAL_CASES } from './dataset';
import { type CaseScore, aggregate, errorCaseScore, passesThresholds, scoreCase } from './scoring';

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function readEnv(name: string): string | undefined {
  return process.env[name];
}

async function main(): Promise<void> {
  const apiKey = readEnv('OPENAI_API_KEY');
  if (!apiKey) {
    log('[ai-eval] OPENAI_API_KEY not set — skipping. This capability is NOT pilot-verified.');
    process.exit(0);
  }

  const model = readEnv('OPENAI_MODEL_PRIMARY');
  const projectId = readEnv('OPENAI_PROJECT_ID');
  const reasoningEffort = readEnv('OPENAI_REASONING_EFFORT');
  const adapter = new OpenAiExtractionAdapter({
    apiKey,
    ...(model ? { model } : {}),
    ...(projectId ? { projectId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  });

  log(
    `[ai-eval] Running ${EVAL_CASES.length} cases against ${adapter.cacheKeyComponents().model}...`,
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
      log(`[ai-eval] ${evalCase.id}: ADAPTER ERROR (${outcome.code}) — ${outcome.message}`);
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
      `[ai-eval] ${evalCase.id} (${evalCase.category}): ` +
        `tp=${score.truePositives} fp=${score.falsePositives} fn=${score.falseNegatives} ` +
        `hallucinations=${score.hallucinations} evidenceMismatches=${score.evidenceMismatches} ` +
        `unsupported=${score.unsupportedFieldProposals} cost=${score.costUnits} latency=${latencyMs}ms`,
    );
  }

  const report = aggregate(scores);
  log('');
  log('[ai-eval] === Aggregate report ===');
  log(`  Field precision:          ${(report.precision * 100).toFixed(1)}%`);
  log(`  Field recall:             ${(report.recall * 100).toFixed(1)}%`);
  log(`  Hallucination rate:       ${(report.hallucinationRate * 100).toFixed(1)}%`);
  log(`  Evidence-location accuracy: ${(report.evidenceAccuracy * 100).toFixed(1)}%`);
  log(`  Unsupported-field rate:   ${(report.unsupportedFieldRate * 100).toFixed(1)}%`);
  log(`  Prompt-injection resisted: ${report.promptInjectionResisted ? 'YES' : 'NO — FAILED'}`);
  log(`  Total cost units:         ${report.totalCostUnits}`);
  log(`  Mean cost per document:   ${report.meanCostUnitsPerDocument.toFixed(2)} units`);
  log(`  Mean latency:             ${report.meanLatencyMs.toFixed(0)}ms`);

  const passed = passesThresholds(report);
  log('');
  log(
    passed ? '[ai-eval] PASS — thresholds met.' : '[ai-eval] FAIL — below one or more thresholds.',
  );
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`[ai-eval] fatal: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
