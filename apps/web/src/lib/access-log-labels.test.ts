import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accessLogEventLabel, labelledAccessLogEventTypes } from './access-log-labels';
import { toTitleCase } from './title-case';

const EM_DASH = String.fromCodePoint(0x2014);

describe('access log event labels (VS-015)', () => {
  it('names the commonly shown document, version and AI reading events in plain words', () => {
    expect(accessLogEventLabel('DOCUMENT_VERSION_ADDED')).toBe('New Version Saved');
    expect(accessLogEventLabel('DOCUMENT_SUPERSEDED')).toBe('Replaced by a Newer Version');
    expect(accessLogEventLabel('AI_READING_JOB')).toBe('Automatic Reading Ran');
    expect(accessLogEventLabel('AI_OCR_RUN')).toBe('AI Read Document Text');
    expect(accessLogEventLabel('AI_EXTRACTION_RUN')).toBe('AI Read Document Details');
    expect(accessLogEventLabel('AI_CONTEXT_SERVED')).toBe('AI App Read Details');
    expect(accessLogEventLabel('GRANT_CREATED')).toBe('Access Granted');
  });

  it('falls back to the generic words for an event it has no entry for', () => {
    expect(accessLogEventLabel('SOMETHING_NEW_HAPPENED')).toBe('Something New Happened');
    expect(accessLogEventLabel('')).toBe('');
    // Names that are inherited object keys are not entries.
    expect(accessLogEventLabel('constructor')).toBe('Constructor');
    expect(accessLogEventLabel('__proto__')).toBe('Proto');
  });

  it('is display only: it returns words and leaves the stored value alone', () => {
    const stored = { eventType: 'DOCUMENT_ACCESS', seq: 7 };
    const snapshot = JSON.stringify(stored);
    const label = accessLogEventLabel(stored.eventType);
    expect(label).toBe('Document Opened');
    expect(JSON.stringify(stored)).toBe(snapshot);
    expect(label).not.toBe(stored.eventType);
    // Asking twice gives the same answer: no hidden state.
    expect(accessLogEventLabel(stored.eventType)).toBe(label);
  });

  it('keeps every label plain, in Title Case, one name for one meaning', () => {
    for (const type of labelledAccessLogEventTypes()) {
      const label = accessLogEventLabel(type);
      expect(label, type).toBe(toTitleCase(label));
      expect(label, type).not.toMatch(/[_]|mission|\bocr\b|\bextraction\b/i);
      expect(label, type).not.toContain(EM_DASH);
      expect(label.length, type).toBeLessThanOrEqual(40);
    }
  });

  it('is the only place the Access Log turns an event type into words', () => {
    const page = readFileSync(
      join(__dirname, '../app/app/applicant/[id]/sharing/page.tsx'),
      'utf8',
    );
    expect(page).toContain('accessLogEventLabel(e.eventType)');
    expect(page).not.toContain('humanizeCode(e.eventType)');
  });
});
