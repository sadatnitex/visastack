import { PLATFORM_CAPABILITY_KEYS } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_NAMES,
  STATE_WORDS,
  VERDICT_WORDS,
  capabilityRows,
  verdictOf,
} from './capability-names';

describe('capability names', () => {
  it('decides, for every platform capability, how to name it or that it stays hidden', () => {
    expect(Object.keys(CAPABILITY_NAMES).sort()).toEqual([...PLATFORM_CAPABILITY_KEYS].sort());
  });

  it('hides the one capability that is an internal switch, not a feature', () => {
    const hidden = Object.entries(CAPABILITY_NAMES)
      .filter(([, name]) => name === null)
      .map(([key]) => key);
    expect(hidden).toEqual(['commercialClaims']);
  });

  it('gives every shown capability a distinct, plain name', () => {
    const names = Object.values(CAPABILITY_NAMES).filter((name): name is string => name !== null);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[A-Z]/);
      // A raw key such as "aiExtraction" or "malware_scanning" must never reach a visitor.
      expect(name).not.toMatch(/[a-z][A-Z]|_/);
    }
  });
});

describe('capabilityRows', () => {
  const platform = {
    authentication: 'available',
    aiExtraction: 'unconfigured',
    malwareScanning: 'unconfigured',
    originalDownload: 'disabled',
    sharing: 'degraded',
    commercialClaims: 'disabled',
  };

  it('puts each state in its own words', () => {
    const rows = new Map(capabilityRows(platform).map((row) => [row.key, row]));
    expect(rows.get('authentication')).toMatchObject({ name: 'Signing In', label: 'Working' });
    expect(rows.get('aiExtraction')).toMatchObject({ label: 'Not Set Up Yet', tone: 'neutral' });
    expect(rows.get('originalDownload')).toMatchObject({ label: 'Switched Off for Now' });
    expect(rows.get('sharing')).toMatchObject({ label: 'Working with Limits', tone: 'warning' });
  });

  it('keeps "not set up yet" and "switched off" apart, and never shows the hidden one', () => {
    const labels = new Set(capabilityRows(platform).map((row) => row.label));
    expect(labels).toEqual(
      new Set(['Working', 'Not Set Up Yet', 'Switched Off for Now', 'Working with Limits']),
    );
    expect(capabilityRows(platform).map((row) => row.key)).not.toContain('commercialClaims');
  });

  it('lists capabilities in the order the table names them', () => {
    expect(capabilityRows(platform).map((row) => row.key)).toEqual([
      'authentication',
      'aiExtraction',
      'malwareScanning',
      'originalDownload',
      'sharing',
    ]);
  });

  it('leaves out anything it cannot put in plain words rather than showing a raw code', () => {
    const rows = capabilityRows({
      authentication: 'available',
      aiExtraction: 'on_fire',
      somethingNew: 'available',
      payments: 42,
    });
    expect(rows.map((row) => row.key)).toEqual(['authentication']);
  });

  it('returns nothing for a response without a platform object', () => {
    expect(capabilityRows(undefined)).toEqual([]);
    expect(capabilityRows(null)).toEqual([]);
    expect(capabilityRows('available')).toEqual([]);
  });

  it('has wording for every state the platform can report', () => {
    expect(Object.keys(STATE_WORDS).sort()).toEqual([
      'available',
      'degraded',
      'disabled',
      'unconfigured',
    ]);
  });
});

describe('verdictOf', () => {
  const ok = { ok: true, status: 'live' };
  const readyOk = { ok: true, status: 'ready' };

  it('says checking until both checks have answered', () => {
    expect(verdictOf(null, null)).toBe('checking');
    expect(verdictOf(ok, null)).toBe('checking');
    expect(verdictOf(null, readyOk)).toBe('checking');
  });

  it('says working only when the service is up and says it is ready', () => {
    expect(verdictOf(ok, readyOk)).toBe('working');
  });

  it('says some parts are having problems when the service answers but is not ready', () => {
    expect(verdictOf(ok, { ok: false, status: 'degraded' })).toBe('limited');
    expect(verdictOf(ok, { ok: false, status: 'not_ready' })).toBe('limited');
    expect(verdictOf(ok, { ok: true, status: 'degraded' })).toBe('limited');
    expect(verdictOf({ ok: false }, { ok: false, status: '500' })).toBe('limited');
  });

  it('says it cannot be reached when neither check could connect', () => {
    expect(verdictOf({ ok: false }, { ok: false, status: 'unreachable' })).toBe('unreachable');
  });

  it('words each verdict plainly', () => {
    expect(VERDICT_WORDS.working.label).toBe('Everything is working');
    expect(VERDICT_WORDS.limited.label).toBe('Some parts are having problems');
    expect(VERDICT_WORDS.unreachable.label).toBe('We can’t reach the service right now');
  });
});
