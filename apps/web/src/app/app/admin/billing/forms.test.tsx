import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import type { BillingRulesState } from './labels';

const forced = vi.hoisted(() => ({ state: { ok: true, message: '' } as BillingRulesState }));
vi.mock('react', async (load) => {
  const actual = await load<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [forced.state, () => undefined, false],
  };
});
vi.mock('./actions', () => ({ saveBillingRulesAction: async () => ({ ok: true, message: '' }) }));

const { BillingRulesForm } = await import('./forms');

const render = (state: BillingRulesState) => {
  forced.state = state;
  return renderToStaticMarkup(
    <BillingRulesForm
      dueDays={7}
      overdueHandlingEnabled={false}
      graceAfterDays={null}
      suspendAfterDays={null}
    />,
  );
};

const PREVIEW = { graceAfterDays: 1, suspendAfterDays: 2, toGrace: 1, toSuspended: 3 };
const VALUES = {
  dueDays: '7',
  overdueHandling: 'on',
  graceAfterDays: '1',
  suspendAfterDays: '2',
} as const;

describe('BillingRulesForm', () => {
  it('shows a new preview politely, not as an error, with its box described by it alone', async () => {
    expect(render({ ok: true, message: '' })).not.toContain('name="confirmed"');
    const html = render({ ok: true, message: '', values: VALUES, preview: PREVIEW });
    expect(html).toMatch(/<output id="[^"]+-preview" class="notice notice-warn">/);
    expect(html).toContain(
      'Turning this on today moves 1 agency to Grace and 3 agencies to Suspended. Grace from 1 day after the due date, Suspended from 2 days.',
    );
    expect(html).toContain(
      'I understand this moves 1 agency to Grace and 3 agencies to Suspended today',
    );
    expect(html).toContain('name="previewGraceAfterDays" value="1"');
    expect(html).toContain('name="previewSuspendAfterDays" value="2"');
    expect(html).not.toContain('role="alert" class="field-msg field-msg-err">Turning');
    expect(html).not.toContain('aria-invalid');
    expect(html).toMatch(/type="checkbox" aria-describedby="[^" ]+-preview" name="confirmed"/);
    expect(await axeViolations(html)).toEqual([]);
  });

  it('marks the box only when a save came back with it unticked', async () => {
    const html = render({
      ok: false,
      message: 'Tick the box to confirm, then save again.',
      field: 'confirmed',
      values: VALUES,
      preview: PREVIEW,
    });
    expect(html).toMatch(
      /type="checkbox" aria-invalid="true" aria-describedby="[^" ]+-preview [^" ]+-message" name="confirmed"/,
    );
    expect(await axeViolations(html)).toEqual([]);
  });

  it('keeps the values typed after a reply, uses the house styles, and gives each day field its hints', async () => {
    const html = render({
      ok: false,
      message: 'Suspended must start later than Grace.',
      field: 'suspendAfterDays',
      values: { dueDays: '12', overdueHandling: 'on', graceAfterDays: '9', suspendAfterDays: '4' },
    });
    expect(html).toMatch(/name="dueDays" value="12"/);
    expect(html).toMatch(/name="graceAfterDays" value="9"/);
    expect(html).toMatch(/name="suspendAfterDays" value="4"/);
    expect(html).toContain('name="overdueHandling" checked="" value="on"');
    expect(html).toContain('<fieldset class="fieldset">');
    expect(html).toContain('Move Unpaid Agencies to Grace and Suspended Automatically');
    expect(html.match(/<label class="check">/g)).toHaveLength(2);
    expect(html).toContain('1 means the day after the due date. Used only when this is On.');
    expect(html).toContain('Later than Grace, so 2 or more. Used only when this is On.');
    // The shared sentence is linked to both day fields.
    const both = html.match(/id="([^"]+-both-hint)"/)?.[1];
    expect(html.match(new RegExp(`aria-describedby="[^"]*${both}`, 'g'))).toHaveLength(2);
    expect(html).not.toMatch(/\b0 to\b|Grace at 0/);
    expect(await axeViolations(html)).toEqual([]);
  });
});
