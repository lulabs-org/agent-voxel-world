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
        ? 'Answer a greeting, question or clarification. Does not move or change the world. Never use this to claim a newly requested world action is done.'
        : name === 'start_task'
          ? 'Start a NEW world action requested in currentRequest, including moving to the sender, building, or removing blocks. Use the current sender actor ID in the goal. A separate executor performs and verifies the action.'
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
