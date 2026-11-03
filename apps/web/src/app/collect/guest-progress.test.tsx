import type { GuestChecklistItem, GuestFileView, GuestUploadDesk } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuestChecklist, mandatoryUnits, suggestedOnlyIds } from './checklist';
import { GuestFileList } from './guest-desk-files';
import {
  GuestBar,
  GuestProgress,
  METER_SEGMENTS,
  type SubmitBlocker,
  fileTally,
  mandatoryStanding,
} from './guest-progress';

/**
 * What the guest desk says about progress (UMPE P13): only Mandatory items are counted, an
 * any-one-of group counts once, each checklist line shows where it stands in words, and what
 * never holds up a submission folds away without being hidden. Synthetic values only.
 */

function item(
  id: string,
  label: string,
  necessity: GuestChecklistItem['necessity'],
  extra: Partial<GuestChecklistItem> = {},
): GuestChecklistItem {
  return {
    id,
    label,
    kind: 'DOCUMENT',
    necessity,
    provenance: 'OFFICIAL',
    groupKey: null,
    note: null,
    order: 1,
    ...extra,
  };
}

const PASSPORT = item('p', 'Passport', 'MANDATORY');
const PHOTO = item('ph', 'Recent Photo', 'MANDATORY');
const BANK = item('b', 'Bank Statement', 'CONDITIONAL', { groupKey: 'funds' });
const SPONSOR = item('s', 'Sponsor Letter', 'CONDITIONAL', { groupKey: 'funds' });
const HOTEL = item('h', 'Hotel Booking', 'RECOMMENDED');
const LETTER = item('l', 'Cover Letter', 'RECOMMENDED', { provenance: 'AGENCY_ADDED' });
const ALL = [PASSPORT, PHOTO, BANK, SPONSOR, HOTEL, LETTER];

function file(
  id: string,
  itemId: string | null,
  extra: Partial<GuestFileView> = {},
): GuestFileView {
  return {
    id,
    name: `${id}.pdf`,
    sizeBytes: 1200,
    status: 'ready',
    virusScanned: false,
    itemId,
    mapping: itemId ? 'chosen' : null,
    sent: false,
    ...extra,
  };
}

describe('what counts as Mandatory', () => {
  it('counts Mandatory items only, agency-added ones by their own necessity', () => {
    const units = mandatoryUnits([
      ...ALL,
      item('a', 'Agency Form', 'MANDATORY', { provenance: 'AGENCY_ADDED' }),
    ]);
    expect(units.map((u) => u.key)).toEqual(['p', 'ph', 'a']);
  });

  it('counts an any-one-of group once, by its strongest official member', () => {
    const mandatoryGroup = [
      item('x', 'Visa Photo', 'MANDATORY', { groupKey: 'g' }),
      item('y', 'ID Card Photo', 'RECOMMENDED', { groupKey: 'g' }),
    ];
    const units = mandatoryUnits(mandatoryGroup);
    expect(units).toHaveLength(1);
    expect(units[0]?.items.map((i) => i.id)).toEqual(['x', 'y']);
    expect(mandatoryUnits([BANK, SPONSOR])).toEqual([]);
  });

  it('is covered when any member of a Mandatory group has a file', () => {
    const group = [
      item('x', 'Visa Photo', 'MANDATORY', { groupKey: 'g' }),
      item('y', 'ID Card Photo', 'MANDATORY', { groupKey: 'g' }),
    ];
    expect(mandatoryStanding(group, ['x', 'y'])).toMatchObject({
      total: 1,
      done: 0,
      next: 'One of Visa Photo or ID Card Photo',
    });
    expect(mandatoryStanding(group, ['y'])).toMatchObject({ total: 1, done: 1, next: null });
  });

  it('reports done, total and the first open item, and notes Mandatory If It Applies', () => {
    expect(mandatoryStanding(ALL, ['ph', 'b', 's', 'h', 'l'])).toEqual({
      total: 2,
      done: 1,
      next: 'Recent Photo',
      hasConditional: true,
    });
    expect(mandatoryStanding([HOTEL], ['h'])).toEqual({
      total: 0,
      done: 0,
      next: null,
      hasConditional: false,
    });
  });

  it('tallies placed files and ready files that still need an item', () => {
    expect(
      fileTally([
        file('a', 'p'),
        file('b', null),
        file('c', 'ph', { status: 'checking' }),
        file('d', 'h', { status: 'refused' }),
        file('e', 'b', { mapping: 'proposed' }),
      ]),
      // No item, refused, and a name suggestion each need a look; a file still being checked does not.
    ).toEqual({ placed: 1, needsLook: 3 });
    // A stalled or refused file needs the guest too, so the pinned summary never reads all clear.
    expect(
      fileTally([
        file('a', 'p'),
        file('s', null, { status: 'stalled' }),
        file('r', 'ph', { status: 'refused' }),
      ]),
    ).toEqual({ placed: 1, needsLook: 2 });
  });
});

describe('the progress strip', () => {
  const html = (
    missing: string[],
    blocker: SubmitBlocker = null,
    agency: string | null = 'Harbour Travel Desk',
  ) =>
    renderToStaticMarkup(
      <GuestProgress
        standing={mandatoryStanding(ALL, missing)}
        agencyName={agency}
        blocker={blocker}
      />,
    );

  it('says how many Mandatory items are placed and what is next, without ever saying Reviewed', () => {
    const text = html(['p', 'ph', 'b', 's', 'h', 'l']);
    expect(text).toContain('0 of 2 Mandatory Items Placed');
    expect(text).toContain('Next: Passport.');
    expect(text).toContain('Items marked Mandatory If It Applies are yours to check');
    expect(text).toContain('aria-label="0 of 2 mandatory items placed"');
    expect(text).not.toContain('Reviewed');
  });

  it('turns calm and complete once every Mandatory item is placed', () => {
    const text = html(['b', 's', 'h', 'l']);
    expect(text).toContain('All Mandatory Items Placed');
    expect(text).toContain('collect-progress-complete');
    expect(text).toContain('Harbour Travel Desk receives only what you choose to send.');
    expect(text.match(/collect-meter-on/g)).toHaveLength(2);
  });

  it('does not count a suggestion from a file name as placed, and says what to check', () => {
    const open = mandatoryStanding(ALL, ['ph', 'b', 's', 'h', 'l'], ['p']);
    expect(open).toMatchObject({
      total: 2,
      done: 0,
      next: 'Check the file suggested for Passport',
    });
    const confirmed = mandatoryStanding(ALL, ['ph', 'b', 's', 'h', 'l'], []);
    expect(confirmed).toMatchObject({ done: 1, next: 'Recent Photo' });
    // A group is covered only by a confirmed member.
    const group = [
      item('x', 'Visa Photo', 'MANDATORY', { groupKey: 'g' }),
      item('y', 'ID Card Photo', 'MANDATORY', { groupKey: 'g' }),
    ];
    expect(mandatoryStanding(group, ['y'], ['x'])).toMatchObject({ done: 0 });
    expect(mandatoryStanding(group, ['y'], [])).toMatchObject({ done: 1 });
  });

  it('finds the items whose only file is a suggestion, by the rule a line uses', () => {
    const files = [
      file('f1', 'p', { mapping: 'proposed' }),
      file('f2', 'ph'),
      file('f3', 'ph', { mapping: 'proposed' }),
    ];
    expect(suggestedOnlyIds(ALL, files, ['b', 's', 'h', 'l'])).toEqual(['p']);
  });

  it('never says you can send while the Submit button is not ready', () => {
    const retention = html(['b', 's', 'h', 'l'], 'retention');
    expect(retention).toContain('All Mandatory Items Placed');
    expect(retention).toContain('Choose how long Harbour Travel Desk may keep your files');
    expect(retention).not.toContain('You can send now');
    const checking = html(['b', 's', 'h', 'l'], 'checking');
    expect(checking).toContain('Your files are still being checked');
    expect(checking).not.toContain('You can send now');
  });

  it('does not invent a target when nothing is Mandatory', () => {
    const text = renderToStaticMarkup(
      <GuestProgress
        standing={mandatoryStanding([HOTEL], ['h'])}
        agencyName={null}
        blocker={null}
      />,
    );
    expect(text).toContain('Add What You Have');
    expect(text).toContain('Nothing on this list is marked Mandatory');
    expect(text).not.toContain('collect-meter"');
  });

  it('scales a long list to a bounded meter', () => {
    const many = Array.from({ length: 30 }, (_, n) => item(`m${n}`, `Item ${n}`, 'MANDATORY'));
    const text = renderToStaticMarkup(
      <GuestProgress
        standing={mandatoryStanding(
          many,
          many.slice(0, 15).map((i) => i.id),
        )}
        agencyName={null}
        blocker={null}
      />,
    );
    const segments = (text.match(/collect-meter-(on|off)/g) ?? []).length;
    expect(segments).toBe(METER_SEGMENTS);
    expect(text.match(/collect-meter-on/g)).toHaveLength(METER_SEGMENTS / 2);
  });

  it('pins a phone summary that names what needs the guest first', () => {
    const bar = (placed: number, left: number, needsLook: number, total = 2) =>
      renderToStaticMarkup(
        <GuestBar placed={placed} left={left} total={total} needsLook={needsLook} />,
      );
    expect(bar(1, 2, 0)).toContain('1 File Placed');
    expect(bar(3, 2, 0)).toContain('2 mandatory open');
    expect(bar(3, 0, 0)).toContain('All mandatory placed');
    expect(bar(3, 0, 2)).toContain('2 files need a look');
    expect(bar(3, 0, 1)).toContain('1 file needs a look');
    expect(bar(3, 0, 1)).toContain('href="#guest-submit"');
    // With nothing Mandatory, it never claims every mandatory item is placed.
    expect(bar(0, 0, 0, 0)).toContain('Nothing mandatory');
    expect(bar(0, 0, 0, 0)).not.toContain('All mandatory placed');
  });
});

describe('the checklist with file state', () => {
  const progress = (missing: string[], files: GuestFileView[]) => ({
    files,
    stillMissing: missing,
  });

  it('keeps every word and shows no state before the guest can add files', () => {
    const html = renderToStaticMarkup(<GuestChecklist items={ALL} />);
    expect(html).toContain('Mandatory · Official Requirement');
    expect(html).not.toContain('Still Missing');
    expect(html).not.toContain('<details');
  });

  it('says Placed, Still Missing and Another Choice Placed in words, with the file under its item', () => {
    const html = renderToStaticMarkup(
      <GuestChecklist
        items={ALL}
        progress={progress(['ph', 's', 'h', 'l'], [file('passport', 'p'), file('bank', 'b')])}
      />,
    );
    expect(html).toContain('collect-item-placed');
    expect(html).toContain('Placed');
    expect(html).toContain('Still Missing');
    expect(html).toContain('Another Choice Placed');
    expect(html).toContain('passport.pdf');
    expect(html).toContain('bank.pdf');
  });

  it('marks a suggestion from the file name as one until the guest confirms it', () => {
    const html = renderToStaticMarkup(
      <GuestChecklist
        items={[HOTEL]}
        progress={progress([], [file('hotel', 'h', { mapping: 'proposed' })])}
      />,
    );
    expect(html).toContain('suggested from its name: check it');
    expect(html).toContain('Suggested, Check It');
    expect(html).toContain('collect-item-suggested');
    expect(html).not.toContain('collect-mark-placed');
  });

  it('keeps an agency-added Mandatory item open where the strip can point at it', () => {
    const added = item('a', 'Agency Form', 'MANDATORY', { provenance: 'AGENCY_ADDED' });
    const html = renderToStaticMarkup(
      <GuestChecklist items={[added, HOTEL]} progress={progress(['a', 'h'], [])} />,
    );
    expect(html).toContain('Agency Form');
    expect(html).toMatch(/aria-label="Requested by Your Agency"><h2/);
    expect(html).toContain('Still Missing');
  });

  it('counts a choice covered by its group as not missing when a section folds', () => {
    const pair = [
      item('r1', 'Old Passport Copy', 'RECOMMENDED', { groupKey: 'copies' }),
      item('r2', 'New Passport Copy', 'RECOMMENDED', { groupKey: 'copies' }),
    ];
    const html = renderToStaticMarkup(
      <GuestChecklist items={pair} progress={progress(['r2'], [file('f', 'r1')])} />,
    );
    expect(html).toContain('2 items, none missing');
    expect(html).toContain('Another Choice Placed');
  });

  it('keeps Mandatory sections open and folds what never holds up a submission', () => {
    const html = renderToStaticMarkup(
      <GuestChecklist items={ALL} progress={progress(['p', 'ph', 'b', 's', 'h', 'l'], [])} />,
    );
    const folds = html.match(/<details class="collect-fold"/g) ?? [];
    expect(folds).toHaveLength(2);
    expect(html).not.toMatch(/<details class="collect-fold" open/);
    expect(html).toContain('1 item, 1 still missing');
    // The folded items are still in the page, and Mandatory sections are not folded.
    expect(html).toContain('Hotel Booking');
    expect(html).toContain('Cover Letter');
    expect(html).toMatch(/<section class="collect-section" aria-label="Mandatory"><h2/);
  });

  it('shows a necessity or source only where the heading does not already say it', () => {
    const html = renderToStaticMarkup(
      <GuestChecklist items={ALL} progress={progress(['p', 'ph', 'b', 's', 'h', 'l'], [])} />,
    );
    expect(html).not.toContain('Mandatory · Official Requirement');
    expect(html).toContain('Recommended');
    expect(html).toContain('Requested by Your Agency');
  });
});

describe('the guest file list', () => {
  const desk = (files: GuestFileView[]): GuestUploadDesk => ({
    files,
    stillMissing: [],
    submissions: [],
  });
  const options = [PASSPORT, PHOTO];

  it('shows nothing when there are no files', () => {
    expect(renderToStaticMarkup(<GuestFileList desk={desk([])} items={options} />)).toBe('');
  });

  it('keeps a file that needs an item open, and folds files already placed', () => {
    const html = renderToStaticMarkup(
      <GuestFileList
        desk={desk([
          file('loose', null),
          file('done', 'p'),
          file('maybe', 'ph', { mapping: 'proposed' }),
        ])}
        items={options}
      />,
    );
    expect(html).toContain('Choose which item it is for');
    expect(html.match(/collect-file-choose/g)).toHaveLength(2);
    expect(html).toContain('Files Already Placed');
    expect(html).toContain('1 file');
    // The suggested one needs a look, so it stays out of the fold.
    expect(html.indexOf('maybe.pdf')).toBeLessThan(html.indexOf('Files Already Placed'));
    expect(html.indexOf('done.pdf')).toBeGreaterThan(html.indexOf('Files Already Placed'));
  });

  it('is one fold, with one heading, when every file is placed and confirmed', () => {
    const html = renderToStaticMarkup(
      <GuestFileList desk={desk([file('a', 'p'), file('b', 'ph')])} items={options} />,
    );
    expect(html.match(/Your Files/g)).toHaveLength(1);
    expect(html).toContain('2 files, all placed');
    expect(html).toContain('Change Item');
    expect(html).toContain('Remove');
  });
});
