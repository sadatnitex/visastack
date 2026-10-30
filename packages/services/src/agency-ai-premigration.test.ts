import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { migrationsFolder } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { accountPrincipal } from './access';
import { createAgencyAiConnection, listAgencyAiConnections } from './access/agency-ai-connections';
import {
  AGENCY_CLIENT,
  AGENCY_REDIRECT,
  AGENCY_RESOURCE,
  agency,
  caseOf,
  enableAgencyAiTools,
  fact,
  shareWithAgency,
  traveller,
} from './access/agency-ai.test-support';
import { requireAccess } from './access/require-access';
import { agencyAiAvailable, aiAssistAvailable } from './agency-ai-ready';
import { aiOrganizationContext, getAiFeatureState } from './ai-feature-settings';
import type { Db } from './db';
import { setGrantAiAssist } from './grant-ai-assist';
import { getOrganizationAiSetting, setOrganizationAiSetting } from './organization-ai-settings';

/**
 * S22: production runs the new code for a while before migrations 0108 and 0109. This proves that
 * on a database as production has it today (through 0107): grants work exactly as before, the AI
 * permission is never written, agency choices read as not available yet, and nothing fails; then
 * that each migration, run alone, turns on exactly its part.
 */

const ENUM_FILE = '0108_ai_assist_permission';
const TABLES_FILE = '0109_agency_ai_connections';
const TIMEOUT = 240_000;

function folderBefore(file: string): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === file);
  if (at === -1) throw new Error(`${file} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-s22-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

async function runFile(client: PGlite, file: string) {
  const text = readFileSync(join(migrationsFolder, `${file}.sql`), 'utf8');
  for (const statement of text.split('--> statement-breakpoint')) await client.exec(statement);
}

describe('before and after migrations 0108 and 0109 (S22)', () => {
  it(
    'keeps sharing exactly as it was before the migrations, then turns on each part',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folderBefore(ENUM_FILE) });
      const db = drizzle(client, { schema }) as unknown as Db;
      await enableAgencyAiTools(db);

      const t = await traveller(db, 'before@example.com');
      await fact(db, t.ownerId, t.applicantId, 'given_name', 'Nusrat', 'universal');
      const someCase = await caseOf(db, t.ownerId, t.applicantId, 'London Trip');
      const a = await agency(db, 'owner-a@example.com', 'Harbor Visas', false);
      expect(await aiAssistAvailable(db)).toBe(false);
      expect(await agencyAiAvailable(db)).toBe(false);

      // Sharing works as before.
      const grantId = await shareWithAgency(db, { ...t, organization: a, ai: false });
      const member = await requireAccess(
        db,
        accountPrincipal(a.ownerId),
        'VIEW_METADATA',
        { missionId: someCase.missionId },
        { actingFor: { organizationId: a.organizationId }, purpose: 'Help with my visa' },
      );
      expect(isOk(member)).toBe(true);

      // The AI permission is never written, and nothing fails.
      const owner = await requireAccess(
        db,
        accountPrincipal(t.ownerId),
        'VIEW_METADATA',
        { applicantId: t.applicantId },
        { purpose: 'owner_sharing' },
      );
      if (!isOk(owner)) throw new Error('owner');
      expect(await setGrantAiAssist(owner.value, { grantId, allow: false })).toEqual({
        ok: false,
        error: 'not_available',
      });
      const setting = await getOrganizationAiSetting(db, {
        organizationId: a.organizationId,
        accountId: a.ownerId,
      });
      expect(isOk(setting) && setting.value.available).toBe(false);
      expect(isOk(setting) && setting.value.feature.reason).toBe('not_available_yet');
      expect(
        isOk(
          await setOrganizationAiSetting(db, {
            organizationId: a.organizationId,
            accountId: a.ownerId,
            enabled: true,
            confirmed: true,
          }),
        ),
      ).toBe(false);
      const connect = () =>
        db.transaction((tx) =>
          createAgencyAiConnection(tx, {
            organizationId: a.organizationId,
            accountId: a.ownerId,
            client: AGENCY_CLIENT,
            duration: '30d',
            codeChallenge: 'x'.repeat(43),
            redirectUri: AGENCY_REDIRECT,
            resource: AGENCY_RESOURCE,
          }),
        );
      expect(await connect()).toEqual({ ok: false, error: 'not_available' });
      expect(
        await listAgencyAiConnections(db, {
          organizationId: a.organizationId,
          accountId: a.ownerId,
        }),
      ).toEqual({ ok: true, value: { available: false, connections: [] } });
      const feature = await getAiFeatureState(
        db,
        'ai_agency_tools',
        aiOrganizationContext(a.organizationId),
      );
      expect(feature.reason).toBe('not_available_yet');

      // The first migration alone: the permission exists, the agency tables do not yet.
      await runFile(client, ENUM_FILE);
      expect(await aiAssistAvailable(db)).toBe(true);
      expect(await agencyAiAvailable(db)).toBe(false);
      expect(await connect()).toEqual({ ok: false, error: 'not_available' });

      // The second: agency connections can be made once the agency turns its setting on.
      await runFile(client, TABLES_FILE);
      expect(await agencyAiAvailable(db)).toBe(true);
      expect(await connect()).toEqual({ ok: false, error: 'agency_setting_off' });
      const on = await setOrganizationAiSetting(db, {
        organizationId: a.organizationId,
        accountId: a.ownerId,
        enabled: true,
        confirmed: true,
      });
      expect(isOk(on)).toBe(true);
      const made = await connect();
      expect(isOk(made)).toBe(true);
    },
    TIMEOUT,
  );
});
