import type { MessageKey, Translator } from '@visastack/i18n';

const RELATIONSHIP_KEYS: Record<string, MessageKey> = {
  SELF: 'applicant.relationship.self',
  FAMILY_MEMBER: 'applicant.relationship.familyMember',
  MINOR_GUARDIAN: 'applicant.relationship.minorGuardian',
};

/** Translated label for an applicant's relationship to the account holder. */
export function relationshipLabel(relationship: string, t: Translator): string {
  const key = RELATIONSHIP_KEYS[relationship];
  return key ? t(key) : relationship;
}
