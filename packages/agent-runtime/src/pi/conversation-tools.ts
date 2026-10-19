import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TaskCommand } from '../task/service';
import { conversationToolSchemas } from './tool-schemas';

/** This adapter has no world executor or session access. */
export function conversationTools(
  reply: (text: string) => Promise<void>,
  command: (command: TaskCommand, reply?: string) => Promise<void>,
): AgentTool[] {
  return Object.entries(conversationToolSchemas).map(([name, parameters]) => ({
    name,
    label: name,
    parameters,
    description:
      name === 'reply'
        ? 'Reply to the current message and finish.'
        : 'Submit one task command; the task executor will perform world actions.',
    execute: async (_id, value) => {
      const args = value as { text?: string; goal?: string; reply?: string };
      if (name === 'reply') await reply(args.text!);
      else
        await command(
          { type: name.replace('_task', ''), goal: args.goal } as TaskCommand,
          args.reply,
        );
      return { content: [{ type: 'text', text: '已处理。' }], details: {} };
    },
  }));
}
