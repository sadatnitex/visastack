import { createTranslator } from '@visastack/i18n';
import { describe, expect, it } from 'vitest';
import { grantStatusBadge } from './grant-status';
import { CHIP_WORDS, GRANT_STATUS, INVITATION_STATUS } from './status-words';

describe('the words on a sharing row', () => {
  it('are the words the grant badge already uses, so the row and the panel never disagree', () => {
    const t = createTranslator('en');
    for (const [status, entry] of Object.entries(GRANT_STATUS)) {
      expect(entry.word, status).toBe(grantStatusBadge(status, t).label);
    }
  });

  it('are in the one chip vocabulary, in Title Case, with a tone', () => {
    for (const entry of [...Object.values(GRANT_STATUS), ...Object.values(INVITATION_STATUS)]) {
      expect(CHIP_WORDS.has(entry.word), entry.word).toBe(true);
      expect(entry.word).toMatch(/^[A-Z][a-z]*(?: [A-Z][a-z]*)*$/);
    }
  });

  it('cover every state a grant and an invitation can be in', () => {
    expect(Object.keys(GRANT_STATUS).sort()).toEqual(
      ['ACTIVE', 'EXPIRED', 'PAUSED', 'PENDING_ACCEPTANCE', 'REVOKED'].sort(),
    );
    expect(Object.keys(INVITATION_STATUS).sort()).toEqual(
      ['ACCEPTED', 'EXPIRED', 'PENDING', 'REVOKED'].sort(),
    );
  });
});
