import { afterEach, describe, expect, it } from 'vitest';
import { documentRemovalRequestsOn, documentSelfDeleteOn } from './env';

const NAME = 'DOCUMENT_REMOVAL_REQUESTS';

describe('DOCUMENT_REMOVAL_REQUESTS switch', () => {
  const before = process.env[NAME];
  afterEach(() => {
    if (before === undefined) delete process.env[NAME];
    else process.env[NAME] = before;
  });

  it('is off when not set', () => {
    delete process.env[NAME];
    expect(documentRemovalRequestsOn()).toBe(false);
  });

  it('is off for off, empty and anything unclear', () => {
    for (const value of ['off', 'false', '0', 'no', '', 'maybe', 'onn']) {
      process.env[NAME] = value;
      expect(documentRemovalRequestsOn(), value).toBe(false);
    }
  });

  it('is on only when the owner says on', () => {
    for (const value of ['on', 'ON', ' true ', '1', 'yes']) {
      process.env[NAME] = value;
      expect(documentRemovalRequestsOn(), value).toBe(true);
    }
  });
});

describe('DOCUMENT_SELF_DELETE switch', () => {
  const name = 'DOCUMENT_SELF_DELETE';
  const before = process.env[name];
  afterEach(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });

  it('is off when not set, empty or unclear', () => {
    delete process.env[name];
    expect(documentSelfDeleteOn()).toBe(false);
    for (const value of ['off', 'false', '0', 'no', '', 'maybe', 'onn']) {
      process.env[name] = value;
      expect(documentSelfDeleteOn(), value).toBe(false);
    }
  });

  it('is on only when the owner says on', () => {
    for (const value of ['on', 'ON', ' true ', '1', 'yes']) {
      process.env[name] = value;
      expect(documentSelfDeleteOn(), value).toBe(true);
    }
  });
});
