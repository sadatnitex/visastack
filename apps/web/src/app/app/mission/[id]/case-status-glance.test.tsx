import type { MissionState } from '@visastack/core';
import { createTranslator } from '@visastack/i18n';
import type { Readiness } from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => 'en' }));

import { CASE_STATE_LABELS } from '../../../../lib/case-stages';
import { CaseStatusPanel } from './case-status-panel';

const readiness: Readiness = {
  total: 1,
  requiredCount: 1,
  satisfiedRequired: 0,
  missing: [],
  ready: false,
  overallState: 'NEEDS_ACTION',
  requirementResults: [
    {
      packRequirementId: 'a',
      kind: 'DOCUMENT',
      key: 'passport',
      optional: false,
      state: 'CRITICAL_GAP',
    },
  ],
};

const between = (html: string) => {
  const from = html.indexOf('lift-status-glance');
  const to = html.indexOf('lift-status-stages');
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to);
};

const panel = (selfReviewed: boolean, state: MissionState = 'IN_REVIEW') =>
  renderServer(
    <CaseStatusPanel
      missionId="m1"
      missionTitle="Example Case"
      applicantId="a1"
      state={state}
      stateLabels={CASE_STATE_LABELS}
      nextStageStates={[]}
      cancelInMore={false}
      isDirty={false}
      changesSinceConfirmed={null}
      attention={[]}
      nextStep={null}
      nextStepFirstItem={null}
      manualMode={false}
      readiness={readiness}
      acknowledged={false}
      requiredUnverifiedCount={0}
      requiredHardGapCount={1}
      t={createTranslator('en')}
      selfReviewed={selfReviewed}
      packOptionCount={0}
      noChecklistLine={null}
      welcomeShown={false}
      progressIsReadinessAnchor={false}
    />,
  );

describe('the compact stage line of the case status panel', () => {
  it('names the stage and shows the step bar without the picture track', async () => {
    const html = await panel(false);
    const glance = between(html);
    expect(glance).toContain('Now: In Review');
    expect(glance).toContain('lift-strip-part-current');
    expect(glance).not.toContain('journey-track');
    // The step bar keeps the only list and the only current marker.
    expect(glance).not.toContain('aria-current');
    expect(glance).not.toContain('<ol');
  });

  it('shows at Glance only while an agency can see the case, and at Browse too while none can', async () => {
    expect(await panel(false)).toContain('data-until="glance"');
    expect(await panel(true)).toContain('data-until="browse"');
  });

  it('leaves the full stage row at its own levels', async () => {
    expect(await panel(false)).toMatch(/class="lift-status-stages" data-level="browse"/);
    expect(await panel(true)).toMatch(/class="lift-status-stages" data-level="everything"/);
  });

  it('says the same position as the step bar, for every stage', async () => {
    for (const state of Object.keys(CASE_STATE_LABELS) as (keyof typeof CASE_STATE_LABELS)[]) {
      const html = await panel(false, state);
      const [compact, full] = [...html.matchAll(/lift-steps-position[^"]*">([^<]*)</g)].map(
        (m) => m[1],
      );
      expect(compact, state).toBe(full);
    }
  });

  it('claims nothing about earlier stages or approval', async () => {
    const html = await panel(false);
    const glance = between(html);
    expect(glance).not.toMatch(/approved|reviewed|done|complete|submitted/i);
  });
});
