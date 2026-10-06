import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReleaseRecord, newestMigration } from '../../scripts/release-record.mjs';

/**
 * The release record names the deployed code, the deployment and the migration version
 * (directive Part 9 section 13). These tests pin what it reads from GitHub's event and from the
 * migration journal, so a changed event shape cannot silently blank a field.
 */

const event = {
  repository: { full_name: 'owner/repo' },
  deployment: {
    id: 4242,
    sha: 'd7d0133740d733606e44a5d4d228c12ecefa58e7',
    ref: 'main',
    environment: 'Production',
    created_at: '2026-10-06T00:00:00Z',
  },
  deployment_status: {
    state: 'success',
    environment_url: 'https://app.example.test',
    target_url: 'https://vercel.example.test/inspect',
  },
};

describe('newestMigration', () => {
  it('names the last entry of the journal and how many there are', () => {
    const journal = {
      entries: [
        { tag: '0001_a', when: 1000 },
        { tag: '0002_b', when: 2000 },
      ],
    };
    expect(newestMigration(journal)).toEqual({
      tag: '0002_b',
      when: new Date(2000).toISOString(),
      count: 2,
    });
  });

  it('copes with an empty journal', () => {
    expect(newestMigration({ entries: [] })).toEqual({ tag: null, when: null, count: 0 });
  });

  it('reads the real journal of this repository', () => {
    const journal = JSON.parse(
      readFileSync(
        new URL('../../../../packages/db/migrations/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    );
    const newest = newestMigration(journal);
    expect(newest.tag).toMatch(/^\d{4}_/);
    expect(newest.count).toBeGreaterThan(80);
  });
});

describe('buildReleaseRecord', () => {
  const now = new Date('2026-10-06T01:00:00Z');
  const journal = { entries: [{ tag: '0083_x', when: 1791011332063 }] };

  it('records the code, the deployment, the environment, the migration and the smoke result', () => {
    const record = buildReleaseRecord({ event, journal, smokeOutcome: 'success', now });
    expect(record).toMatchObject({
      recordedAt: '2026-10-06T01:00:00.000Z',
      repository: 'owner/repo',
      codeSha: 'd7d0133740d733606e44a5d4d228c12ecefa58e7',
      ref: 'main',
      environment: 'Production',
      githubDeploymentId: 4242,
      deploymentState: 'success',
      deploymentUrl: 'https://app.example.test',
      smokeCheck: 'success',
    });
    expect(record.migration.tag).toBe('0083_x');
  });

  it('falls back to the target address when there is no environment address', () => {
    const record = buildReleaseRecord({
      event: {
        ...event,
        deployment_status: { state: 'success', target_url: 'https://t.example.test' },
      },
      journal,
      smokeOutcome: 'failure',
      now,
    });
    expect(record.deploymentUrl).toBe('https://t.example.test');
    expect(record.smokeCheck).toBe('failure');
  });

  it('never invents a value: a missing field is null, not a guess', () => {
    const record = buildReleaseRecord({ event: {}, journal, smokeOutcome: 'unknown', now });
    expect(record.codeSha).toBeNull();
    expect(record.githubDeploymentId).toBeNull();
    expect(record.deploymentUrl).toBeNull();
  });
});
