import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../../../lib/axe.test-support';
import { isTitleCase } from '../../../../../../../lib/title-case';

vi.mock('./actions', () => ({ keepCopyAction: vi.fn() }));
const { KeepCopyAction } = await import('./keep-copy-action');

const base = {
  applicantId: 'a1',
  documentId: 'd1',
  documentName: 'Marriage Certificate',
  onClose: () => undefined,
};
const html = (people: { id: string; name: string }[]) =>
  renderToStaticMarkup(<KeepCopyAction {...base} copyPeople={people} />);

describe('Also Keep a Copy for Another Person', () => {
  it('with one other person asks one question and sends that person', () => {
    const out = html([{ id: 'a2', name: 'Salma Sadat' }]);
    expect(out).toContain(
      'Keep a copy of <strong>Marriage Certificate</strong> for <strong>Salma Sadat</strong>?',
    );
    expect(out).toContain('name="targetId" value="a2"');
    expect(out).not.toContain('type="radio"');
    expect(out).toContain('Keep a Copy');
    expect(out).toContain('aria-label="Keep a Copy for Salma Sadat"');
  });

  it('with several people asks whom, with nobody chosen to start', () => {
    const out = html([
      { id: 'a2', name: 'Salma Sadat' },
      { id: 'a3', name: 'Nila Sadat' },
    ]);
    expect(out).toContain('Keep a Copy of Marriage Certificate for Whom?');
    expect(out.match(/type="radio"/g)).toHaveLength(2);
    expect(out).not.toContain('checked=""');
    expect(out).toContain('required=""');
  });

  it('says plainly that it is a separate copy, checked for safety, and that removing one leaves the other', () => {
    const out = html([{ id: 'a2', name: 'Salma Sadat' }]);
    expect(out).toContain('It is a separate copy, checked for safety like any new file.');
    expect(out).toContain('Removing one does not remove the other.');
  });

  it('says so, and offers only Close, when there is no one else', () => {
    const out = html([]);
    expect(out).toContain('There is no one else on your account to keep a copy for.');
    expect(out).not.toContain('<form');
  });

  it('names its buttons in Title Case and has no accessibility problems', async () => {
    for (const label of ['Keep a Copy', 'Cancel', 'Close', 'Open Their Documents']) {
      expect(isTitleCase(label)).toBe(true);
    }
    expect(
      await axeViolations(
        html([
          { id: 'a2', name: 'Salma Sadat' },
          { id: 'a3', name: 'Nila Sadat' },
        ]),
      ),
    ).toEqual([]);
  });
});
