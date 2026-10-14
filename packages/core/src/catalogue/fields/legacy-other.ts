import { type FieldBlock, text } from './define';

/**
 * The text box that opens when a live choice field is set to "Other". The five live choice fields
 * cannot change today (they are frozen), so their companion boxes are added here and the choice
 * itself gains "Other" when the registry is built from the catalogue in a later step.
 */
const live = (
  section: string,
  sectionLabel: string,
  layer: FieldBlock['layer'],
  pack: FieldBlock['pack'],
  key: string,
  label: string,
): FieldBlock => ({
  layer,
  pack,
  origin: 'visastack',
  sourceRef: `owner decision 2026-10-14: every choice keeps an Other option (live field ${key.replace(/_other$/, '')})`,
  section: { key: section, label: sectionLabel },
  role: 'other_detail',
  rows: [text(key, label)],
});

export const LEGACY_OTHER_BLOCKS: readonly FieldBlock[] = [
  live(
    'other_marital_status',
    'Other Marital Status',
    'identity',
    'universal',
    'marital_status_other',
    'Other Marital Status',
  ),
  live(
    'other_income_currency',
    'Other Income Currency',
    'money',
    'universal',
    'annual_income_currency_other',
    'Other Annual Income Currency',
  ),
  live(
    'other_salary_currency',
    'Other Salary Currency',
    'timelines',
    'professional',
    'monthly_salary_currency_other',
    'Other Monthly Salary Currency',
  ),
  live(
    'other_self_employment_currency',
    'Other Self-Employment Currency',
    'timelines',
    'professional',
    'self_employment_income_currency_other',
    'Other Self-Employment Income Currency',
  ),
  live(
    'other_investment_currency',
    'Other Investment Currency',
    'purpose_packs',
    'business',
    'investment_amount_currency_other',
    'Other Investment Amount Currency',
  ),
];
