import type { SourceRawResponse, SourceResolver, SourceTransport } from './source-fetch';

/**
 * Test-only: a fake network for the official-source fetcher. The fake transport behaves like a
 * socket: before "connecting" it asks the fetcher's pinned lookup for the address, and records the
 * address it would have connected to. Nothing here touches a real network.
 */

export interface FakeAnswer {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | readonly Uint8Array[];
  /** Never answers; rejects when the fetcher's deadline aborts the request. */
  readonly hang?: boolean;
}

export type FakeHandler = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => FakeAnswer | Promise<FakeAnswer>;

export const PUBLIC_ADDRESS = '93.184.216.34';

type LookupCall = (
  host: string,
  options: { readonly all: boolean },
  callback: (error: Error | null, address: string | readonly { address: string }[]) => void,
) => void;

export function fakeTransport(handler: FakeHandler) {
  const requests: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  const connected: string[] = [];
  const transport: SourceTransport = async (url, init) => {
    requests.push({ url: url.href, headers: init.headers });
    const address = await new Promise<string>((resolve, reject) => {
      (init.lookup as unknown as LookupCall)(url.hostname, { all: true }, (error, found) => {
        if (error) reject(error);
        else resolve(typeof found === 'string' ? found : (found[0]?.address ?? ''));
      });
    });
    connected.push(address);
    const answer = await handler(url.href, init.headers);
    if (answer.hang) {
      await new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    }
    const chunks =
      typeof answer.body === 'string'
        ? [new TextEncoder().encode(answer.body)]
        : (answer.body ?? []);
    let closed = false;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(answer.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    const response: SourceRawResponse = {
      status: answer.status ?? 200,
      headers,
      body: (async function* () {
        for (const chunk of chunks) {
          if (closed) return;
          yield chunk;
        }
      })(),
      close: () => {
        closed = true;
      },
    };
    return response;
  };
  return { transport, requests, connected };
}

/** A resolver giving the same public address for every host. */
export const publicResolver: SourceResolver = async () => [PUBLIC_ADDRESS];
