import { blocked, configured } from './setup';

/**
 * Reads the code the product emailed to a synthetic guest, from a capture inbox the owner runs.
 *
 * The contract (the owner provides it; nothing here creates it): an HTTPS endpoint at
 * E2E_GUEST_INBOX_URL that, given `?to=<address>&since=<unix ms>` and the header
 * `Authorization: Bearer <E2E_GUEST_INBOX_TOKEN>`, answers 200 with JSON
 * `{ "messages": [{ "to": "...", "receivedAt": <unix ms>, "text": "..." }] }`, newest last, and
 * answers 200 with an empty list when nothing has arrived. A provider that cannot do this (the
 * staging mail setting sends nowhere) leaves the guest journey BLOCKED; no stand-in is invented.
 */

interface InboxMessage {
  readonly to: string;
  readonly receivedAt: number;
  readonly text: string;
}

export function guestRecipient(): string {
  return configured('E2E_GUEST_RECIPIENT_EMAIL');
}

/** The six-digit code in the newest message to the guest address that arrived after `since`. */
export async function waitForGuestCode(since: number, seconds = 90): Promise<string> {
  const url = configured('E2E_GUEST_INBOX_URL');
  const token = configured('E2E_GUEST_INBOX_TOKEN');
  const to = guestRecipient();
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}?to=${encodeURIComponent(to)}&since=${since}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok)
      blocked(`the capture inbox answered ${response.status}; check E2E_GUEST_INBOX_URL`);
    const body = (await response.json()) as { messages?: InboxMessage[] };
    const newest = (body.messages ?? []).filter((m) => m.receivedAt >= since).at(-1);
    const code = newest?.text.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((done) => setTimeout(done, 3_000));
  }
  throw new Error(`No code reached the capture inbox within ${seconds} seconds.`);
}
