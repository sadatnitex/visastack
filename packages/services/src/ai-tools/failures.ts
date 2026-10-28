import type { AiComposeFailure, AiContextGateway } from '../access/with-ai-connection';
import { type AiToolResult, MESSAGES, refusal } from './result';

/** The plain answer, and the audit reason, when the composer could not serve what was asked. */
export function caseFailure(gateway: AiContextGateway, failure: AiComposeFailure): AiToolResult {
  gateway.denied(failure);
  if (failure === 'case_not_shared') return refusal(MESSAGES.caseNotShared);
  if (failure === 'case_unavailable') return refusal(MESSAGES.caseUnavailable);
  return refusal(MESSAGES.failed);
}
