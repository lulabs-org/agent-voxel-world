import { readProviderDefaults, dataPath } from '../../config/env';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  providerView,
  validateProvider,
  type SavedProvider,
  ManagementError,
} from '@voxel/agent-gateway';

export class ProviderStore {
  private values: SavedProvider[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly path = dataPath('agent-providers.json')) {}

  async load(env?: NodeJS.ProcessEnv) {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(saved) || saved.length > 20) throw Error('invalid');
      this.values = saved.map((p: SavedProvider) => {
        if (typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id))
          throw Error('invalid');
        return { ...validateProvider(p), id: p.id };
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new ManagementError(
          '无法读取模型服务配置，请检查本地配置文件。',
          500,
        );
      this.values = [
        {
          ...validateProvider({
            name: 'DeepSeek',
            type: 'deepseek',
            apiKey: readProviderDefaults(env).deepseekApiKey,
            defaultModel: readProviderDefaults(env).deepseekModel,
          }),
          id: 'deepseek',
        },
        {
          ...validateProvider({
            name: '本机 Ollama',
            type: 'ollama',
            defaultModel: readProviderDefaults(env).ollamaModel,
          }),
          id: 'ollama',
        },
      ];
      await this.persist(this.values);
    }
  }

  list() {
    return this.values.map(providerView);
  }

  get(id: string) {
    const provider = this.values.find((p) => p.id === id);
    if (!provider) throw new ManagementError('模型服务不存在。', 404);
    return { ...provider };
  }

  private async persist(values: SavedProvider[]) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(values, null, 2), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(fn);
    this.queue = operation.catch(() => {});
    return operation;
  }

  save(value: unknown, id?: string) {
    return this.mutate(async () => {
      if (!id && this.values.length >= 20)
        throw new ManagementError('最多保存 20 个模型服务。');
      const provider = validateProvider(value, id ? this.get(id) : undefined);
      const next = id
        ? this.values.map((p) => (p.id === id ? provider : p))
        : [...this.values, provider];
      await this.persist(next);
      this.values = next;
      return providerView(provider);
    });
  }

  remove(id: string) {
    return this.mutate(async () => {
      this.get(id);
      const next = this.values.filter((p) => p.id !== id);
      await this.persist(next);
      this.values = next;
    });
  }
}
