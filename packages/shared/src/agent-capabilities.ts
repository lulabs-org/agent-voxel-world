export type AgentPermissions = {
  move: boolean;
  chat: boolean;
  place: boolean;
  remove: boolean;
};
export type AgentSkillId = 'building' | 'exploration' | 'guide';

export const AGENT_PERMISSIONS = [
  {
    id: 'move',
    name: '移动与跳跃',
    description: '在世界中移动、跳跃，接近目标或调整观察位置。',
  },
  {
    id: 'chat',
    name: '发送聊天',
    description: '发送文字、任务回执和语音回复；关闭后仍可在控制台查看进展。',
  },
  {
    id: 'place',
    name: '放置方块',
    description: '放置方块、批量建造和搭建房屋，不包含拆除。',
  },
  {
    id: 'remove',
    name: '拆除方块',
    description: '移除已有方块，包括批量操作中的拆除步骤。',
  },
] as const;

export const AGENT_SKILLS: ReadonlyArray<{
  id: AgentSkillId;
  name: string;
  description: string;
  requires: readonly (keyof AgentPermissions)[];
  guidance: string;
}> = [
  {
    id: 'building',
    name: '建筑规划',
    description: '选址、确认尺寸与风格，分步施工并验收。',
    requires: ['move', 'chat', 'place'],
    guidance:
      'For assigned building work, inspect the site, clarify dimensions and style, plan manageable construction stages, and verify the finished structure. Do not clear terrain without remove permission.',
  },
  {
    id: 'exploration',
    name: '探索勘察',
    description: '观察可见区域，移动检查并汇报发现。',
    requires: ['move', 'chat'],
    guidance:
      'For assigned exploration, inspect visible surroundings, move in short verified steps, and report observed discoveries. Use goto for locally planned navigation; you have no complete world map. Distinguish unseen areas from confirmed observations.',
  },
  {
    id: 'guide',
    name: '导览讲解',
    description: '根据可见环境讲解，按任务带领玩家移动。',
    requires: ['move', 'chat'],
    guidance:
      'For assigned guiding, explain observed surroundings clearly and move in short stages with the player. Do not invent landmarks or facts about unseen areas.',
  },
];

/** Legacy callers grant movement/chat and use allowEdits for both block operations. */
export function resolvePermissions(
  value: boolean | AgentPermissions,
): AgentPermissions {
  return typeof value === 'boolean'
    ? { move: true, chat: true, place: value, remove: value }
    : {
        move: value.move === true,
        chat: value.chat === true,
        place: value.place === true,
        remove: value.remove === true,
      };
}

export function agentPermissions(settings: {
  permissions?: AgentPermissions;
  allowEdits?: boolean;
}): AgentPermissions {
  return resolvePermissions(
    settings.permissions ?? settings.allowEdits === true,
  );
}

export function validateCapabilities(input: {
  permissions?: unknown;
  skills?: unknown;
  allowEdits?: unknown;
}): { permissions: AgentPermissions; skills: AgentSkillId[] } {
  let permissions: AgentPermissions;
  if (input.permissions === undefined) {
    if (input.allowEdits !== undefined && typeof input.allowEdits !== 'boolean')
      throw Error('建造权限格式无效。');
    permissions = resolvePermissions(input.allowEdits === true);
  } else {
    const value = input.permissions;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) => !AGENT_PERMISSIONS.some((p) => p.id === key),
      ) ||
      AGENT_PERMISSIONS.some(
        ({ id }) => typeof (value as Record<string, unknown>)[id] !== 'boolean',
      )
    ) {
      throw Error('动作权限格式无效，请完整配置四项权限。');
    }
    permissions = resolvePermissions(value as AgentPermissions);
  }
  const skills = input.skills === undefined ? [] : input.skills;
  if (
    !Array.isArray(skills) ||
    skills.some((id) => !AGENT_SKILLS.some((skill) => skill.id === id))
  )
    throw Error('角色技能无效。');
  return {
    permissions,
    skills: AGENT_SKILLS.filter(({ id }) => skills.includes(id)).map(
      ({ id }) => id,
    ),
  };
}
