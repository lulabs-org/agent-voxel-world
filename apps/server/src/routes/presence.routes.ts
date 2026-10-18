import type { Express } from 'express';
import type { WorldPresence } from '@voxel/shared';

/** Read-only world presence. Viewing the lobby never reserves a player seat. */
export function installPresenceRoutes(
  app: Express,
  read: () => WorldPresence | undefined,
) {
  /**
   * @openapi
   * /world/presence:
   *   get:
   *     summary: 世界状态 SSE 长连接
   *     description: 监听世界的在线玩家与在线状态 (Server-Sent Events)
   *     tags:
   *       - World
   *     responses:
   *       200:
   *         description: 实时 SSE 事件流
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   *       403:
   *         description: Origin 不受信任
   *       503:
   *         description: 世界服务未就绪
   */
  app.get('/world/presence', (req, res) => {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173')
    ) {
      res.sendStatus(403);
      return;
    }
    if (origin) res.header('Access-Control-Allow-Origin', origin);
    if (!read()) {
      res.sendStatus(503);
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = () => {
      const state = read();
      if (!state) {
        res.end();
        return;
      }
      // A heartbeat on every tick also detects loss of the world service.
      if (!res.writableNeedDrain)
        res.write(`data: ${JSON.stringify(state)}\n\n`);
    };
    const interval = setInterval(send, 1000);
    res.on('close', () => clearInterval(interval));
    send();
  });
}
