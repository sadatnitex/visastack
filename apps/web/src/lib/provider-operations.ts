import 'server-only';
import { currencyListWords } from '@visastack/services';
import { aiConnectorEnabled } from './ai-connector';
import { formatFileSize } from './format-size';
import {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_KEYS,
  type PaymentProviderEntry,
  chosenPaymentProviders,
  configuredPaymentProviders,
} from './payment-providers';

/** A plain word for where a service stands. "Set Up" never means "proven to work". */
export type ProviderStatus = 'Set Up' | 'Not Set Up' | 'Recorded' | 'Not Proven' | 'Not Measured';

export interface ProviderOperationsRow {
  readonly label: string;
  /** Where the service stands, in one plain word. */
  readonly standing: ProviderStatus;
  /** One plain sentence for the founder. The exact reading, source and caveat stay in the detail. */
  readonly headline: string;
  readonly reading: string;
  readonly source: 'Application records' | 'Configuration' | 'Not measured';
  readonly detail: string;
}

/**
 * The label of one payment provider's row (S19 step 0, worded in round 2): "Online Payments", like
 * "Document Storage". With several providers each row adds the currencies it takes, in plain
 * words; the provider's own name is in the detail.
 */
export function onlinePaymentsLabel(
  entry: Pick<PaymentProviderEntry, 'currencies'>,
  providerCount: number = PAYMENT_PROVIDER_KEYS.length,
): string {
  if (providerCount <= 1) return ONLINE_PAYMENTS;
  return `${ONLINE_PAYMENTS} in ${titleWords(currencyListWords(entry.currencies, 'and'))}`;
}

const ONLINE_PAYMENTS = 'Online Payments';

/** "Bangladeshi taka and US dollars" as a label: "Bangladeshi Taka and US Dollars". */
function titleWords(phrase: string): string {
  return phrase
    .split(' ')
    .map((word) => (word === 'and' ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ');
}

type RawRow = Omit<ProviderOperationsRow, 'standing' | 'headline'>;

/** Readings of a payment provider's row. */
const PAYMENT_READINGS = {
  LIVE: 'Live payments',
  TEST: 'Test payments only',
  INCOMPLETE: 'Chosen; settings incomplete',
  OFF: 'Not configured',
} as const;

/** Counts describe application records, never a provider's invoice or remaining quota. */
export function describeProviderOperations(
  input: {
    readonly evidenceBytes?: number;
    readonly aiCostUnits?: number;
  },
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProviderOperationsRow[] {
  const rows = rawRows(input, env);
  return rows.map((row) => ('standing' in row ? row : { ...row, ...plain(row, input) }));
}

/**
 * One row per payment provider in the registry, from the one configured answer
 * (`configuredPaymentProviders`): its mode, the currencies it takes, and whether it can refund.
 */
function paymentRows(env: Readonly<Record<string, string | undefined>>): ProviderOperationsRow[] {
  const configured = configuredPaymentProviders(env);
  const chosen = chosenPaymentProviders(env);
  const keys = Object.keys(PAYMENT_PROVIDERS) as (keyof typeof PAYMENT_PROVIDERS)[];
  return keys.map((key) => {
    const entry: PaymentProviderEntry = PAYMENT_PROVIDERS[key];
    const on = configured.find((provider) => provider.key === key);
    const reading = on
      ? PAYMENT_READINGS[on.mode]
      : chosen.includes(key)
        ? PAYMENT_READINGS.INCOMPLETE
        : PAYMENT_READINGS.OFF;
    return {
      label: onlinePaymentsLabel(entry, keys.length),
      reading,
      source: 'Configuration' as const,
      detail: `Through ${entry.name}, for invoices in ${currencyListWords(entry.currencies, 'and')}. ${
        entry.supportsRefunds
          ? 'Refunds can be sent through it once sending refunds from VisaStack is switched on.'
          : 'Refunds are made in its own panel and recorded here.'
      } Test payments mark invoices paid but are not money: they are labelled Test Payment and left out of the Monthly Accounting File. Only the platform owner can make one. Live payments need the live store settings.`,
      ...paymentPlain(reading, keys.length > 1 ? currencyListWords(entry.currencies, 'and') : null),
    };
  });
}

function rawRows(
  input: {
    readonly evidenceBytes?: number;
    readonly aiCostUnits?: number;
  },
  env: Readonly<Record<string, string | undefined>>,
): (RawRow | ProviderOperationsRow)[] {
  const read = (name: string) => env[name];
  const configured = (names: readonly string[]) =>
    names.every((name) => Boolean(env[name]?.trim()));
  const email =
    read('EMAIL_PROVIDER') === 'resend' && configured(['RESEND_API_KEY', 'RESEND_FROM_ADDRESS']);
  const measured = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0;
  return [
    {
      label: 'Application Email',
      reading: email ? 'Configuration present' : 'Not configured',
      source: 'Configuration',
      detail:
        'Case and workspace notices use this sender. Sign-in and password messages use separate authentication settings. Configuration does not confirm delivery.',
    },
    {
      label: 'Email Delivery Receipts',
      reading:
        email && configured(['RESEND_WEBHOOK_SECRET'])
          ? 'Verification secret present'
          : 'Not configured',
      source: 'Configuration',
      detail:
        'Provider acceptance is different from delivery. Receipt endpoint registration and signed events must also be verified.',
    },
    ...paymentRows(env),
    {
      label: 'AI App Access',
      reading: aiConnectorEnabled((name) => env[name]) ? 'On' : 'Off',
      source: 'Configuration',
      detail:
        'Whether people can connect an AI app to VisaStack. Each connection still needs the person to approve it, and they can remove it at any time.',
    },
    {
      label: 'Document Storage',
      reading:
        read('STORAGE_PROVIDER') === 'r2' &&
        configured(['R2_ENDPOINT_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])
          ? 'Configuration present'
          : 'Check storage configuration',
      source: 'Configuration',
      detail:
        'The configured client still needs a successful private object operation. A credential being present does not prove permission or bucket access.',
    },
    {
      label: 'Tracked Evidence Storage',
      reading: measured(input.evidenceBytes) ? `${input.evidenceBytes} bytes` : 'Unavailable',
      source: measured(input.evidenceBytes) ? 'Application records' : 'Not measured',
      detail:
        'This count excludes database archives, document backups and provider overhead. It is not total billed storage or free-plan headroom.',
    },
    {
      label: 'AI Environment Key',
      reading:
        (!read('AI_PROVIDER') || read('AI_PROVIDER') === 'openai') && configured(['OPENAI_API_KEY'])
          ? 'Environment key present'
          : 'No supported environment key',
      source: 'Configuration',
      detail:
        'This reading covers environment configuration only. Existing administration settings can select a database-managed provider, and the enable switch, consent, budget and human review still govern processing. Manual case preparation stays available.',
    },
    {
      label: 'Tracked AI Usage',
      reading: measured(input.aiCostUnits) ? `${input.aiCostUnits} cost units` : 'Unavailable',
      source: measured(input.aiCostUnits) ? 'Application records' : 'Not measured',
      detail:
        'Application cost units do not independently verify an invoice, token allowance or current provider price.',
    },
    {
      label: 'Encryption Key Recovery',
      reading:
        configured(['KMS_LOCAL_MASTER_KEY_BASE64']) ||
        (read('KMS_PROVIDER') === 'aws_kms' && configured(['KMS_KEY_ID', 'KMS_AWS_REGION']))
          ? 'Key present; recovery unverified'
          : 'Key not configured',
      source: 'Configuration',
      detail:
        'A live key does not prove independent recovery, escrow or rotation. Retain a separate tested recovery procedure before sensitive-data activation.',
    },
    {
      label: 'Backup Recovery',
      reading: 'Recovery evidence required',
      source: 'Not measured',
      detail:
        'A database-only restore does not recover documents, encryption keys, access revocations or deletion history. Do not infer full recovery from backup credentials.',
    },
    {
      label: 'Provider Bills and Free-Plan Headroom',
      reading: 'Not measured here',
      source: 'Not measured',
      detail:
        'Check current email, hosting, database, storage and AI account usage before upgrading. Missing measurements are not zero cost or unlimited capacity.',
    },
  ];
}

/**
 * A payment row's standing and headline. With one provider, exactly the S29 sentences; with
 * several, each says which invoices it is about.
 */
function paymentPlain(
  reading: string,
  currencies: string | null,
): { readonly standing: ProviderStatus; readonly headline: string } {
  const invoices = currencies === null ? 'invoices' : `invoices in ${currencies}`;
  const payment = currencies === null ? 'Online payment' : `Online payment for ${invoices}`;
  switch (reading) {
    case PAYMENT_READINGS.LIVE:
      return {
        standing: 'Set Up',
        headline: `Agencies can pay ${invoices} online with real money.`,
      };
    case PAYMENT_READINGS.TEST:
      return {
        standing: 'Set Up',
        headline: `${payment} is in test mode. Only you can make a test payment; agencies cannot pay ${currencies === null ? 'online' : 'those online'} yet.`,
      };
    case PAYMENT_READINGS.INCOMPLETE:
      return {
        standing: 'Not Set Up',
        headline: `${payment} is chosen, but some of its settings are missing, so it is off.`,
      };
    default:
      return { standing: 'Not Set Up', headline: `${payment} is not set up.` };
  }
}

function plain(
  row: Omit<ProviderOperationsRow, 'standing' | 'headline'>,
  input: { readonly evidenceBytes?: number; readonly aiCostUnits?: number },
): { readonly standing: ProviderStatus; readonly headline: string } {
  const unmeasured = {
    standing: 'Not Measured' as const,
    headline: 'This is not counted here. Check the provider account itself.',
  };
  switch (row.label) {
    case 'Application Email':
      return row.reading === 'Configuration present'
        ? {
            standing: 'Set Up',
            headline: 'A sender is set up. That does not prove emails arrive.',
          }
        : { standing: 'Not Set Up', headline: 'No application email sender is set up yet.' };
    case 'Email Delivery Receipts':
      return row.reading === 'Verification secret present'
        ? {
            standing: 'Set Up',
            headline:
              'Receipt checking is switched on. Delivery is unproven until a real receipt arrives.',
          }
        : { standing: 'Not Set Up', headline: 'Delivery receipts are not being checked yet.' };
    case 'AI App Access':
      return row.reading === 'On'
        ? {
            standing: 'Set Up',
            headline: 'AI App Access: On. People can connect an AI app to their workspace.',
          }
        : {
            standing: 'Not Set Up',
            headline: 'AI App Access: Off. No AI app can connect.',
          };
    case 'Document Storage':
      return row.reading === 'Configuration present'
        ? {
            standing: 'Set Up',
            headline:
              'Storage settings are present. Not proven until a real file is stored and read back.',
          }
        : {
            standing: 'Not Set Up',
            headline: 'Storage settings are incomplete. Check them before real documents are used.',
          };
    case 'Tracked Evidence Storage':
      return input.evidenceBytes !== undefined && row.source === 'Application records'
        ? {
            standing: 'Recorded',
            headline: `${formatFileSize(input.evidenceBytes)} of files are recorded. This is not your storage bill.`,
          }
        : { standing: 'Not Measured', headline: 'Storage use could not be counted.' };
    case 'AI Environment Key':
      return row.reading === 'Environment key present'
        ? {
            standing: 'Set Up',
            headline:
              'An AI key is set. Settings in the admin area can still choose another provider.',
          }
        : {
            standing: 'Not Set Up',
            headline:
              'No AI key is set in the environment. A provider chosen in settings may still apply.',
          };
    case 'Tracked AI Usage':
      return row.source === 'Application records'
        ? {
            standing: 'Recorded',
            headline: 'Usage is recorded in the app. It is not the provider invoice.',
          }
        : { standing: 'Not Measured', headline: 'AI usage could not be counted.' };
    case 'Encryption Key Recovery':
      return row.reading === 'Key not configured'
        ? { standing: 'Not Set Up', headline: 'No encryption key is set.' }
        : {
            standing: 'Not Proven',
            headline: 'A key is in place. Nobody has proven it can be recovered.',
          };
    case 'Backup Recovery':
      return {
        standing: 'Not Proven',
        headline:
          'Full recovery is not proven. Restoring the database alone does not bring back documents or keys.',
      };
    default:
      return unmeasured;
  }
}
