import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { readingOffer, readingStatusCopy } from '../../../../lib/document-reading';
import { textOf } from '../../../../lib/next-mocks.test-support';
import { ReadingOfferCard, ReadingSourceNote, ReadingStatus } from './reading-status';

/** S6 (ADR 0019): the status, source note and invitation are announced, named and reachable. */

const STAGES = ['checking', 'reading', 'found', 'could_not_read', 'needs_attention'] as const;

function status(stage: (typeof STAGES)[number]) {
  const copy = readingStatusCopy({ stage }, { canReadAgain: true });
  if (!copy) throw new Error('no copy');
  return renderToStaticMarkup(<ReadingStatus copy={copy} stage={stage} applicantId="a1" />);
}

describe('the reading status', () => {
  it('holds the state name and its sentence in one polite status, in every state', () => {
    for (const stage of STAGES) {
      const html = status(stage);
      expect(html, stage).toContain('<output class="reading-status-text">');
      expect(html, stage).toContain(`data-stage="${stage}"`);
      expect(textOf(html), stage).toContain(readingStatusCopy({ stage })?.title ?? '?');
    }
  });

  it('offers the way forward only for a file that could not be read', () => {
    for (const stage of STAGES) {
      const html = status(stage);
      if (stage === 'could_not_read') {
        expect(html).toContain('href="/app/applicant/a1/profile"');
        expect(textOf(html)).toContain('Add the Details Yourself');
      } else {
        expect(html, stage).not.toContain('<a ');
      }
    }
  });

  it('has no accessibility faults in any state', async () => {
    for (const stage of STAGES) {
      expect(await axeViolations(status(stage)), stage).toEqual([]);
    }
  });
});

describe('the source note', () => {
  it('names the source and explains it, and prefers the suggestion’s own sentence', () => {
    const general = renderToStaticMarkup(<ReadingSourceNote source="ai_image" />);
    expect(textOf(general)).toContain('Read with AI');
    expect(textOf(general)).toContain('Read from a picture of the file by an AI service.');
    const own = renderToStaticMarkup(
      <ReadingSourceNote source="machine_readable" detail="A sentence of its own." />,
    );
    expect(textOf(own)).toContain('A sentence of its own.');
    expect(textOf(own)).not.toContain('No AI was used.');
  });

  it('has no accessibility faults', async () => {
    for (const source of ['machine_readable', 'document_text', 'ai_image'] as const) {
      expect(
        await axeViolations(renderToStaticMarkup(<ReadingSourceNote source={source} />)),
      ).toEqual([]);
    }
  });
});

describe('the invitation to switch reading on', () => {
  const offer = readingOffer({
    detailsAvailable: true,
    scansAvailable: true,
    detailsGranted: false,
    scansGranted: false,
  });

  it('asks the question, explains in two sentences, and links to where permissions live', () => {
    if (!offer) throw new Error('no offer');
    const html = renderToStaticMarkup(<ReadingOfferCard offer={offer} />);
    expect(textOf(html)).toContain('Want VisaStack to read your documents for you?');
    expect(html).toContain('href="/app#permissions"');
    expect(textOf(html)).toContain('Turn On Reading with AI');
  });

  it('has no accessibility faults', async () => {
    if (!offer) throw new Error('no offer');
    expect(await axeViolations(renderToStaticMarkup(<ReadingOfferCard offer={offer} />))).toEqual(
      [],
    );
  });
});
