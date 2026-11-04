import { type DocumentProtectionSettings, isRestrictedDocumentType } from '@visastack/services';
import type { ChoiceGroup } from './master-profile-types';

/** The kinds that need a fresh sign-in check under the live settings, for the kind and name card. */
export function protectedKindsOf(
  groups: readonly ChoiceGroup[],
  protection: DocumentProtectionSettings,
): string[] {
  return groups
    .flatMap((group) => group.choices.map((choice) => choice.key))
    .filter((key) => isRestrictedDocumentType(key, protection));
}
