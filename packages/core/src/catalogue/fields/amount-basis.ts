import { type FieldBlock, choice } from './define';

/** The two answers. Blank means not recorded, so nothing is assumed either way. */
export const TAX_BASIS_OPTIONS: readonly string[] = ['Before tax', 'After tax'];

/**
 * Whether a live amount is before or after tax (owner decision, 25 Oct 2026). The three live
 * amounts cannot change (they are frozen), so each gets this optional companion, shown beside it
 * and never counted toward completion. It shares the amount's category, so whoever can see the
 * amount can see its basis, and nobody else. Comparisons use it: two amounts are only compared as
 * the same kind of number when both are known to be before tax, or both after.
 */
const basis = (
  section: string,
  sectionLabel: string,
  layer: FieldBlock['layer'],
  pack: FieldBlock['pack'],
  amountKey: string,
  label: string,
): FieldBlock => ({
  layer,
  pack,
  origin: 'owner_vision',
  sourceRef: `owner decision 2026-10-25: record whether ${amountKey} is before or after tax`,
  section: { key: section, label: sectionLabel },
  role: 'amount_detail',
  rows: [choice(`${amountKey}_tax_basis`, label, TAX_BASIS_OPTIONS)],
});

export const AMOUNT_BASIS_BLOCKS: readonly FieldBlock[] = [
  basis(
    'income_tax_basis',
    'Annual Income Tax Basis',
    'money',
    'universal',
    'annual_income',
    'Annual Income Before or After Tax',
  ),
  basis(
    'salary_tax_basis',
    'Monthly Salary Tax Basis',
    'timelines',
    'professional',
    'monthly_salary',
    'Monthly Salary Before or After Tax',
  ),
  basis(
    'self_employment_tax_basis',
    'Self-Employment Income Tax Basis',
    'timelines',
    'professional',
    'self_employment_income',
    'Self-Employment Income Before or After Tax',
  ),
];
