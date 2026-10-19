import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AgentGateway } from '@voxel/agent-gateway';
import {
  parseConnect,
  parseRequest,
  publicError,
  GatewayError,
  methods,
  MAX_REQUEST_BYTES,
  type RpcParams,
  type ServerFrame,
} from '@voxel/gateway-protocol';
import type { GatewayAuth } from './auth';
/** One connection owns subscriptions only. Its lifetime never owns hosted Agent work. */
export function gatewaySocket(
  gateway: AgentGateway,
  auth: GatewayAuth,
  epoch: string,
  socket: WebSocket,
  req: IncomingMessage,
) {
  let connected = false,
    closed = false,
    pending = 0;
  const subscriptions = new Map<string, () => void>();
  const send = (frame: ServerFrame) => {
    if (closed || socket.readyState !== 1) return;
    if (socket.bufferedAmount > 1024 * 1024) {
      socket.close(1013, 'resync required');
      return;
    }
    socket.send(JSON.stringify(frame));
  };
  const fail = (e: unknown) => {
    send({ type: 'error', error: publicError(e) });
    socket.close(1008, 'gateway rejected');
  };
  const timer = setTimeout(
    () => fail(new GatewayError('网关握手超时。', 'BAD_HANDSHAKE', 401)),
    5000,
  );
  timer.unref();
  socket.on('error', () => {});
  socket.once('close', () => {
    closed = true;
    clearTimeout(timer);
    for (const stop of subscriptions.values()) stop();
    subscriptions.clear();
  });
  socket.on('message', (data, binary) => {
    void (async () => {
      try {
        if (binary || Buffer.byteLength(data.toString()) > MAX_REQUEST_BYTES)
          throw new GatewayError('网关帧过大或不是文本。');
        const value = JSON.parse(data.toString());
        if (!connected) {
          const hello = parseConnect(value);
          if (
            !auth.acceptsOrigin(req.headers.origin) ||
            !auth.verify(hello.token)
          )
            throw new GatewayError(
              '管理员令牌或页面来源无效。',
              'UNAUTHORIZED',
              401,
            );
          connected = true;
          clearTimeout(timer);
          send({
            type: 'connected',
            version: 1,
            gatewayEpoch: epoch,
            capabilities: methods,
          });
          return;
        }
        const r = parseRequest(value);
        if (pending >= 32) {
          send({
            type: 'res',
            id: r.id,
            ok: false,
            error: publicError(new GatewayError('连接请求过多。', 'BUSY', 429)),
          });
          return;
        }
        pending++;
        try {
          let result: unknown;
          if (r.method === 'gateway.subscribe') {
            if (subscriptions.size >= 16)
              throw new GatewayError('订阅数量过多。', 'BUSY', 429);
            const subscriptionId = randomUUID();
            let seq = 0,
              ready = false;
            const buffered: unknown[] = [];
            const p = r.params;
            const stop = gateway.events.on((change) => {
              if (p.scope === 'providers' && change.resource !== 'providers')
                return;
              if (
                p.agentId &&
                change.resource === 'agents' &&
                !change.agentIds.includes(p.agentId)
              )
                return;
              if (!ready) {
                if (buffered.length >= 1024) {
                  socket.close(1013, 'resync required');
                  return;
                }
                buffered.push(change);
                return;
              }
              send({
                type: 'event',
                subscriptionId,
                seq: ++seq,
                event: 'changed',
                data: change,
              });
            });
            subscriptions.set(subscriptionId, stop);
            try {
              const snapshot = await readSnapshot(gateway, p);
              if (closed) return;
              send({
                type: 'res',
                id: r.id,
                ok: true,
                result: { subscriptionId },
              });
              send({
                type: 'event',
                subscriptionId,
                seq: ++seq,
                event: 'snapshot',
                data: snapshot,
              });
              ready = true;
              for (const change of buffered)
                send({
                  type: 'event',
                  subscriptionId,
                  seq: ++seq,
                  event: 'changed',
                  data: change,
                });
              return;
            } catch (e) {
              stop();
              subscriptions.delete(subscriptionId);
              throw e;
            }
          } else if (r.method === 'gateway.unsubscribe') {
            subscriptions.get(r.params.subscriptionId ?? '')?.();
            subscriptions.delete(r.params.subscriptionId ?? '');
            result = null;
          } else
            result = await gateway.dispatch(r.method, r.params, r.commandId);
          send({ type: 'res', id: r.id, ok: true, result });
        } catch (e) {
          send({ type: 'res', id: r.id, ok: false, error: publicError(e) });
        } finally {
          pending--;
        }
      } catch (e) {
        fail(
          e instanceof SyntaxError ? new GatewayError('网关 JSON 无效。') : e,
        );
      }
    })();
  });
}
async function readSnapshot(g: AgentGateway, p: RpcParams) {
  if (p.scope === 'providers') return g.dispatch('providers.list', {});
  if (p.scope === 'agent')
    return g.dispatch('agents.get', { agentId: p.agentId });
  if (p.scope === 'plans')
    return g.dispatch('plans.list', { agentId: p.agentId });
  if (p.scope === 'runs')
    return g.dispatch('runs.list', {
      agentId: p.agentId,
      planId: p.planId,
      offset: p.offset,
    });
  return {
    agents: await g.dispatch('agents.list', {}),
    providers: await g.dispatch('providers.list', {}),
  };
}
