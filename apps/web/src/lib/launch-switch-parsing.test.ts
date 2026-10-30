import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aiConnectorEnabled } from './ai-connector';
import { refundsViaGatewayEnabled } from './refund-gateway';

/**
 * S29 round 2 guard: no launch switch that existed before S29 changes how it is read. Each one is
 * pinned here to its own reading, exactly as it was: exact "true" where it was exact, trimmed
 * where it was trimmed. `switchOn` (@visastack/core) is only for switches new from S29 on. To
 * change a switch's reading is an owner decision with its own docs, not a side effect.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const PINNED: readonly {
  readonly name: string;
  readonly file: string;
  readonly reading: string;
}[] = [
  {
    name: 'CASE_RETENTION_PURGE_ENABLED (exact)',
    file: 'packages/services/src/case-retention.ts',
    reading: "envRaw(env, 'CASE_RETENTION_PURGE_ENABLED') === 'true'",
  },
  {
    name: 'INACTIVE_ACCOUNT_DELETION_ENABLED (exact)',
    file: 'packages/services/src/account-retention.ts',
    reading: "envRaw(env, 'INACTIVE_ACCOUNT_DELETION_ENABLED') === 'true'",
  },
  {
    name: 'PERSONAL_SHARING_INVITATIONS_ENABLED (exact)',
    file: 'apps/web/src/app/app/applicant/[id]/sharing/actions.ts',
    reading: "process.env[sharingInvitationFlag] === 'true'",
  },
  {
    name: 'COMMERCIAL_READINESS_ATTEST_* (exact)',
    file: 'apps/web/src/lib/commercial-readiness.ts',
    reading: "readEnv(attestation.env) === 'true'",
  },
  {
    name: 'AI_ENABLED (exact)',
    file: 'apps/web/src/lib/ai.ts',
    reading: "readEnv('AI_ENABLED') !== 'true'",
  },
  {
    name: 'OPENAI_STORE_RESPONSES (exact)',
    file: 'apps/web/src/lib/ai.ts',
    reading: "readEnv('OPENAI_STORE_RESPONSES') === 'true'",
  },
  {
    name: 'PAYMENT_REFUNDS_VIA_GATEWAY (exact)',
    file: 'apps/web/src/lib/refund-gateway.ts',
    reading: "readEnv(REFUNDS_SWITCH) === 'true'",
  },
  {
    name: 'AI_CONNECTOR_ENABLED (trimmed)',
    file: 'apps/web/src/lib/ai-connector.ts',
    reading: "read('AI_CONNECTOR_ENABLED')?.trim() === 'true'",
  },
];

describe('launch switches keep the reading they had before S29', () => {
  it.each(PINNED)('$name', ({ file, reading }) => {
    const source = readFileSync(join(REPO, file), 'utf8');
    expect(source).toContain(reading);
    expect(source).not.toMatch(/\bswitchOn\(/);
  });

  it('reads the two switches with a function as pinned: exact for refunds, trimmed for the connector', () => {
    expect(refundsViaGatewayEnabled(() => 'true')).toBe(true);
    expect(refundsViaGatewayEnabled(() => ' true')).toBe(false);
    expect(refundsViaGatewayEnabled(() => 'TRUE')).toBe(false);
    expect(aiConnectorEnabled(() => ' true ')).toBe(true);
    expect(aiConnectorEnabled(() => 'TRUE')).toBe(false);
  });
});
