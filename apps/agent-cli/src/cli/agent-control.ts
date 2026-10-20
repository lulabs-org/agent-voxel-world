import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { GatewayClient, type SocketLike } from '@voxel/gateway-client';
import type { RpcMethod, RpcParams } from '@voxel/gateway-protocol';
const args = process.argv.slice(2);
function option(name: string) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw Error(`缺少 ${name} 参数`);
  args.splice(i, 2);
  return value;
}
let client: GatewayClient | undefined;
try {
  const url = option('--url') ?? 'ws://127.0.0.1:2567/ai-characters/gateway';
  const tokenFile =
    option('--token-file') ??
    process.env.AGENT_GATEWAY_TOKEN_FILE ??
    fileURLToPath(
      new URL('../../../../.data/agent-gateway-token', import.meta.url),
    );
  const goal = option('--goal');
  const characterId = option('--character');
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const [command, id, third] = args;
  if (!command || command === 'help' || command === '--help') {
    console.log(
      '用法：agent:ctl list | status/join/stop <characterId> | plans [characterId] | watch [characterId] | runs <characterId> <planId> | task create <characterId> --goal ... | run pause/resume/cancel <runId> --character <characterId> | auth show；选项 --url --token-file --json',
    );
  } else if (command === 'auth' && id === 'show') {
    console.log((await readFile(tokenFile, 'utf8')).trim());
  } else {
    const token =
      process.env.AGENT_GATEWAY_TOKEN?.trim() ||
      (await readFile(tokenFile, 'utf8')).trim();
    client = new GatewayClient({
      url,
      client: 'cli',
      token: () => token,
      socket: (u) => new WebSocket(u) as unknown as SocketLike,
      reconnect: command === 'watch',
    });
    const print = (v: unknown) =>
      console.log(json ? JSON.stringify(v) : JSON.stringify(v, null, 2));
    if (command === 'watch') {
      let active = true,
        reading = false,
        dirty = false;
      const refresh = async () => {
        dirty = true;
        if (reading) return;
        reading = true;
        try {
          while (active && dirty) {
            dirty = false;
            const snapshot = await client!.request(
              id ? 'characters.get' : 'characters.list',
              id ? { characterId: id } : {},
            );
            if (active) print({ type: 'snapshot', data: snapshot });
          }
        } catch {
          if (active) console.error('暂时无法刷新，等待网关重新同步。');
        } finally {
          reading = false;
        }
      };
      const off = client.onEvent((event) => {
        if (event.event === 'snapshot') print(event);
        else if (active) void refresh();
      });
      let stop!: () => void;
      const ended = new Promise<void>((resolve) => {
        stop = () => {
          active = false;
          off();
          client?.close();
          process.removeListener('SIGINT', stop);
          process.removeListener('SIGTERM', stop);
          resolve();
        };
      });
      client.onState((state) => {
        if (state === 'unauthorized') {
          console.error('管理员令牌无效。');
          process.exitCode = 1;
          stop();
        } else if (state === 'disconnected')
          console.error('连接中断，托管任务继续运行；等待重连。');
      });
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try {
        await client.subscribe(
          id ? { scope: 'character', characterId: id } : { scope: 'all' },
        );
        await ended;
      } catch (error) {
        if (active) throw error;
      } finally {
        stop();
      }
    } else {
      let method: RpcMethod,
        params: RpcParams = {};
      if (command === 'list') method = 'characters.list';
      else if (['status', 'join', 'stop'].includes(command)) {
        method =
          command === 'status'
            ? 'characters.get'
            : (`characters.${command}` as RpcMethod);
        params.characterId = id;
      } else if (command === 'plans') {
        method = 'plans.list';
        params.characterId = id;
      } else if (command === 'runs') {
        method = 'runs.list';
        params = { characterId: id, planId: third, offset: 0 };
      } else if (command === 'task' && id === 'create') {
        if (!goal) throw Error('请通过 --goal 提供任务目标。');
        if (!third) throw Error('请提供执行角色标识。');
        method = 'plans.create';
        params = {
          characterId: third,
          value: {
            name: goal.slice(0, 80),
            goal,
            timing: { kind: 'immediate' },
            timeZone: 'UTC',
          },
        };
      } else if (
        command === 'run' &&
        ['pause', 'resume', 'cancel'].includes(id)
      ) {
        if (!third || !characterId)
          throw Error('请提供 runId 和 --character 执行角色标识。');
        method = 'runs.control';
        const view = await client.request<any>('characters.get', {
          characterId,
        });
        params = {
          characterId,
          runId: third,
          operation: id,
          expectedTask: view.taskIdentity ?? null,
        };
      } else throw Error('不支持的命令。');
      print(await client.request(method, params));
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : '管理命令失败。');
  process.exitCode = 1;
} finally {
  client?.close();
}
