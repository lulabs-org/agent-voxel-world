import { Type } from '@earendil-works/pi-ai';
const material = Type.Union(
  ['grass', 'dirt', 'stone', 'wood'].map((v) => Type.Literal(v)),
);
const coordinates = {
  x: Type.Integer(),
  y: Type.Integer({ minimum: 1 }),
  z: Type.Integer(),
};
const block = Type.Object({
  ...coordinates,
  material: Type.Union([material, Type.Null()]),
});
export const toolSchemas = {
  observe: Type.Object({}),
  chat: Type.Object({ text: Type.String({ minLength: 1, maxLength: 240 }) }),
  move: Type.Object({
    x: Type.Number({ minimum: -1, maximum: 1 }),
    z: Type.Number({ minimum: -1, maximum: 1 }),
    jump: Type.Boolean(),
    durationMs: Type.Integer({ minimum: 100, maximum: 1500 }),
  }),
  edit: block,
  build: Type.Object({
    blocks: Type.Array(block, { minItems: 1, maxItems: 64 }),
  }),
  house: Type.Object({
    ...coordinates,
    width: Type.Integer({ minimum: 3, maximum: 7 }),
    depth: Type.Integer({ minimum: 3, maximum: 7 }),
    height: Type.Integer({ minimum: 4, maximum: 6 }),
    material,
    door: Type.Union(
      ['north', 'south', 'east', 'west'].map((v) => Type.Literal(v)),
    ),
  }),
  wait: Type.Object({
    waitFor: Type.Union([Type.Literal('world'), Type.Literal('players')]),
    summary: Type.String({ minLength: 1, maxLength: 500 }),
  }),
  update_task: Type.Object({
    intent: Type.Union(
      ['reply', 'task', 'update', 'continue', 'pause', 'resume', 'cancel'].map(
        (v) => Type.Literal(v),
      ),
    ),
    status: Type.Union(
      ['running', 'waiting', 'needs_input', 'blocked', 'completed'].map((v) =>
        Type.Literal(v),
      ),
    ),
    summary: Type.String({ minLength: 1, maxLength: 500 }),
    goal: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    waitFor: Type.Optional(
      Type.Union([Type.Literal('world'), Type.Literal('players')]),
    ),
  }),
};
