import type { AttentionItem, AttentionKind } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AttentionRow, attentionPictureFor } from './attention-row';

const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  key: 'task:t1',
  kind: 'task',
  tier: 3,
  title: 'Task Due Soon',
  why: 'A step in this case is coming up.',
  applicantId: 'p1',
  applicantName: 'Salma Rahman',
  caseId: 'c1',
  caseTitle: 'Synthetic Case',
  dueDate: '2030-01-10',
  dueState: 'due_soon',
  daysUntilDue: 3,
  sentBack: false,
  count: null,
  subject: null,
  href: '/app/case/c1',
  createdAt: '2030-01-01T00:00:00.000Z',
  ...over,
});

const CONTEXT = 'Salma Rahman \u00b7 Synthetic Case';

const row = (over: Partial<AttentionItem> = {}, extra: { readonly tierLabel?: string } = {}) =>
  renderToStaticMarkup(
    <ol>
      <AttentionRow
        item={item(over)}
        heading={over.title ?? 'Task Due Soon'}
        context={CONTEXT}
        when="Due on 10 Jan 2030"
        tierLabel={extra.tierLabel ?? 'Due Soon'}
        actionLabel="Open Case"
      />
    </ol>,
  );

describe('AttentionRow', () => {
  it('is one row: picture, title, person line, urgency word, and one action button', () => {
    const html = row();
    expect(html.match(/<li /g)).toHaveLength(1);
    expect(html).toContain('do-next-item');
    expect(html).toContain('do-next-tier-3');
    expect(html).toContain('<h3');
    expect(html).toContain('Task Due Soon');
    expect(html).toContain('Salma Rahman · Synthetic Case');
    expect(html).toContain('>Due Soon<');
    expect(html.match(/class="btn btn-secondary do-next-link"/g)).toHaveLength(1);
    expect(html).toContain('href="/app/case/c1"');
    expect(html).toContain('Open Case');
    expect(html).toContain('expandable-section-picture');
  });

  it('keeps the long sentence inside the row body and the date visible beside the person', () => {
    const html = row();
    const body = html.slice(
      html.indexOf('expandable-section-body'),
      html.indexOf('home-attention-meta'),
    );
    expect(body).toContain('A step in this case is coming up.');
    expect(body).not.toContain('Due on 10 Jan 2030');
    expect(html.slice(html.indexOf('home-attention-meta'))).toContain('Due on 10 Jan 2030');
    expect(html).not.toContain(' open=""');
  });

  it('shows a Date Unknown badge when the item can have a date and has none', () => {
    const html = renderToStaticMarkup(
      <ol>
        <AttentionRow
          item={item({ dueDate: null, dueState: 'unknown' })}
          heading="Task Due Soon"
          context=""
          when={null}
          tierLabel="Still Open"
          actionLabel="Open Case"
        />
      </ol>,
    );
    expect(html).toContain('Date Unknown');
  });

  it('draws a document picture for a document item and never leaks a document value', () => {
    const html = row({
      kind: 'document_expiry',
      tier: 6,
      subject: { kind: 'document', docType: 'PASSPORT' },
    });
    expect(html).toMatch(/class="pic /);
  });

  it('keeps the suggestion wording true: nothing is added until approved', () => {
    const html = row({
      kind: 'suggestions',
      tier: 7,
      why: 'Details were read from a document. Nothing is added to the profile until you approve it.',
    });
    expect(html).toContain('Nothing is added to the profile until you approve it.');
  });

  it('adds a sr-only name to the button so a list of buttons is told apart', () => {
    expect(row()).toContain('<span class="sr-only">: Task Due Soon</span>');
  });
});

describe('attentionPictureFor', () => {
  it('uses a document for expiry and document requests, and a mark for every other kind', () => {
    const kinds: AttentionKind[] = [
      'evidence_request',
      'task',
      'case_changed',
      'document_expiry',
      'suggestions',
      'sharing_invitations',
    ];
    for (const kind of kinds) expect(attentionPictureFor(item({ kind }))).toBeTruthy();
    expect(
      attentionPictureFor(
        item({
          kind: 'evidence_request',
          subject: {
            kind: 'request',
            requestKind: 'DOCUMENT',
            docType: 'BANK_STATEMENT',
            fieldKey: null,
          },
        }),
      ).type,
    ).toBe('document');
    expect(attentionPictureFor(item({ kind: 'sharing_invitations' })).type).toBe('icon');
  });
});
