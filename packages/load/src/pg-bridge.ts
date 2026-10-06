import { type Socket, connect } from 'node:net';
import { neonConfig } from '@neondatabase/serverless';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Lets the application's own Neon database driver (WebSocket based, the one production uses) talk
 * to an ordinary local Postgres. The driver sends Postgres wire bytes inside WebSocket messages;
 * this bridge copies them to and from a TCP socket. It only ever listens on loopback.
 */
export interface Bridge {
  readonly port: number;
  close(): Promise<void>;
}

export async function startBridge(input: {
  readonly listenPort: number;
  readonly pgHost: string;
  readonly pgPort: number;
}): Promise<Bridge> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: input.listenPort });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  server.on('connection', (ws: WebSocket) => {
    const tcp: Socket = connect(input.pgPort, input.pgHost);
    const pending: Buffer[] = [];
    let open = false;
    tcp.once('connect', () => {
      open = true;
      for (const chunk of pending) tcp.write(chunk);
      pending.length = 0;
    });
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const chunk = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      if (open) tcp.write(chunk);
      else pending.push(chunk);
    });
    tcp.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
    });
    const shut = () => {
      tcp.destroy();
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
    ws.on('close', shut);
    ws.on('error', shut);
    tcp.on('close', shut);
    tcp.on('error', shut);
  });
  return {
    port: input.listenPort,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}

/** Point the Neon driver at the bridge (plain WebSocket, no TLS, no connection pipelining). */
export function useLocalBridge(listenPort: number): void {
  neonConfig.wsProxy = () => `127.0.0.1:${listenPort}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  neonConfig.forceDisablePgSSL = true;
}
