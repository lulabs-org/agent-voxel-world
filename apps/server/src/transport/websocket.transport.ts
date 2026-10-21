import type { Server } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { SocketHandler } from '../common/socket-routes';

/** Shares Colyseus' socket server and heartbeat with explicitly registered routes. */
export class RoutedWebSocketTransport extends WebSocketTransport {
  closeConnections() {
    for (const client of this.wss.clients) client.terminate();
  }

  constructor(server: Server, routes: ReadonlyMap<string, SocketHandler>) {
    super({ server, maxPayload: 32768 });
    this.wss.off('connection', this.onConnection);
    this.wss.on('connection', (socket, req) => {
      const client = Object.assign(socket, { pingCount: 0 });
      client.on('pong', () => (client.pingCount = 0));
      const url = new URL(req.url ?? '/', 'http://localhost');
      const handler = routes.get(url.pathname);
      if (handler) {
        handler(client, req);
        return;
      }
      void this.onConnection(client, req);
    });
  }
}
