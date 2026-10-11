import 'server-only';

export interface ProviderOperationsRow {
  readonly label: string;
  readonly reading: string;
  readonly source: 'Application records' | 'Configuration' | 'Not measured';
  readonly detail: string;
}

/** Counts describe application records, never a provider's invoice or remaining quota. */
export function describeProviderOperations(
  input: { readonly evidenceBytes?: number; readonly aiCostUnits?: number },
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProviderOperationsRow[] {
  const read = (name: string) => env[name];
  const configured = (names: readonly string[]) =>
    names.every((name) => Boolean(env[name]?.trim()));
  const email =
    read('EMAIL_PROVIDER') === 'resend' && configured(['RESEND_API_KEY', 'RESEND_FROM_ADDRESS']);
  const measured = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0;
  return [
    {
      label: 'Application email',
      reading: email ? 'Configuration present' : 'Not configured',
      source: 'Configuration',
      detail:
        'Case and workspace notices use this sender. Sign-in and password messages use separate authentication settings. Configuration does not confirm delivery.',
    },
    {
      label: 'Email delivery receipts',
      reading:
        email && configured(['RESEND_WEBHOOK_SECRET'])
          ? 'Verification secret present'
          : 'Not configured',
      source: 'Configuration',
      detail:
        'Provider acceptance is different from delivery. Receipt endpoint registration and signed events must also be verified.',
    },
    {
      label: 'Document storage',
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
      label: 'Tracked evidence storage',
      reading: measured(input.evidenceBytes) ? `${input.evidenceBytes} bytes` : 'Unavailable',
      source: measured(input.evidenceBytes) ? 'Application records' : 'Not measured',
      detail:
        'This count excludes database archives, document backups and provider overhead. It is not total billed storage or free-plan headroom.',
    },
    {
      label: 'AI environment key',
      reading:
        (!read('AI_PROVIDER') || read('AI_PROVIDER') === 'openai') && configured(['OPENAI_API_KEY'])
          ? 'Environment key present'
          : 'No supported environment key',
      source: 'Configuration',
      detail:
        'This reading covers environment configuration only. Existing administration settings can select a database-managed provider, and the enable switch, consent, budget and human review still govern processing. Manual case preparation stays available.',
    },
    {
      label: 'Tracked AI usage',
      reading: measured(input.aiCostUnits) ? `${input.aiCostUnits} cost units` : 'Unavailable',
      source: measured(input.aiCostUnits) ? 'Application records' : 'Not measured',
      detail:
        'Application cost units do not independently verify an invoice, token allowance or current provider price.',
    },
    {
      label: 'Encryption key recovery',
      reading: configured(['KMS_LOCAL_MASTER_KEY_BASE64'])
        ? 'Key present; recovery unverified'
        : 'Key not configured',
      source: 'Configuration',
      detail:
        'A live key does not prove independent recovery, escrow or rotation. Retain a separate tested recovery procedure before sensitive-data activation.',
    },
    {
      label: 'Backup recovery',
      reading: 'Recovery evidence required',
      source: 'Not measured',
      detail:
        'A database-only restore does not recover documents, encryption keys, access revocations or deletion history. Do not infer full recovery from backup credentials.',
    },
    {
      label: 'Provider bills and free-plan headroom',
      reading: 'Not measured here',
      source: 'Not measured',
      detail:
        'Check current email, hosting, database, storage and AI account usage before upgrading. Missing measurements are not zero cost or unlimited capacity.',
    },
  ];
}
