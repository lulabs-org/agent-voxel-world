import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const shared = resolve(root, 'packages/shared/src');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'test', 'tests'].includes(entry.name))
      return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.(ts|tsx|mjs)$/.test(path) && !/\.test\.[^.]+$/.test(path)
        ? [path]
        : [];
  });
}
function imports(file: string) {
  return ts
    .preProcessFile(readFileSync(file, 'utf8'), true, true)
    .importedFiles.map(({ fileName }) => fileName);
}
const config = ts.readConfigFile(
  resolve(root, 'tsconfig.json'),
  ts.sys.readFile,
);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
).options;
function resolveImport(file: string, specifier: string) {
  return ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
    ?.resolvedFileName;
}
const inside = (path: string, directory: string) =>
  path.startsWith(directory + '/');

it('keeps shared self-contained and free of circular dependencies', () => {
  const graph = new Map(
    sources(shared).map((file) => [
      file,
      imports(file).map((specifier) => {
        const target = resolveImport(file, specifier);
        expect(target, `${relative(root, file)} -> ${specifier}`).toBeDefined();
        expect(
          inside(target!, shared),
          `${relative(root, file)} -> ${specifier}`,
        ).toBe(true);
        return target!;
      }),
    ]),
  );
  const done = new Set<string>();
  function visit(file: string, chain: string[]) {
    if (chain.includes(file))
      throw Error(
        `Shared dependency cycle: ${[...chain, file].map((p) => relative(root, p)).join(' -> ')}`,
      );
    if (done.has(file)) return;
    expect(graph.has(file), file).toBe(true);
    for (const dependency of graph.get(file)!)
      visit(dependency, [...chain, file]);
    done.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
});

it('keeps the shared root entry declarative', () => {
  const entry = resolve(shared, 'index.ts');
  const ast = ts.createSourceFile(
    entry,
    readFileSync(entry, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of ast.statements) {
    expect(ts.isExportDeclaration(statement)).toBe(true);
  }
});

it('uses public shared exports and keeps server dependencies out of web and runtime', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(shared, '../package.json'), 'utf8'),
  );
  const publicImports = new Set(
    Object.keys(manifest.exports).map((key) =>
      key === '.' ? '@voxel/shared' : '@voxel/shared' + key.slice(1),
    ),
  );
  for (const target of Object.values(manifest.exports) as string[]) {
    expect(existsSync(resolve(shared, '..', target)), target).toBe(true);
  }
  const server = resolve(root, 'apps/server');
  const web = resolve(root, 'apps/web');
  const runtime = resolve(root, 'packages/agent-runtime');
  for (const base of ['apps', 'packages', 'scripts']) {
    for (const file of sources(resolve(root, base))) {
      if (inside(file, shared)) continue;
      for (const specifier of imports(file)) {
        const target = resolveImport(file, specifier);
        const context = `${relative(root, file)} -> ${specifier}`;
        if (
          specifier.startsWith('@voxel/shared') ||
          (target && inside(target, shared))
        ) {
          expect(publicImports.has(specifier), context).toBe(true);
        }
        if (target && (inside(file, web) || inside(file, runtime))) {
          expect(inside(target, server), context).toBe(false);
        }
      }
    }
  }
});
