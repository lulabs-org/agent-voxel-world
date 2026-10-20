const text = { type: 'string' };
const integer = { type: 'integer' };
const object = { type: 'object' };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const planProperties = {
  name: { ...text, maxLength: 80 },
  goal: { ...text, maxLength: 2000 },
  timeZone: { ...text, example: 'Asia/Shanghai' },
  timing: {
    oneOf: [
      {
        type: 'object',
        required: ['kind'],
        properties: { kind: { ...text, enum: ['immediate'] } },
      },
      {
        type: 'object',
        required: ['kind', 'at'],
        properties: {
          kind: { ...text, enum: ['once'] },
          at: { ...integer, description: '未来时间的 Unix 毫秒时间戳' },
        },
      },
      {
        type: 'object',
        required: ['kind', 'everyMs'],
        properties: {
          kind: { ...text, enum: ['interval'] },
          everyMs: { ...integer, minimum: 60000, maximum: 2678400000 },
        },
      },
      {
        type: 'object',
        required: ['kind', 'time'],
        properties: {
          kind: { ...text, enum: ['daily'] },
          time: { ...text, example: '09:00' },
        },
      },
      {
        type: 'object',
        required: ['kind', 'time', 'weekdays'],
        properties: {
          kind: { ...text, enum: ['weekly'] },
          time: { ...text, example: '09:00' },
          weekdays: {
            type: 'array',
            minItems: 1,
            items: { ...integer, minimum: 0, maximum: 6 },
          },
        },
      },
    ],
  },
  limits: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      maxTurns: { ...integer, minimum: 1, maximum: 200, default: 100 },
      tokenBudget: {
        ...integer,
        minimum: 1000,
        maximum: 1000000,
        default: 50000,
      },
      taskTimeoutMs: {
        ...integer,
        minimum: 60000,
        maximum: 7200000,
        default: 900000,
      },
    },
  },
  totalTokenBudget: {
    ...integer,
    minimum: 1000,
    maximum: 1000000000,
    default: 500000,
  },
};

export const apiSchemas = {
  ApiError: {
    type: 'object',
    required: ['error'],
    properties: { error: text, code: text },
  },
  TaskPlanCreate: {
    type: 'object',
    required: ['agentId', 'name', 'goal', 'timeZone', 'timing'],
    properties: {
      ...planProperties,
      agentId: text,
      requestId: { ...text, description: '重试创建时复用的请求标识' },
    },
  },
  TaskPlanUpdate: {
    type: 'object',
    properties: { ...planProperties, agentId: text },
    description: '省略的字段沿用已有计划值',
  },
  TaskPlan: {
    type: 'object',
    required: ['id', 'name', 'goal', 'timing', 'state'],
    properties: {
      ...planProperties,
      id: text,
      agentId: text,
      agentName: text,
      revision: integer,
      state: { ...text, enum: ['enabled', 'paused', 'completed', 'archived'] },
      reason: text,
      spentTokens: integer,
      createdAt: integer,
      updatedAt: integer,
      nextRunAt: integer,
      latestRun: ref('TaskRun'),
    },
  },
  TaskRun: {
    type: 'object',
    required: ['id', 'source', 'status', 'snapshot'],
    properties: {
      id: text,
      planId: text,
      agentId: text,
      agentName: text,
      source: { ...text, enum: ['scheduled', 'manual', 'chat', 'legacy'] },
      status: text,
      reason: text,
      scheduledAt: integer,
      startedAt: integer,
      finishedAt: integer,
      totalTokens: integer,
      snapshot: { type: 'object', properties: planProperties },
      task: object,
      logs: { type: 'array', items: text },
    },
  },
  TaskPlanPage: {
    type: 'object',
    required: ['items', 'total'],
    properties: {
      items: { type: 'array', items: ref('TaskPlan') },
      total: integer,
      nextOffset: integer,
    },
  },
  TaskRunPage: {
    type: 'object',
    required: ['items', 'active', 'total'],
    properties: {
      items: { type: 'array', items: ref('TaskRun') },
      active: { type: 'array', items: ref('TaskRun') },
      total: integer,
      nextOffset: integer,
    },
  },
  AgentView: {
    type: 'object',
    required: ['id', 'name', 'status'],
    properties: { id: text, name: text, status: text, task: object },
    description: '控制当前执行时返回的 Agent 公开状态，包含当前任务及用量。',
  },
  TaskControl: {
    type: 'object',
    properties: {
      agentId: text,
      tokens: {
        ...integer,
        minimum: 1000,
        description: 'extend 需要追加的 token 额度',
      },
      requestId: text,
      maxTurns: integer,
      tokenBudget: integer,
      taskTimeoutMs: integer,
    },
    description:
      '按 operation 提交控制参数；run 必须提交 requestId，extend 需要 tokens，resume 可调整执行限额。',
  },
};
