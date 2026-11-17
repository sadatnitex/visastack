import {
  DOCUMENT_ICONS,
  type DocumentIcon,
  GENERIC_DOCUMENT_ICON,
  type ItemMark,
  documentCatalogueKey,
  documentMark,
} from './item-icons';

/**
 * Which illustration a document type gets (picture-first upgrade, ADR 0027).
 *
 * This sits on top of `item-icons.ts` and never decides a kind on its own: a type's kind is the
 * kind of its icon there, so the icon and the picture of one paper always agree. What it adds is
 * one rule: a type whose icon is the plain document (forms, contracts, orders, slips) shows no
 * illustration and keeps today's icon, unless the screen asks for the generic paper picture.
 *
 * Pictures draw a document TYPE only. They never show anything from a person's file.
 */

/** The illustrations the picture layer can draw: one per document kind, plus the generic paper. */
export type DocumentPictureName = DocumentIcon;

/** What a screen shows for a type when it asks for its picture. */
export type DocumentPictureChoice =
  | {
      /** An illustration of this kind of paper. */
      readonly kind: 'picture';
      readonly picture: DocumentPictureName;
      /** The same kind's icon and tone, for a tone ground and for a fallback. */
      readonly mark: ItemMark;
      /** The catalogue key the type stands for. */
      readonly key: string;
    }
  | {
      /** No illustration: show today's icon (`Icon` with `mark.icon`). */
      readonly kind: 'icon';
      readonly mark: ItemMark;
      readonly key: string;
    };

/**
 * Catalogue types that have no picture of their own and keep today's plain document icon. These
 * are papers with no one recognisable shape (forms, contracts, court orders, appointment slips,
 * reports), so a drawing would say no more than the word does. The list is pinned on purpose:
 * `document-picture.test.ts` fails when a new catalogue type falls back without being listed
 * here, so a type is never hidden behind the plain icon by accident. It must equal the types for
 * which `hasOwnDocumentIcon` is false.
 */
export const ICON_ONLY_DOCUMENT_TYPES: readonly string[] = [
  // Business and work papers with no one shape.
  'AUDIT_REPORT',
  'SHARE_REGISTER',
  'BUSINESS_CARD',
  'EMPLOYMENT_CONTRACT',
  'FREELANCE_CONTRACT',
  'LABOUR_CONTRACT',
  'SERVICE_BOND_AGREEMENT',
  'CURRICULUM_VITAE',
  'ASSET_VALUATION_REPORT',
  // Study forms and research.
  'FORM_I20',
  'FORM_DS2019',
  'CAS_STATEMENT',
  'THESIS',
  'RESEARCH_PUBLICATION',
  'RESEARCH_PROPOSAL',
  // Health papers that are slips, not certificates.
  'HOSPITAL_APPOINTMENT',
  'PRESCRIPTION',
  // Legal and family records.
  'COURT_ORDER',
  'LEGAL_DOCUMENT',
  'POWER_OF_ATTORNEY',
  'FAMILY_REGISTER',
  'CUSTODY_ORDER',
  'RELATIONSHIP_PROOF',
  'DEPENDENT_PROOF',
  'COMMUNICATION_RECORD',
  'HOME_STUDY_REPORT',
  'ANCESTOR_RECORD',
  'HOST_IMMIGRATION_STATUS_PROOF',
  'OTHER_LEGAL_DOCUMENT',
  'OTHER_FAMILY_DOCUMENT',
  'OTHER_LEGALISATION_DOCUMENT',
  // Address papers.
  'ADDRESS_PROOF',
  'UTILITY_BILL',
  'RENTAL_AGREEMENT',
  // Application forms, receipts and appointments.
  'VISA_APPLICATION_FORM',
  'DS160_CONFIRMATION',
  'FORM_14A',
  'SCHENGEN_APPLICATION',
  'UK_VISA_APPLICATION',
  'CANADA_IMM_FORM',
  'AUSTRALIA_FORM_80',
  'APPLICATION_RECEIPT',
  'COURIER_TRACKING_SLIP',
  'SIGNATURE_SPECIMEN',
  'BIOMETRIC_RECEIPT',
  'VFS_APPOINTMENT',
  'EMBASSY_APPOINTMENT',
  'OTHER_APPLICATION_DOCUMENT',
  // Anything else.
  'OTHER',
];

/** Every illustration name: exactly the document kinds `item-icons.ts` knows. */
export const DOCUMENT_PICTURE_NAMES: readonly DocumentPictureName[] = DOCUMENT_ICONS;

/**
 * The picture for a stored type, a catalogue key or a typed name ("Bank Statement"). A type with
 * its own kind gets that kind's picture. Any other type, an unknown word or nothing at all keeps
 * today's icon, or the generic paper picture when `generic` is 'picture'.
 */
export function documentPicture(
  typeOrName: string | null | undefined,
  { generic = 'icon' }: { readonly generic?: 'icon' | 'picture' } = {},
): DocumentPictureChoice {
  const key = documentCatalogueKey(typeOrName);
  const mark = documentMark(typeOrName);
  // `documentMark` only ever chooses a document kind, so the icon name is a picture name.
  const picture = mark.icon as DocumentPictureName;
  if (picture !== GENERIC_DOCUMENT_ICON || generic === 'picture') {
    return { kind: 'picture', picture, mark, key };
  }
  return { kind: 'icon', mark, key };
}
