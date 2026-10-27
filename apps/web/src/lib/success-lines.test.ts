import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { progressRingPercent, progressRingWords, readyNote } from './readiness-words';
import * as lines from './success-lines';

/** Every sentence the success lines module can produce, with sample inputs. */
function allLines(): string[] {
  const out: string[] = [];
  for (const value of Object.values(lines)) {
    if (typeof value === 'string') out.push(value);
  }
  out.push(
    lines.documentAddedLine('Passport'),
    lines.documentAddedLine(null),
    lines.detailSavedLine('Passport Number'),
    lines.documentTypeSavedLine('Bank Statement'),
    lines.checklistAttachedLine({ requiredCount: 9, satisfiedRequired: 3 }),
    lines.checklistAttachedLine(null),
    lines.evidenceChosenLine({ requiredCount: 9, satisfiedRequired: 9 }),
    lines.invitationReadyLine('sent', '7 days'),
    lines.invitationReadyLine('pending', '7 days'),
    lines.invitationReadyLine('failed', '7 days'),
    lines.invitationReadyLine('none', null),
    lines.shareInvitedLine('sent'),
    lines.shareInvitedLine('pending'),
    lines.shareInvitedLine('failed'),
    lines.otherItemSavedLine('Visa History'),
    lines.memberAddedLine('Reviewer'),
  );
  return out;
}

describe('the checklist count in words', () => {
  it('reads "N of M items ready" and never claims a decision', () => {
    expect(progressRingWords(6, 9)).toBe('6 of 9 items ready');
    expect(progressRingWords(0, 9)).toBe('0 of 9 items ready');
    expect(progressRingWords(1, 1)).toBe('1 of 1 item ready');
    expect(readyNote({ requiredCount: 9, satisfiedRequired: 3 })).toBe(' 3 of 9 items ready.');
  });

  it('makes up no number: nothing to count, nothing said', () => {
    expect(readyNote(null)).toBe('');
    expect(readyNote({ requiredCount: 0, satisfiedRequired: 0 })).toBe('');
  });

  it('never counts more ready than there are items, or less than none', () => {
    expect(readyNote({ requiredCount: 4, satisfiedRequired: 7 })).toBe(' 4 of 4 items ready.');
    expect(progressRingPercent(7, 4)).toBe(100);
    expect(progressRingPercent(-1, 4)).toBe(0);
    expect(progressRingPercent(1, 0)).toBe(0);
    expect(progressRingPercent(1, 4)).toBe(25);
  });

  it('never lets rounding make an unfinished ring look finished or a started one look empty', () => {
    expect(progressRingPercent(299, 300)).toBe(99);
    expect(progressRingPercent(1, 300)).toBe(1);
    expect(progressRingPercent(300, 300)).toBe(100);
    expect(progressRingPercent(0, 300)).toBe(0);
  });
});

describe('success lines', () => {
  const sentences = allLines();

  it('are specific: none is a bare Saved, Done, Success or OK', () => {
    expect(sentences.length).toBeGreaterThan(12);
    for (const line of sentences) {
      expect(line, line).not.toMatch(/^(saved|done|success|ok|updated|sent|added|created)\.?$/i);
      expect(line.length, line).toBeGreaterThan(14);
    }
  });

  it('never read readiness as approval', () => {
    for (const line of sentences) {
      expect(line, line).not.toMatch(/\b(approved|cleared|accepted|guarantee[ds]?|eligible)\b/i);
    }
  });

  it('carry no placeholder, address or typed value, and no em dash', () => {
    const dash = String.fromCodePoint(0x2014);
    for (const line of sentences) {
      expect(line, line).not.toMatch(/\$\{|undefined|null|\[object|@/);
      expect(line, line).not.toContain(dash);
    }
  });

  it('say which item of the checklist moved, with the count, when it is known', () => {
    expect(lines.checklistAttachedLine({ requiredCount: 9, satisfiedRequired: 3 })).toBe(
      'Checklist attached. 3 of 9 items ready.',
    );
    expect(lines.evidenceChosenLine({ requiredCount: 9, satisfiedRequired: 4 })).toBe(
      'Evidence chosen for this item. 4 of 9 items ready.',
    );
  });

  it('promise no count for a file that is still being checked', () => {
    expect(lines.documentAddedLine('Passport')).toBe(
      'Passport added. It counts toward a checklist once its safety scan finishes.',
    );
    expect(lines.documentAddedLine('Passport')).not.toMatch(/\d/);
  });
});

describe('the main flows use them', () => {
  const root = join(__dirname, '..', 'app', 'app');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  it('no main flow action answers with a bare Saved, Done or Success', () => {
    for (const path of [
      'applicant/[id]/actions.ts',
      'applicant/[id]/section-actions.ts',
      'applicant/[id]/evidence/actions.ts',
      'applicant/[id]/sharing/actions.ts',
      'agency/[orgId]/actions.ts',
      'mission/[id]/actions.ts',
    ]) {
      const source = read(path);
      expect(source, path).not.toMatch(
        /message:\s*'(?:Saved|Done|Success|OK|Updated|Sent|Added|Created)\.?'/,
      );
    }
  });

  it.each([
    ['applicant/[id]/actions.ts', 'documentAddedLine('],
    ['applicant/[id]/actions.ts', 'detailSavedLine('],
    ['applicant/[id]/actions.ts', 'SUGGESTION_SAVED_LINE'],
    ['applicant/[id]/actions.ts', 'documentTypeSavedLine('],
    ['applicant/[id]/evidence/actions.ts', 'EVIDENCE_SENT_LINE'],
    ['applicant/[id]/sharing/actions.ts', 'SHARE_CREATED_LINE'],
    ['applicant/[id]/sharing/actions.ts', 'shareInvitedLine('],
    ['agency/[orgId]/actions.ts', 'invitationReadyLine('],
    ['agency/[orgId]/actions.ts', 'REQUEST_SENT_LINE'],
    ['agency/[orgId]/actions.ts', 'memberAddedLine('],
    ['mission/[id]/actions.ts', 'checklistAttachedLine('],
    ['mission/[id]/actions.ts', 'evidenceChosenLine('],
  ])('%s uses %s', (path, needle) => {
    expect(read(path)).toContain(needle);
  });

  it('no screen decides what to do by comparing the wording of a success line', () => {
    // A form that clears itself on "Saved." breaks silently when the line gets more specific.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
          if (/\.message\s*(?:===|!==|==)\s*'(?!')[^']/.test(readFileSync(path, 'utf8'))) {
            found.push(path);
          }
        }
      }
    };
    walk(root);
    expect(found).toEqual([]);
  });

  it('puts no typed value or address in a line that names what was shared or invited', () => {
    const sharing = read('applicant/[id]/sharing/actions.ts');
    expect(sharing).not.toMatch(/message:\s*`[^`]*\$\{recipientEmail\}/);
    const agency = read('agency/[orgId]/actions.ts');
    expect(agency).not.toMatch(/message:\s*`[^`]*\$\{(?:memberEmail|contactDestination)\}/);
  });
});
