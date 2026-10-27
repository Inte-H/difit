import { once } from 'events';
import { createServer, type Server } from 'http';
import { type AddressInfo } from 'net';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { acceptLiveSockets } from './live-socket.js';

const PING_MS = 50;

describe('acceptLiveSockets', () => {
  const servers: Server[] = [];
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
    );
  });

  async function listen(onConnection: Parameters<typeof acceptLiveSockets>[1]) {
    const server = createServer();
    servers.push(server);
    acceptLiveSockets(server, onConnection, PING_MS);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as AddressInfo).port;
  }

  function connect(port: number, path: string, options?: { autoPong: boolean }) {
    const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, options);
    clients.push(client);
    return client;
  }

  it('accepts a socket on /api/live, query string included', async () => {
    const onConnection = vi.fn();
    const port = await listen(onConnection);

    await once(connect(port, '/api/live?tab=1'), 'open');

    expect(onConnection).toHaveBeenCalledTimes(1);
  });

  it('refuses an upgrade on any other path', async () => {
    const onConnection = vi.fn();
    const port = await listen(onConnection);
    const client = connect(port, '/api/other');

    await expect(once(client, 'open')).rejects.toThrow();
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('keeps a socket whose page answers every ping', async () => {
    const closed = vi.fn();
    const port = await listen((socket) => socket.on('close', closed));

    await once(connect(port, '/api/live'), 'open');
    await new Promise((resolve) => setTimeout(resolve, PING_MS * 6));

    expect(closed).not.toHaveBeenCalled();
  });

  it('closes a socket whose page misses a pong', async () => {
    const closed = vi.fn();
    const port = await listen((socket) => socket.on('close', closed));

    await once(connect(port, '/api/live', { autoPong: false }), 'open');

    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1), { timeout: PING_MS * 20 });
  });
});
