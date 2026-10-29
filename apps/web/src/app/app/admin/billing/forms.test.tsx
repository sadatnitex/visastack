import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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

describe('BillingRulesForm', () => {
  it('shows the confirmation box only next to a preview the server sent', () => {
    expect(render({ ok: true, message: '' })).not.toContain('name="confirmed"');
    const html = render({
      ok: false,
      message: 'Turning this on today moves 1 agency to Grace and 0 agencies to Suspended.',
      field: 'confirmed',
      values: { dueDays: '7', overdueHandling: 'on', graceAfterDays: '0', suspendAfterDays: '1' },
      preview: { graceAfterDays: 0, suspendAfterDays: 1, toGrace: 1, toSuspended: 0 },
    });
    expect(html).toContain('name="confirmed"');
    expect(html).toContain('name="previewGraceAfterDays" value="0"');
    expect(html).toContain('name="previewSuspendAfterDays" value="1"');
    expect(html).toContain('Grace after 0, Suspended after');
  });

  it('keeps the values typed after a reply instead of the saved ones', () => {
    const html = render({
      ok: false,
      message: 'Suspended must start later than Grace.',
      field: 'suspendAfterDays',
      values: { dueDays: '12', overdueHandling: 'on', graceAfterDays: '9', suspendAfterDays: '4' },
    });
    expect(html).toMatch(/name="dueDays"[^>]*value="12"/);
    expect(html).toMatch(/name="graceAfterDays"[^>]*value="9"/);
    expect(html).toMatch(/name="suspendAfterDays"[^>]*value="4"/);
    expect(html).toContain('name="overdueHandling" checked="" value="on"');
  });
});
