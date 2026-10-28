/**
 * Provider-agnostic port contracts for the commercial activation framework
 * (master directive §7 "PR 11"). Alongside `StoragePort` (storage.ts),
 * `AiExtractionPort` (ai.ts), `MalwareScannerPort` and `DocumentConverterPort`
 * (intake.ts / extraction.ts — already used as injected dependencies
 * throughout the intake pipeline), these five complete the directive's
 * named set of nine ports.
 *
 * Every port here is a genuine, minimal contract with a real pilot
 * implementation (see packages/adapters and apps/web/src/lib), but — unlike
 * Storage/AI/Scanner/Converter, which are already threaded through as
 * injected parameters at every relevant call site — these are not all fully
 * wired end-to-end yet. Where that's true it's stated explicitly on the
 * interface, not left implicit: commercial activation is a config change
 * ("provider registries... configuration, not business-logic edits"), and a
 * documented, honest contract is what makes that eventually true, even
 * before every call site has been migrated to use it.
 */

/** A single authenticated identity, resolved by whichever identity provider is configured. */
export interface ResolvedIdentity {
  /** Display metadata only, never used for authorization or account binding. */
  readonly displayName?: string;
  /** The provider's own immutable subject id (e.g. a WorkOS user id) — never a mutable email. */
  readonly providerId: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * Resolves the caller's identity from the current request context. Pilot
 * implementation: `apps/web/src/lib/identity-provider.ts`'s
 * `WorkosIdentityPort`, wrapping WorkOS AuthKit's `withAuth()`.
 *
 * Not yet wired: `apps/web/src/lib/session.ts`'s `withSession` still calls
 * `withAuth()` directly rather than through this port (it also owns DB
 * pooling and account provisioning in the same function, which this PR does
 * not restructure). The port is correct and independently usable; full
 * call-site migration is future work.
 */
export interface IdentityPort {
  currentIdentity(): Promise<ResolvedIdentity | undefined>;
}

export interface SendEmailInput {
  readonly to: string;
  readonly subject: string;
  /** The plain-text version; always sent, and the whole email where HTML is not shown. */
  readonly body: string;
  /** The designed version of the same words (see email-design.ts), when there is one. */
  readonly html?: string;
  /** Opaque stable outbox key, reused across retries; never an email address. */
  readonly idempotencyKey?: string;
}

export interface SendEmailResult {
  /** The provider's own id for this send, if it returns one - lets a later webhook (delivered/bounced) correlate back to this exact send without re-sending it. */
  readonly providerMessageId?: string;
}

/**
 * Sends transactional email. NTF-03 (Part 5 §5): implemented by
 * `packages/adapters/src/email.ts`'s `ResendEmailPort` (a real provider) and
 * `NullEmailPort` (pilot/test only - logs and never actually sends, refuses
 * to construct at all in commercial mode).
 */
export interface EmailPort {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export interface ObservabilityEvent {
  readonly name: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Records an operational event for the "internal alert dashboard" the
 * directive names as the pilot's observability provider. Pilot
 * implementation (`packages/adapters/src/observability.ts`'s
 * `ConsoleObservabilityPort`) writes a structured JSON line to stdout —
 * genuinely sufficient for a pilot, since Vercel's own log viewer and
 * alerting already aggregate and surface stdout from every deployment; it
 * is the actual "internal alert dashboard" available today, not a
 * placeholder for one still to be built.
 */
export interface ObservabilityPort {
  record(event: ObservabilityEvent): void;
}

/** What a hosted gateway reports about one payment, in VisaStack's own terms. */
export type PaymentValidationStatus =
  | 'VALID'
  | 'VALIDATED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNATTEMPTED'
  | 'EXPIRED'
  | 'PENDING'
  | 'INVALID';

/**
 * The gateway's answer to "is this payment real?", normalized by the adapter. Nothing in it comes
 * from a browser or an unauthenticated callback: only from the gateway's server-to-server
 * validation or query. A field the gateway did not report is null, and the service treats a null
 * where a value is required as a failed check, never as a pass.
 */
export interface PaymentValidation {
  readonly status: PaymentValidationStatus;
  /** The VisaStack transaction id the gateway ties this payment to. */
  readonly merchantTranId: string | null;
  /** The gateway's validation id (its identifier for the payment). */
  readonly valId: string | null;
  /** Exact whole minor units, parsed from the gateway's decimal text without floating point. */
  readonly amountMinorUnits: number | null;
  /** Upper-case ISO currency code of the payment. */
  readonly currency: string | null;
  readonly bankTranId: string | null;
  /** The gateway's risk flag: 0 is normal, 1 is risky. */
  readonly riskLevel: number | null;
  /** The merchant (store) the payment was made to, when the gateway reports it. */
  readonly storeId: string | null;
}

export interface CreateCheckoutInput {
  /** Generated by VisaStack, unique, never reused. */
  readonly merchantTranId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  /** A short, non-secret label shown to the payer (the invoice reference). */
  readonly invoiceRef: string;
  readonly customer: { readonly name: string; readonly email: string };
  /** Absolute addresses the gateway sends the payer and its server to. */
  readonly urls: {
    readonly success: string;
    readonly fail: string;
    readonly cancel: string;
    readonly ipn: string;
  };
}

export interface CheckoutSession {
  /** The gateway page to send the payer to. */
  readonly redirectUrl: string;
  readonly sessionKey: string;
}

/**
 * The gateway could not be reached, answered too slowly, or answered something unreadable. No
 * decision may be made from the call: the caller leaves the payment pending and retries later.
 * Messages are fixed text and never carry the gateway's reply, an address or a credential.
 */
export class PaymentProviderUnavailableError extends Error {
  constructor(message = 'the payment provider is unavailable') {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}

/**
 * Payment provider contract (ADR 0020). `NullPaymentPort` (packages/adapters/src/payment.ts) is
 * the default and reports `configured: false`, so nothing can start a payment until the owner
 * configures a real provider. `SslcommerzPaymentPort` is the first real adapter; a second
 * provider is another implementation of this interface, not a redesign.
 *
 * `validatePayment` and `queryByMerchantTranId` are the only sources of truth about money: they
 * are server-to-server calls made with VisaStack's own credentials. `verifyIpnSignature` is a
 * cheap first filter on a callback and never enough to count money on its own. Methods throw
 * `PaymentProviderUnavailableError` when the gateway cannot be asked.
 */
export interface PaymentPort {
  readonly configured: boolean;
  /** A short stable name stored with each payment, for example `sslcommerz`. */
  readonly provider: string;
  /** The merchant (store) this deployment is configured for. */
  readonly storeId: string | null;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  validatePayment(input: { readonly valId: string }): Promise<PaymentValidation>;
  queryByMerchantTranId(merchantTranId: string): Promise<PaymentValidation>;
  verifyIpnSignature(form: Readonly<Record<string, string>>): boolean;
}

export interface EnqueueJobInput {
  readonly documentVersionId: string;
}

/**
 * The durable async job queue contract. Pilot implementation: the existing
 * PR 6 Neon/Postgres-native job system (`enqueueIntakeJob`,
 * `runIntakeWorker`, `retryFailedJob`, `listFailedJobs` — jobs.ts), which
 * predates this port and satisfies its shape by construction rather than
 * by formally declaring `implements JobQueuePort`.
 *
 * Not restructured to accept an injected `JobQueuePort` at each call site:
 * jobs.ts's functions are Postgres-native by design (they operate on
 * `schema.processingJobs` directly, using row-level `FOR UPDATE SKIP
 * LOCKED` leasing — see jobs.ts's own documentation), and the directive's
 * own pilot provider for this port is "Neon job queue," i.e. the current
 * implementation already is the intended pilot. This interface exists to
 * name the contract for the commercial activation framework's registry;
 * genuinely swapping job-queue providers would be a real, separate PR.
 */
export interface JobQueuePort {
  enqueue(input: EnqueueJobInput): Promise<{ readonly jobId: string }>;
}

export interface GeneratedDataKey {
  readonly keyVersion: string;
  readonly plaintextDataKey: Uint8Array;
  readonly wrappedDataKey: Uint8Array;
  /**
   * Which key wrapped it (for example `aws-kms:<key id>`), stored beside the wrapped key so a
   * later read, and the move from the local key to a real key service, always know who can
   * unwrap it. Absent for the local development provider (stored as null).
   */
  readonly wrappingKeyId?: string;
}

/**
 * Envelope-key management for protected-field encryption (Commercial V1
 * SEC-03). A KMS wraps/unwraps DATA keys; it never sees field plaintext
 * directly, and no caller of this port may persist a data key's plaintext
 * form anywhere — only `wrappedDataKey` (the KMS's own ciphertext for it) is
 * ever stored, in `data_keys.wrapped_data_key`. This is what makes "a
 * database dump/backup does not carry enough to decrypt protected data"
 * (SEC-03's explicit requirement) true: the wrapped key is worthless without
 * this port's KMS to unwrap it.
 *
 * Pilot/dev/test implementation: `packages/adapters/src/key-management.ts`'s
 * `LocalEnvelopeKeyProvider`, explicitly gated never to run in commercial
 * mode (see its own doc comment) — it wraps with a locally-held master key
 * rather than a real external KMS, so it cannot honestly provide this port's
 * central guarantee. A real KMS adapter (AWS KMS / GCP KMS / etc) is a
 * genuine future PR requiring a live account this session does not have;
 * live verification of that guarantee is BLOCKED until then, recorded in
 * docs/commercial-v1/known-issues.md rather than assumed.
 */
export interface KeyManagementPort {
  /** The key version new writes should encrypt under right now. */
  currentKeyVersion(): string;
  /**
   * Mint a fresh 256-bit data key for `currentKeyVersion()`, wrapped for
   * storage. The caller must never persist `plaintextDataKey`.
   */
  generateDataKey(): Promise<GeneratedDataKey>;
  /**
   * Unwrap a previously-wrapped data key back to plaintext, given the
   * version that wrapped it. Throws if that version is unknown to this
   * provider (e.g. a real KMS provider asked to unwrap a key a different
   * provider wrapped).
   */
  unwrapDataKey(
    keyVersion: string,
    wrappedDataKey: Uint8Array,
    /** The wrapping key recorded when it was stored; null or absent means the local key. */
    wrappingKeyId?: string | null,
  ): Promise<Uint8Array>;
}

/**
 * A provider that can also wrap an existing data key under its own key, so every stored data
 * key can be moved from the local key to a real key service without changing a single
 * encrypted value (the data key itself stays the same; only its wrapping changes).
 */
export interface RewrappingKeyManagementPort extends KeyManagementPort {
  /** Every wrapping key id this provider records starts with this; anything else is not yet moved. */
  wrappingKeyPrefix(): string;
  rewrapDataKey(
    keyVersion: string,
    plaintextDataKey: Uint8Array,
  ): Promise<{ readonly wrappedDataKey: Uint8Array; readonly wrappingKeyId: string }>;
}

export function isRewrappingKeyManagementPort(
  port: KeyManagementPort,
): port is RewrappingKeyManagementPort {
  return (
    typeof (port as Partial<RewrappingKeyManagementPort>).rewrapDataKey === 'function' &&
    typeof (port as Partial<RewrappingKeyManagementPort>).wrappingKeyPrefix === 'function'
  );
}
