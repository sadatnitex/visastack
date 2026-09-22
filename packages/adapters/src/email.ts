import type { EmailPort, SendEmailInput, SendEmailResult } from '@visastack/services';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules - matches this repo's other adapters' own helper). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

function assertNotCommercialMode(deploymentMode: string | undefined, adapterName: string): void {
  if (deploymentMode === 'commercial') {
    throw new Error(
      `${adapterName} must never be used in commercial mode - it never actually sends email. Configure a real EmailPort adapter (e.g. ResendEmailPort) before activating commercial mode.`,
    );
  }
}

/**
 * The pilot's fallback when no real email provider is configured. Never
 * sends; logs at warn level so a code path that expects email to actually
 * go out fails loud in development instead of silently no-op'ing in a way
 * that looks like success. Refuses to construct at all when
 * `DEPLOYMENT_MODE=commercial` (Part 5 §5: "Commercial/production mode must
 * refuse to start ... if NullEmailPort is active") - the same
 * `assertNotCommercialMode` pattern `LocalEnvelopeKeyProvider` and
 * `ClamAvScanner` already use for their own pilot-only escape hatches.
 * Deliberately logs neither `to` nor `subject` (SEC-02/PRV: "remove
 * recipient and subject logging" from ordinary application logging) - a
 * prior version of this class did log both, which known-issues.md tracked
 * as an open item pending a real adapter existing to replace it; this class
 * is that replacement's sibling, so the fix belongs here too.
 */
export class NullEmailPort implements EmailPort {
  constructor(options: { readonly deploymentMode?: string | undefined } = {}) {
    assertNotCommercialMode(options.deploymentMode ?? readEnv('DEPLOYMENT_MODE'), 'NullEmailPort');
  }

  async send(_input: SendEmailInput): Promise<SendEmailResult> {
    console.warn('[NullEmailPort] no email provider configured - not sent');
    return {};
  }
}

export interface ResendEmailPortOptions {
  readonly apiKey: string;
  /** The verified sending address, e.g. "VisaStack <notifications@yourdomain.com>". */
  readonly from: string;
  /** Injectable for tests; defaults to the real API. */
  readonly apiBaseUrl?: string;
  /** Injectable for tests (matches `OpenAiExtractionAdapter`'s own convention); defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface ResendSendResponse {
  readonly id?: string;
}

/**
 * NTF-03 (Part 5 §5): a real transactional email provider adapter. Chosen
 * provider: Resend (see `docs/adr/0013-transactional-email-resend.md` for
 * the full comparison and rationale). Calls Resend's REST API directly
 * (`POST /emails`) rather than depending on the `resend` npm package, to
 * keep this adapter's dependency footprint identical to every other one in
 * this file (a single `fetch` call) and avoid a version-pinned SDK
 * dependency for one HTTP call this simple.
 *
 * Never logs `to`/`subject`/`body` (SEC-02/PRV). A non-2xx response throws,
 * letting `notifications.ts`'s own retry/backoff (never Resend's own retry
 * behavior, which this adapter does not depend on) handle transient
 * failures.
 */
export class ResendEmailPort implements EmailPort {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResendEmailPortOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.resend.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        text: input.body,
      }),
    });

    if (!response.ok) {
      // Deliberately no `to`/`subject` in this message -- only the provider's
      // own status/error shape, safe to surface in logs and lastError.
      const errorBody = await response.text().catch(() => '');
      throw new Error(`ResendEmailPort: provider returned ${response.status} ${errorBody}`.trim());
    }

    const body = (await response.json().catch(() => ({}))) as ResendSendResponse;
    return body.id ? { providerMessageId: body.id } : {};
  }
}
