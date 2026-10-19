import {
  GatewayError,
  isWrite,
  type RpcMethod,
  type RpcParams,
  type ServerFrame,
  type GatewayEvent,
} from '@voxel/gateway-protocol';
export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
};
export type ClientState =
  | 'closed'
  | 'connecting'
  | 'connected'
  | 'unauthorized'
  | 'disconnected';
export class UnknownOutcome extends Error {
  constructor(readonly commandId: string) {
    super('连接已中断，操作结果待确认。请同步当前状态后再决定是否重新操作。');
  }
}
type Subscription = {
  params: RpcParams;
  remote?: string;
  active: boolean;
  restoring?: Promise<void>;
};
export class GatewayClient {
  private socket?: SocketLike;
  private stopped = true;
  private timer?: ReturnType<typeof setTimeout>;
  private retry = 0;
  private counter = 0;
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      commandId?: string;
      cleanup: () => void;
    }
  >();
  private connectPromise?: Promise<void>;
  private resolveConnect?: () => void;
  private rejectConnect?: (e: Error) => void;
  private listeners = new Set<(event: GatewayEvent) => void>();
  private states = new Set<(state: ClientState) => void>();
  private sequences = new Map<string, number>();
  private subscriptions = new Map<string, Subscription>();
  private outcomeListeners = new Set<(id: string, receipt: any) => void>();
  onOutcome(fn: (id: string, receipt: any) => void) {
    this.outcomeListeners.add(fn);
    return () => {
      this.outcomeListeners.delete(fn);
    };
  }
  private unresolved = new Set<string>();
  readonly outcomes = new Map<string, unknown>();
  state: ClientState = 'closed';
  epoch?: string;
  constructor(
    private options: {
      url: string;
      token: () => string;
      socket: (url: string) => SocketLike;
      reconnect?: boolean;
      client?: 'web' | 'cli';
    },
  ) {}
  onState(fn: (state: ClientState) => void) {
    this.states.add(fn);
    return () => {
      this.states.delete(fn);
    };
  }
  onEvent(fn: (event: GatewayEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private setState(state: ClientState) {
    this.state = state;
    for (const f of this.states) f(state);
  }
  connect(): Promise<void> {
    if (this.state === 'connected') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.stopped = false;
    clearTimeout(this.timer);
    this.setState('connecting');
    this.connectPromise = new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    const result = this.connectPromise;
    let socket: SocketLike;
    try {
      socket = this.options.socket(this.options.url);
      this.socket = socket;
    } catch {
      this.rejectConnect?.(new Error('无法连接网关。'));
      this.connectPromise = undefined;
      this.setState('disconnected');
      return result;
    }
    const handshake = setTimeout(() => socket.close(), 6000);
    socket.addEventListener('open', () => {
      if (this.socket === socket)
        socket.send(
          JSON.stringify({
            type: 'connect',
            version: 1,
            client: this.options.client ?? 'web',
            token: this.options.token(),
          }),
        );
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        socket.close();
        return;
      }
      if (frame.type === 'connected') {
        clearTimeout(handshake);
        this.epoch = frame.gatewayEpoch;
        this.retry = 0;
        this.setState('connected');
        this.resolveConnect?.();
        this.connectPromise = undefined;
        for (const s of this.subscriptions.values())
          if (s.active) void this.restoreSubscription(s).catch(() => {});
        for (const id of this.unresolved)
          void this.request('commands.get', { commandId: id })
            .then((r) => {
              this.outcomes.set(id, r);
              if ((r as { state: string }).state !== 'pending')
                this.unresolved.delete(id);
              for (const fn of this.outcomeListeners) fn(id, r);
            })
            .catch(() => {});
      } else if (frame.type === 'res') {
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id);
        clearTimeout(p.timer);
        p.cleanup();
        if (frame.ok) p.resolve(frame.result);
        else
          p.reject(
            new GatewayError(
              frame.error.message,
              frame.error.code,
              frame.error.status,
            ),
          );
      } else if (frame.type === 'error') {
        if (frame.error.status === 401) {
          this.stopped = true;
          this.setState('unauthorized');
        }
        this.rejectConnect?.(
          new GatewayError(
            frame.error.message,
            frame.error.code,
            frame.error.status,
          ),
        );
        socket.close();
      } else if (frame.type === 'event') {
        const previous = this.sequences.get(frame.subscriptionId) ?? 0;
        if (frame.seq !== previous + 1) {
          socket.close();
          return;
        }
        this.sequences.set(frame.subscriptionId, frame.seq);
        for (const f of this.listeners) f(frame);
      }
    });
    socket.addEventListener('error', () => {});
    socket.addEventListener('close', () => {
      clearTimeout(handshake);
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.sequences.clear();
      this.rejectConnect?.(new Error('网关连接已断开。'));
      this.connectPromise = undefined;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.cleanup();
        if (p.commandId) this.unresolved.add(p.commandId);
        p.reject(
          p.commandId
            ? new UnknownOutcome(p.commandId)
            : new Error('网关连接已断开。'),
        );
      }
      this.pending.clear();
      if (this.state !== 'unauthorized')
        this.setState(this.stopped ? 'closed' : 'disconnected');
      if (!this.stopped && this.options.reconnect !== false)
        this.timer = setTimeout(
          () => {
            void this.connect().catch(() => {});
          },
          Math.min(10000, 500 * 2 ** this.retry++),
        );
    });
    return result;
  }
  async request<T = unknown>(
    method: RpcMethod,
    params: RpcParams = {},
    options: { commandId?: string; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    await this.connect();
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const id = String(++this.counter),
      commandId = isWrite(method)
        ? (options.commandId ?? crypto.randomUUID())
        : undefined;
    return new Promise<T>((resolve, reject) => {
      const finish = (error: Error) => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.cleanup();
        if (commandId) this.unresolved.add(commandId);
        reject(error);
      };
      const abort = () =>
        finish(
          commandId
            ? new UnknownOutcome(commandId)
            : new DOMException('已取消', 'AbortError'),
        );
      const timer = setTimeout(
        () =>
          finish(
            commandId
              ? new UnknownOutcome(commandId)
              : new Error('网关请求超时。'),
          ),
        30000,
      );
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        commandId,
        cleanup: () => options.signal?.removeEventListener('abort', abort),
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        this.socket!.send(
          JSON.stringify({ type: 'req', id, method, params, commandId }),
        );
      } catch {
        finish(
          commandId
            ? new UnknownOutcome(commandId)
            : new Error('网关连接已断开。'),
        );
      }
    });
  }
  private restoreSubscription(s: Subscription): Promise<void> {
    return (s.restoring ??= this.request<{ subscriptionId: string }>(
      'gateway.subscribe',
      s.params,
    )
      .then(async ({ subscriptionId }) => {
        if (!s.active) {
          if (this.state === 'connected')
            await this.request('gateway.unsubscribe', { subscriptionId });
          return;
        }
        s.remote = subscriptionId;
      })
      .finally(() => {
        s.restoring = undefined;
      }));
  }
  async subscribe(params: RpcParams = { scope: 'all' }) {
    const key = crypto.randomUUID(),
      s: Subscription = { params, active: true };
    this.subscriptions.set(key, s);
    try {
      await this.connect();
      await this.restoreSubscription(s);
    } catch (e) {
      if (this.options.reconnect === false || this.state === 'unauthorized') {
        s.active = false;
        this.subscriptions.delete(key);
      }
      throw e;
    }
    return () => {
      s.active = false;
      this.subscriptions.delete(key);
      if (s.remote && this.state === 'connected')
        void this.request('gateway.unsubscribe', {
          subscriptionId: s.remote,
        }).catch(() => {});
    };
  }
  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const s of this.subscriptions.values()) s.active = false;
    this.subscriptions.clear();
    this.socket?.close();
    if (!this.socket) this.setState('closed');
  }
}
