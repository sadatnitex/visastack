import type { EmailPort, SendEmailInput } from '@visastack/services';

/**
 * The pilot's email provider — there isn't one (master directive §7 "PR 11"
 * pilot-provider list names no email provider, the same way it names none
 * for payments). Never sends; logs at warn level so a code path that
 * expects email to actually go out fails loud in development instead of
 * silently no-op'ing in a way that looks like success.
 */
export class NullEmailPort implements EmailPort {
  async send(input: SendEmailInput): Promise<void> {
    console.warn(
      `[NullEmailPort] no email provider configured — not sent: to=${input.to} subject=${JSON.stringify(input.subject)}`,
    );
  }
}
