import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
const root = fileURLToPath(new URL('../apps/server/src/', import.meta.url));
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(resolve(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
        ? [resolve(dir, e.name)]
        : [],
  );
const graph = new Map(
  sources(root).map((file) => [
    file,
    ts
      .preProcessFile(readFileSync(file, 'utf8'), true, true)
      .importedFiles.map((i) => i.fileName)
      .filter((i) => i.startsWith('.'))
      .map((spec) => {
        const base = resolve(dirname(file), spec);
        return (
          [base, base + '.ts', base + '/index.ts'].find(
            (p) => existsSync(p) && statSync(p).isFile(),
          ) ?? base
        );
      })
      .filter((file) => file.startsWith(root) && file.endsWith('.ts')),
  ]),
);
it('keeps infrastructure independent of business modules and modules independent of composition/transport', () => {
  for (const [file, deps] of graph) {
    const name = relative(root, file);
    for (const dep of deps) {
      const target = relative(root, dep);
      if (name.startsWith('common/') || name.startsWith('config/'))
        expect(target.startsWith('modules/'), `${name} -> ${target}`).toBe(
          false,
        );
      if (name.startsWith('modules/'))
        expect(
          ['app.ts', 'server.ts', 'index.ts'].includes(target) ||
            target.startsWith('transport/'),
          `${name} -> ${target}`,
        ).toBe(false);
      if (
        name.startsWith('modules/audio/') ||
        name.startsWith('modules/providers/') ||
        name.startsWith('modules/tasks/')
      )
        expect(
          target.startsWith('modules/agent/'),
          `${name} -> ${target}`,
        ).toBe(false);
      if (name.startsWith('modules/agent/') && !name.includes('/routes/'))
        expect(target.includes('/routes/'), `${name} -> ${target}`).toBe(false);
    }
    if (!name.startsWith('config/'))
      expect(readFileSync(file, 'utf8'), name).not.toMatch(/process\.env/);
  }
});
it('has no server module cycles, including type imports and re-exports', () => {
  const done = new Set<string>();
  function visit(file: string, chain: string[]) {
    if (chain.includes(file))
      throw Error([...chain, file].map((p) => relative(root, p)).join(' -> '));
    if (done.has(file)) return;
    for (const dep of graph.get(file) ?? []) visit(dep, [...chain, file]);
    done.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
});
it('keeps all world integration/sandbox assembly on the production test factory', () => {
  const testRoot = resolve(root, '../test');
  for (const dir of ['integration', 'sandbox'])
    for (const name of readdirSync(resolve(testRoot, dir)).filter((n) =>
      n.endsWith('.ts'),
    )) {
      const source = readFileSync(resolve(testRoot, dir, name), 'utf8');
      expect(source, `${dir}/${name}`).toContain('createTestServer');
      expect(source, `${dir}/${name}`).not.toMatch(
        /new Server\(|\.define\('world'/,
      );
    }
});
