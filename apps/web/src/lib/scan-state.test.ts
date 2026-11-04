import { BasicSafetyScanner, ClamAvScanner } from '@visastack/adapters';
import { TRUSTED_VIRUS_SCANNER_NAMES, type VersionScanKind } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { addCheckStep, presentScanState, uploadCheckNotice } from './scan-state';

const KINDS: readonly VersionScanKind[] = [
  'VIRUS_SCANNED',
  'FORMAT_CHECKED',
  'WAITING',
  'CHECKING',
  'DELAYED',
  'HELD',
  'FAILED',
];

const blobStore = {} as never;

describe('the scanner names the evidence trusts', () => {
  it('is tied to the real antivirus engine, and not to the built-in structural checker', () => {
    const engine = new ClamAvScanner({ blobStore, host: '127.0.0.1', port: 3310 });
    expect(TRUSTED_VIRUS_SCANNER_NAMES.has(engine.name)).toBe(true);
    const structural = new BasicSafetyScanner({ blobStore });
    expect(TRUSTED_VIRUS_SCANNER_NAMES.has(structural.name)).toBe(false);
  });
});

describe('presentScanState', () => {
  it('has one distinct, plain label for every kind and says virus scanned for exactly one', () => {
    const shown = KINDS.map((kind) => presentScanState({ kind }));
    expect(new Set(shown.map((s) => s.label)).size).toBe(KINDS.length);
    expect(shown.filter((s) => s.virusScanned).map((s) => s.kind)).toEqual(['VIRUS_SCANNED']);
    for (const s of shown) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(0);
      expect(s.badgeClass).toBe(`badge-${s.tone}`);
    }
  });

  it('only a virus scanned file is worded as scanned; the others never use the word', () => {
    for (const kind of KINDS) {
      const s = presentScanState({ kind });
      const words = `${s.label} ${s.detail} ${s.recipientNote ?? ''}`;
      if (kind === 'VIRUS_SCANNED') {
        expect(words).toContain('virus');
      } else {
        // Saying a file was NOT scanned is the point; saying it WAS is for the scanned kind only.
        const withoutNegation = words.replace(/not (been )?scanned for viruses/gi, '');
        expect(withoutNegation, kind).not.toMatch(/scanned for viruses|checked for viruses/i);
        expect(words, kind).not.toMatch(/\b(safe|clean|no problems)\b/i);
      }
    }
  });

  it('calls a format-only file Format Checked and says out loud that no virus scan happened', () => {
    const s = presentScanState({ kind: 'FORMAT_CHECKED' });
    expect(s.label).toBe('Format Checked');
    expect(s.detail).toContain('has not been scanned for viruses');
    expect(s.recipientNote).toBe('File type checked. Not scanned for viruses.');
    expect(s.tone).toBe('neutral');
  });

  it('asks a recipient to be warned, never blocked, only for a usable file that was not virus scanned', () => {
    const warned = KINDS.filter((kind) => presentScanState({ kind }).warn);
    expect(warned).toEqual(['FORMAT_CHECKED']);
    // A file the existing rules refuse has no recipient line to show.
    for (const kind of ['WAITING', 'CHECKING', 'DELAYED', 'HELD', 'FAILED'] as const) {
      expect(presentScanState({ kind }).recipientNote, kind).toBeNull();
    }
  });

  it('reads missing evidence as waiting, never as scanned', () => {
    for (const none of [null, undefined]) {
      const s = presentScanState(none);
      expect(s.kind).toBe('WAITING');
      expect(s.virusScanned).toBe(false);
    }
  });

  it('keeps a held or failed file in the danger tone, matching the existing badge', () => {
    expect(presentScanState({ kind: 'HELD' })).toMatchObject({
      label: 'Held for Safety',
      tone: 'danger',
    });
    expect(presentScanState({ kind: 'FAILED' }).tone).toBe('danger');
  });
});

describe('the upload wording follows the platform switch', () => {
  it('claims a scan only when virus scanning is on, and otherwise says it is not one', () => {
    expect(uploadCheckNotice(true)).toContain('scanned for viruses');
    expect(uploadCheckNotice(false)).toContain('This is not a virus scan.');
    expect(uploadCheckNotice(false)).not.toMatch(/scanned for viruses|are scanned/);
    expect(addCheckStep(true).title).toBe('Checked for Viruses');
    expect(addCheckStep(false).title).toBe('Format Checked');
    expect(addCheckStep(false).line).toContain('Virus scanning is not switched on yet');
    expect(addCheckStep(false).line).toContain('not a virus scan');
  });
});
