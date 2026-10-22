import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = resolve(root, 'packages/agent-runtime/src');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : path.endsWith('.ts') && !path.endsWith('.test.ts')
        ? [path]
        : [];
  });
}
function imports(path: string) {
  // Include type imports, re-exports and dynamic imports in the boundary check.
  return ts
    .preProcessFile(readFileSync(path, 'utf8'), true, true)
    .importedFiles.map(({ fileName }) => fileName);
}
const graph = new Map(
  sources(runtime).map((path) => [
    path,
    imports(path)
      .filter((name) => name.startsWith('.'))
      .map((name) =>
        resolve(dirname(path), name.endsWith('.ts') ? name : `${name}.ts`),
      ),
  ]),
);

describe('agent runtime dependency boundaries', () => {
  it('routes all decisions through one character runner and keeps policy in task services', () => {
    const coordinator = readFileSync(
      resolve(runtime, 'runtime/agent-coordinator.ts'),
      'utf8',
    );
    expect(coordinator).toContain('CharacterRunner');
    for (const path of graph.keys()) {
      expect(path).not.toMatch(
        /(?:conversation-runner|task-runner|conversation-tools)\.ts$/,
      );
    }
    const taskTools = readFileSync(
      resolve(runtime, 'cognition/tools.ts'),
      'utf8',
    );
    expect(taskTools).not.toContain('.command(');
    expect(taskTools).not.toContain('.commit(');
    for (const path of graph.keys())
      expect(readFileSync(path, 'utf8')).not.toContain('update_task');
  });

  it('has no circular module dependencies, including types and re-exports', () => {
    const visited = new Set<string>();
    function visit(path: string, chain: string[]) {
      if (chain.includes(path))
        throw Error(
          `Dependency cycle: ${[...chain, path].map((p) => relative(runtime, p)).join(' -> ')}`,
        );
      if (visited.has(path)) return;
      const dependencies = graph.get(path);
      expect(dependencies, `Unknown runtime module: ${path}`).toBeDefined();
      for (const dependency of dependencies!)
        visit(dependency, [...chain, path]);
      visited.add(path);
    }
    for (const path of graph.keys()) visit(path, []);
  });

  it('keeps task rules and Pi adapters independent of runtime orchestration', () => {
    const allowed: Record<string, string[]> = {
      'contracts.ts': [],
      'errors.ts': [],
      transport: ['contracts.ts'],
      actions: ['actions', 'contracts.ts'],
      perception: ['perception', 'task', 'actions', 'contracts.ts'],
      task: ['task', 'actions', 'contracts.ts', 'errors.ts', 'perception'],
      models: ['models', 'contracts.ts', 'errors.ts'],
      cognition: [
        'cognition',
        'task',
        'actions',
        'contracts.ts',
        'errors.ts',
        'perception',
      ],
      runtime: [
        'runtime',
        'cognition',
        'models',
        'task',
        'actions',
        'contracts.ts',
        'errors.ts',
        'transport',
        'perception',
      ],
    };
    for (const [path, dependencies] of graph) {
      const layer = relative(runtime, path).split('/')[0];
      if (layer === 'index.ts') continue;
      for (const dependency of dependencies)
        expect(allowed[layer], relative(runtime, path)).toContain(
          relative(runtime, dependency).split('/')[0],
        );
    }
  });

  it('keeps world writes out of task policy and model requests out of tools', () => {
    const executors = new Set(['actions/execute.ts', 'actions/batch.ts']);
    for (const [path, dependencies] of graph) {
      const module = relative(runtime, path);
      if (
        !module.startsWith('task/') &&
        !module.startsWith('cognition/')
      )
        continue;
      for (const dependency of dependencies)
        expect(executors.has(relative(runtime, dependency)), module).toBe(
          false,
        );
      const external = imports(path).filter((name) => !name.startsWith('.'));
      if (module.startsWith('task/'))
        expect(
          external.some((name) => name.startsWith('@earendil-works/')),
          module,
        ).toBe(false);
      expect(external, module).not.toContain('openai');
      expect(
        external.some((name) => name.includes('/api/')),
        module,
      ).toBe(false);
    }
  });

  it('uses declared package dependencies and never imports application code', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(runtime, '../package.json'), 'utf8'),
    );
    for (const path of graph.keys()) {
      for (const name of imports(path)) {
        if (name.startsWith('.')) continue;
        if (name.startsWith('node:')) continue;
        expect(
          Object.keys(manifest.dependencies),
          relative(runtime, path),
        ).toContain(
          name.startsWith('@')
            ? name.split('/').slice(0, 2).join('/')
            : name.split('/')[0],
        );
      }
    }
    for (const path of [
      ...sources(resolve(root, 'apps/server')),
      ...sources(resolve(root, 'scripts/agent')),
    ]) {
      for (const name of imports(path)) {
        if (name.startsWith('.'))
          expect(relative(root, resolve(dirname(path), name))).not.toMatch(
            /^apps\/agent\//,
          );
        if (name.startsWith('.'))
          expect(relative(root, resolve(dirname(path), name))).not.toMatch(
            /^packages\/agent-runtime\/src\//,
          );
        expect(name).not.toMatch(/^@voxel\/agent-runtime\//);
      }
    }
  });
});
