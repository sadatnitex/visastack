import type { DocumentGroupDef, LayerDef, ProposedPackDef, PurposeFamilyDef } from './types';

export const CATALOGUE_LAYERS: readonly LayerDef[] = [
  {
    key: 'identity',
    label: 'Identity and Civil Status',
    description: 'Names, birth, civil records, national identifiers and personal details.',
  },
  {
    key: 'travel_documents',
    label: 'Travel Documents',
    description: 'Passports, identity cards, permits and visas held.',
  },
  {
    key: 'timelines',
    label: 'Timelines',
    description: 'Where you lived, worked, studied and travelled, with dates.',
  },
  {
    key: 'money',
    label: 'Money',
    description: 'Income, assets, tax, funding and sponsors.',
  },
  {
    key: 'people',
    label: 'People',
    description: 'Family, hosts, inviters, referees and guardians.',
  },
  {
    key: 'declarations',
    label: 'Declarations and History',
    description: 'Refusals, bans, legal and security history. Wording needs adviser review.',
  },
  {
    key: 'health',
    label: 'Health',
    description: 'Vaccinations, examinations, insurance and declared conditions.',
  },
  {
    key: 'qualifications',
    label: 'Qualifications',
    description: 'Education, language tests, skills, memberships and achievements.',
  },
  {
    key: 'purpose_packs',
    label: 'Purpose Packs',
    description: 'Details that only some purposes need: study, work, business, family, official.',
  },
  {
    key: 'country_packs',
    label: 'Country Packs',
    description: 'Identifiers and records that belong to one country or region.',
  },
];

export const CATALOGUE_PURPOSE_FAMILIES: readonly PurposeFamilyDef[] = [
  { key: 'visit', label: 'Visit', description: 'Short stays for a reason that ends.' },
  { key: 'study', label: 'Study', description: 'Learning at any age or level.' },
  { key: 'work', label: 'Work', description: 'Earning abroad, by any route.' },
  { key: 'settle', label: 'Settle', description: 'Building a life in a new country.' },
  {
    key: 'protection',
    label: 'Protection and Special',
    description: 'Cases that need a human adviser.',
  },
  { key: 'after_decision', label: 'After a Decision', description: 'What happens next.' },
  {
    key: 'supporting',
    label: 'Supporting Applications',
    description: 'The paperwork around travelling.',
  },
  {
    key: 'beyond',
    label: 'Beyond Immigration',
    description: 'The same profile used for everyday cross-border life.',
  },
];

export const CATALOGUE_DOCUMENT_GROUPS: readonly DocumentGroupDef[] = [
  {
    key: 'identity_civil',
    label: 'Identity and Civil',
    description: 'Passports, identity cards and civil registration records.',
  },
  {
    key: 'travel_immigration',
    label: 'Travel and Immigration',
    description: 'Visas, permits, stamps, bookings and travel insurance.',
  },
  {
    key: 'financial',
    label: 'Financial',
    description: 'Bank, tax, income, savings, property and sponsorship records.',
  },
  {
    key: 'employment_business',
    label: 'Employment and Business',
    description: 'Employer letters, contracts, company and trade records.',
  },
  {
    key: 'education_qualifications',
    label: 'Education and Qualifications',
    description: 'Certificates, transcripts, language tests and professional licences.',
  },
  {
    key: 'medical',
    label: 'Medical',
    description: 'Health reports, vaccination and insurance records.',
  },
  {
    key: 'legal_clearances',
    label: 'Legal and Clearances',
    description: 'Police and good conduct certificates, court orders, government orders.',
  },
  {
    key: 'family_relationship',
    label: 'Family and Relationship',
    description: 'Evidence of family ties, custody and consent.',
  },
  {
    key: 'accommodation_host',
    label: 'Accommodation and Host',
    description: 'Invitations, host records and proof of where you will stay.',
  },
  {
    key: 'application_receipts',
    label: 'Application Forms and Receipts',
    description: 'Forms, confirmations, receipts, tracking slips and decisions.',
  },
  {
    key: 'photos_biometrics',
    label: 'Photos and Biometrics',
    description: 'Photographs, biometric receipts and appointment slips.',
  },
  {
    key: 'letters_statements',
    label: 'Letters and Statements',
    description: 'Cover letters, explanations, references and statements of purpose.',
  },
  {
    key: 'translations_legalisations',
    label: 'Translations and Legalisations',
    description: 'Certified translations, attestations and apostilles.',
  },
  {
    key: 'other_documents',
    label: 'Other Documents',
    description: 'Anything that fits nowhere else, so nothing is ever forced into a wrong type.',
  },
];

export const PROPOSED_PACKS: readonly ProposedPackDef[] = [
  {
    key: 'declarations',
    label: 'Declarations and History',
    description: 'Refusals, bans, legal, security and clearance history.',
    rationale:
      'Legal and security history must never ride along with a general profile grant. Its own category means nobody receives it unless the person grants it by name.',
  },
  {
    key: 'study',
    label: 'Study',
    description: 'Offers, enrolment records and funding for study.',
    rationale: 'A university or education agent needs this without seeing work or money detail.',
  },
  {
    key: 'settle',
    label: 'Family and Settle',
    description: 'Relationship evidence, sponsor status and days in and out.',
    rationale:
      'Relationship and residence evidence is personal and used only for family and settlement routes.',
  },
  {
    key: 'labour_migration',
    label: 'Labour Migration',
    description: 'Recruiting agency, emigration clearance and contract records.',
    rationale:
      'Contract-work records are shared with a recruiting agency and the government, not with every visa adviser.',
  },
  {
    key: 'official_travel',
    label: 'Official and Religious Travel',
    description: 'Government order details, delegation and operator or group details.',
    rationale: 'Official and pilgrimage details apply to few people and go to specific recipients.',
  },
  {
    key: 'bangladesh',
    label: 'Bangladesh Records',
    description: 'National ID, birth registration, tax number and local address details.',
    rationale:
      'Owner decision 2026-10-14: a Bangladesh pack with the strongest protection on identifiers.',
  },
  {
    key: 'country_ids',
    label: 'Country Identifiers',
    description:
      'Numbers issued by another country, such as tax, social security or permit numbers.',
    rationale:
      'Foreign identifiers are high value to fraudsters and are needed only for that country.',
  },
];
