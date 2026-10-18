import type { Request, Response, RequestHandler } from 'express';
/** Forward async rejections and synchronous throws through the same error middleware. */
export function asyncRoute(
  fn: (req: Request, res: Response) => unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };
}
