import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { caseCountryOptions, casePurposeGroups } from '../../../../../lib/case-choices';
import type { ActionState } from './case-form-fields';

const forced = vi.hoisted(() => ({ state: undefined as undefined | ActionState }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: ((...args: Parameters<typeof actual.useActionState>) =>
      forced.state
        ? [forced.state, () => undefined, false]
        : actual.useActionState(...args)) as typeof actual.useActionState,
  };
});
vi.mock('./actions', () => ({ createMissionAction: vi.fn() }));

const { CreateMissionForm } = await import('./create-mission-form');

const render = () =>
  renderToStaticMarkup(
    <CreateMissionForm
      applicantId="a-1"
      countries={caseCountryOptions()}
      purposes={casePurposeGroups()}
    />,
  );

beforeEach(() => {
  forced.state = undefined;
});

describe('CreateMissionForm', () => {
  it('asks three questions first and keeps the rest under one fold-out', () => {
    const html = render();
    const opening = html.slice(0, html.indexOf('<details'));
    expect(opening).toContain('What is this case for?');
    expect(opening).toContain('Where are you going?');
    expect(opening).toContain('What is the trip for?');
    expect(opening).not.toContain('name="itineraryRef"');
    expect(html).toContain('Add More Details (Optional)');
  });

  it('still sends every field it sent before, with the same names', () => {
    const html = render();
    for (const name of [
      'applicantId',
      'title',
      'destination',
      'purpose',
      'itineraryRef',
      'jurisdiction',
      'serviceCategory',
      'travelStartDate',
      'travelEndDate',
      'targetDeadline',
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toMatch(/name="title"[^>]*required|required=""[^>]*name="title"/);
  });

  it('picks the country from the list the app holds, not a free-text box', () => {
    const html = render();
    expect(html).toMatch(/<select[^>]*name="destination"/);
    expect(html).not.toMatch(/<input[^>]*name="destination"/);
    expect(html).toContain('<option value="GB">United Kingdom</option>');
    expect(html).toContain('<option value="" selected="">Not Sure Yet</option>');
    const countries = html.slice(
      html.indexOf('name="destination"'),
      html.indexOf('name="purpose"'),
    );
    expect(countries.match(/<option value="[A-Z]{2}">/g)?.length).toBe(caseCountryOptions().length);
  });

  it('groups the purposes and sends their keys', () => {
    const html = render();
    expect(html).toMatch(/<select[^>]*name="purpose"/);
    expect(html).toContain('<optgroup label="Visit">');
    expect(html).toContain('<option value="tourism">Tourism</option>');
  });

  it('lets the server check the answers, so problems show beside the fields and not in a pop-up', () => {
    expect(render()).toMatch(/<form[^>]*noValidate=""/);
  });

  it('marks each field with a problem, ties it to its own message, and keeps what was typed', async () => {
    forced.state = {
      ok: false,
      message: 'Check the 2 fields marked above.',
      field: 'title',
      fieldErrors: {
        title: 'Give the case a name, for example the visa and the year.',
        travelEndDate: 'The trip cannot end before it starts.',
      },
      values: { title: '', destination: 'JP', purpose: 'tourism', travelEndDate: '2026-01-01' },
      attempt: 1,
    };
    const html = render();
    const title = html.match(/<input[^>]*name="title"[^>]*>/)?.[0] ?? '';
    expect(title).toContain('aria-invalid="true"');
    const describedBy = title.match(/aria-describedby="([^"]+)"/)?.[1] ?? '';
    expect(html).toContain(
      `id="${describedBy}" class="field-msg field-msg-err case-field-error">Give the case a name`,
    );
    const end = html.match(/<input[^>]*name="travelEndDate"[^>]*>/)?.[0] ?? '';
    expect(end).toContain('aria-invalid="true"');
    expect(end).toContain('value="2026-01-01"');
    const start = html.match(/<input[^>]*name="travelStartDate"[^>]*>/)?.[0] ?? '';
    expect(start).not.toContain('aria-invalid');
    // The fold-out holding a field with a problem opens by itself.
    expect(html).toMatch(/<details class="disclosure" open="">/);
    expect(html).toContain('<option value="JP" selected="">Japan</option>');
    expect(html).toContain('<option value="tourism" selected="">Tourism</option>');
    expect(html).toContain('Check the 2 fields marked above.');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('keeps the fold-out closed when nothing inside it has a problem', () => {
    forced.state = {
      ok: false,
      message: 'Check the field marked above.',
      field: 'title',
      fieldErrors: { title: 'Give the case a name, for example the visa and the year.' },
      values: {},
      attempt: 1,
    };
    expect(render()).toMatch(/<details class="disclosure">/);
  });

  it('passes the accessibility scan as a person first meets it', async () => {
    expect(await axeViolations(render())).toEqual([]);
  });
});
