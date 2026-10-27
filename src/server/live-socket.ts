import { type IncomingMessage, type Server } from 'http';

import { WebSocketServer, type WebSocket } from 'ws';

const LIVE_SOCKET_PATH = '/api/live';
const LIVE_PING_INTERVAL_MS = 30_000;

export function isLiveSocketRequest(request: IncomingMessage): boolean {
  return request.url?.split('?')[0] === LIVE_SOCKET_PATH;
}

/**
 * Accepts the one WebSocket each open page keeps on {@link LIVE_SOCKET_PATH}. A socket that
 * misses a pong is closed, so a connection that dropped without a TCP close still ends.
 */
export function acceptLiveSockets(
  server: Server,
  onConnection: (socket: WebSocket) => void,
  pingIntervalMs: number = LIVE_PING_INTERVAL_MS,
): void {
  const sockets = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, stream, head) => {
    if (!isLiveSocketRequest(request)) {
      stream.destroy();
      return;
    }
    sockets.handleUpgrade(request, stream, head, (socket) => {
      let answered = true;
      socket.on('pong', () => {
        answered = true;
      });
      const ping = setInterval(() => {
        if (!answered) {
          socket.terminate();
          return;
        }
        answered = false;
        socket.ping();
      }, pingIntervalMs);
      socket.on('close', () => clearInterval(ping));
      socket.on('error', (error) => console.warn('Live connection error:', error.message));
      onConnection(socket);
    });
  });
}
