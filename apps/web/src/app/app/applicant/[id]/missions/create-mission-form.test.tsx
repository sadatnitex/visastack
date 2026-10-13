import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ createMissionAction: vi.fn() }));

const { CreateMissionForm } = await import('./create-mission-form');

const html = renderToStaticMarkup(<CreateMissionForm applicantId="a-1" />);

describe('CreateMissionForm', () => {
  it('asks two questions first and keeps the rest under one fold-out', () => {
    const opening = html.slice(0, html.indexOf('<details'));
    expect(opening).toContain('What is this case for?');
    expect(opening).toContain('Where are you going?');
    expect(opening).not.toContain('name="purpose"');
    expect(html).toContain('Add more details (optional)');
  });

  it('still sends every field it sent before, with the same names', () => {
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
});
