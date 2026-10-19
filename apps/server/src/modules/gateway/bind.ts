import type { Express, Request, Response } from 'express';
import type { AgentGateway } from './gateway';
import {
  publicError,
  identifier,
  type RpcMethod,
  type RpcParams,
} from '@voxel/gateway-protocol';

export type RpcParamExtractor = (req: Request) => RpcParams;

export function createRpcBinder(app: Express, g: AgentGateway) {
  return (
    verb: 'get' | 'post' | 'put' | 'delete',
    path: string,
    method: RpcMethod,
    params: RpcParamExtractor = () => ({}),
    status = 200,
    legacy = true,
  ) => {
    app[verb](path, (req: Request, res: Response) => {
      const key = req.header('Idempotency-Key');
      if (key !== undefined && !identifier(key)) {
        res.status(400).json({ error: 'Idempotency-Key 无效。' });
        return;
      }
      void g
        .dispatch(
          method,
          params(req),
          req.header('Idempotency-Key') || undefined,
          legacy,
        )
        .then(
          (result) => {
            if (status === 204) res.sendStatus(204);
            else res.status(status).json(result);
          },
          (error) => {
            const e = publicError(error);
            res.status(e.status).json({ error: e.message });
          },
        );
    });
  };
}

export type RpcBinder = ReturnType<typeof createRpcBinder>;
