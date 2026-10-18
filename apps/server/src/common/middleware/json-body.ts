import type { RequestHandler, Request } from 'express';
import { AppError } from '../errors';
export function assertJsonBody(req: Request) {
  if (['POST', 'PUT'].includes(req.method) && !req.is('application/json'))
    throw new AppError('请使用 JSON 请求。', 415);
}
export const requireJsonBody: RequestHandler = (req, res, next) => {
  try {
    assertJsonBody(req);
    next();
  } catch (error) {
    res.status(415).json({ error: (error as Error).message });
  }
};
