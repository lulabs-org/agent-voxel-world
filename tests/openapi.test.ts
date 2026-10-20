import { expect, it } from 'vitest';
import { swaggerSpec } from '../apps/server/src/common/swagger';

const spec = swaggerSpec as any;
const operations = Object.entries(spec.paths).flatMap(
  ([path, item]: [string, any]) =>
    Object.entries(item)
      .filter(([method]) =>
        ['get', 'post', 'put', 'patch', 'delete'].includes(method),
      )
      .map(([method, operation]) => ({
        path,
        method,
        operation: operation as any,
      })),
);

it('includes agent and task endpoints from domain routes.ts files', () => {
  for (const [path, methods] of [
    ['/agents', ['get', 'post']],
    ['/agents/{id}', ['put', 'delete']],
    ['/tasks', ['get', 'post']],
    ['/tasks/{planId}', ['get', 'put', 'delete']],
    ['/task-runs/{runId}/{operation}', ['post']],
  ] as const) {
    expect(spec.paths[path], path).toBeDefined();
    for (const method of methods)
      expect(spec.paths[path][method], `${method} ${path}`).toBeDefined();
  }
});

it('documents resource ownership, management and chat credentials, with no global auth on public APIs', () => {
  expect(spec.servers).toEqual([{ url: '/', description: '当前服务器' }]);
  expect(spec.security).toBeUndefined();
  const management = [
    ['/agents', 'AI Characters'],
    ['/providers', 'Providers'],
    ['/tasks', 'Tasks'],
    ['/task-runs', 'Tasks'],
    ['/voice/tts/services', 'TTS'],
    ['/voice/tts/piper', 'TTS'],
    ['/voice/asr/services', 'ASR'],
  ];
  for (const { path, operation } of operations) {
    const domain = management.find(
      ([prefix]) => path === prefix || path.startsWith(prefix + '/'),
    );
    if (domain) {
      expect(operation.tags, path).toEqual([domain[1]]);
      expect(operation.security, path).toEqual([{ ManagementBearer: [] }]);
    } else if (path.startsWith('/chat/')) {
      expect(operation.security, path).toEqual([{ ChatBearer: [] }]);
    } else expect(operation.security, path).toBeUndefined();
    expect(path).not.toMatch(
      /^\/agents\/(providers|tasks|task-runs|voice-services)(\/|$)/,
    );
  }
  expect(spec.components.securitySchemes.ManagementBearer.scheme).toBe(
    'bearer',
  );
  expect(spec.components.securitySchemes.ChatBearer.scheme).toBe('bearer');
});

it('provides path parameters, request bodies and successful responses, and resolves every local reference', () => {
  for (const { path, method, operation } of operations) {
    for (const match of path.matchAll(/\{([^}]+)\}/g)) {
      expect(operation.parameters, `${method} ${path}`).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: match[1],
            in: 'path',
            required: true,
            schema: expect.any(Object),
          }),
        ]),
      );
    }
    expect(
      Object.keys(operation.responses ?? {}).some((status) =>
        /^2\d\d$/.test(status),
      ),
      `${method} ${path}`,
    ).toBe(true);
    if (
      ['post', 'put'].includes(method) &&
      (path.startsWith('/tasks') || path.startsWith('/task-runs'))
    )
      expect(
        operation.requestBody?.content['application/json'].schema,
      ).toBeDefined();
  }
  function visit(value: any) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      expect(value.$ref.startsWith('#/')).toBe(true);
      const target = value.$ref
        .slice(2)
        .split('/')
        .reduce((node: any, key: string) => node?.[key], spec);
      expect(target, value.$ref).toBeDefined();
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(spec);
  expect(
    spec.paths['/tasks/{planId}/{operation}'].post.parameters.find(
      (p: any) => p.name === 'operation',
    ).schema.enum,
  ).toEqual(['run', 'pause', 'resume', 'archive', 'extend']);
  expect(
    spec.paths['/task-runs/{runId}/{operation}'].post.parameters.find(
      (p: any) => p.name === 'operation',
    ).schema.enum,
  ).toEqual(['pause', 'resume', 'cancel']);
});

it('exposes task controls only through plans and explicit run IDs', () => {
  for (const operation of ['task', 'pause', 'resume', 'cancel'])
    expect(spec.paths[`/agents/{id}/${operation}`]).toBeUndefined();
  expect(spec.paths['/tasks'].post.description).toContain('无需再次调用 run');
  expect(spec.paths['/tasks/{planId}/{operation}'].post.description).toContain(
    '不影响当前执行',
  );
  expect(
    spec.paths['/task-runs/{runId}/{operation}'].post.description,
  ).toContain('不自动上线');
});

it('documents profile-only Agent writes and default standby with optional offline creation', () => {
  expect(
    spec.paths['/agents'].post.requestBody.content['application/json'].schema
      .$ref,
  ).toBe('#/components/schemas/AgentCreate');
  expect(
    spec.paths['/agents/{id}'].put.requestBody.content['application/json']
      .schema.$ref,
  ).toBe('#/components/schemas/AgentProfileUpdate');
  expect(spec.components.schemas.AgentCreate.properties.joinWorld).toEqual({
    type: 'boolean',
    default: true,
  });
  for (const name of ['AgentCreate', 'AgentProfileUpdate']) {
    const schema = spec.components.schemas[name];
    expect(schema.properties.goal).toBeUndefined();
    expect(schema.properties.startTask).toBeUndefined();
    expect(schema.properties.taskTimeZone).toBeUndefined();
    expect(schema.not.anyOf).toEqual(
      expect.arrayContaining([
        { required: ['startTask'] },
        { required: ['taskTimeZone'] },
      ]),
    );
  }
});
