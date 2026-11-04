import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { describeReading } from '../../../../../../lib/reading-state';
import { isTitleCase } from '../../../../../../lib/title-case';

vi.mock('./actions', () => ({ setReadingAction: vi.fn() }));

const { ReadingSwitch } = await import('./reading-switch');

const on = { available: true, reason: null } as const;
const html = (
  feature: Parameters<typeof describeReading>[0]['feature'],
  extraction: boolean,
  ocr: boolean,
) =>
  renderToStaticMarkup(
    <ReadingSwitch applicantId="a1" view={describeReading({ feature, extraction, ocr })} />,
  );

describe('the automatic reading switch', () => {
  it('when fully on, says so and offers only Turn Off', () => {
    const out = html(on, true, true);
    expect(out).toContain('Automatic Reading Is On');
    expect(out).toContain('Turn Off Automatic Reading');
    expect(out).not.toContain('Turn On');
    expect(out).not.toContain('Reading scans:');
  });

  it('when off for the person, says so, offers only Turn On, and says what is sent first', () => {
    const out = html(on, false, false);
    expect(out).toContain('Automatic Reading Is Off for You');
    expect(out).toContain('Turn On Automatic Reading');
    expect(out).not.toContain('Turn Off Automatic Reading');
    // What is sent is stated beside the button, never hidden behind a disclosure.
    expect(out).toContain('Reading scans:');
    expect(out).toContain('the picture of a scan is sent to an AI service');
    expect(out).toContain('the text of a document is sent to an AI service');
    expect(out).not.toContain('<details');
    expect(out).toContain('href="/app/privacy"');
  });

  it('when only one kind is allowed, says which and offers both buttons', () => {
    const out = html(on, true, false);
    expect(out).toContain('Automatic Reading Is Partly On');
    expect(out).toContain('Turn On Both Kinds');
    expect(out).toContain('Turn Off Automatic Reading');
  });

  it('when the platform has it off, says so and offers no switch at all, whatever the person allowed', () => {
    const out = html({ available: false, reason: 'turned_off' }, true, true);
    expect(out).toContain('Automatic Reading Is Off');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('Reading scans:');
  });

  it('names every button in Title Case', () => {
    for (const label of [
      'Turn On Automatic Reading',
      'Turn Off Automatic Reading',
      'Turn On Both Kinds',
    ]) {
      expect(isTitleCase(label)).toBe(true);
    }
  });
});
