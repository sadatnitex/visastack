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
  readonly body: string;
}

/**
 * Sends transactional email. No pilot provider is configured — the
 * directive's own pilot-provider list names one for every other port except
 * this one, matching Payment's explicit "no payment provider." Pilot
 * implementation (`packages/adapters/src/email.ts`'s `NullEmailPort`) never
 * actually sends; it only logs, so the absence of a real provider fails
 * loud in development rather than silently pretending to work.
 */
export interface EmailPort {
  send(input: SendEmailInput): Promise<void>;
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

export interface CheckoutSession {
  readonly url: string;
  readonly sessionId: string;
}

/**
 * Payment provider contract. The directive's pilot-provider list is
 * explicit: "no payment provider." Pilot implementation
 * (`packages/adapters/src/payment.ts`'s `NullPaymentPort`) always reports
 * unconfigured — matching `getPlatformCapabilities()`'s pre-existing
 * `payments: 'unconfigured'` entry (apps/web/src/lib/capabilities.ts),
 * which already anticipated exactly this shape.
 */
export interface PaymentPort {
  readonly configured: false;
  createCheckoutSession(): Promise<never>;
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
