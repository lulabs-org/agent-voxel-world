import type { Express } from 'express';

/**
 * @openapi
 * /world:
 *   get:
 *     summary: 获取当前世界房间 ID
 *     description: 获取 Colyseus 当前活动的 WorldRoom 实例房间 ID
 *     tags:
 *       - World
 *     responses:
 *       200:
 *         description: 返回世界房间信息
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 roomId:
 *                   type: string
 *                   example: 4xK9pL2
 */
export function installWorldRoutes(app: Express, getRoomId: () => string) {
  app.get('/world', (_req, res) => res.json({ roomId: getRoomId() }));
}
