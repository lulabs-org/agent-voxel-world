import type { AgentTool } from '@earendil-works/pi-agent-core';
import { AgentRuntimeError } from '../../contracts/errors';
import { checkBudgetCap } from '../task/budget';
import type { TaskCommand } from '../task/service';
import { conversationToolSchemas } from './schema';
import type { ToolHost } from './port';

const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
});

/**
 * Creates conversation-scoped task control tools (reply, start_task, revise_task, etc.)
 * that allow the model to manage high-level activities without invoking world actions directly.
 */
export function createTaskControlTools(o: ToolHost): AgentTool[] {
  return Object.entries(conversationToolSchemas).map(([name, parameters]) => ({
    name,
    label: name,
    parameters,
    description:
      name === 'reply'
        ? 'Reply to the current human message without changing the activity.'
        : 'Control the current activity, preserving its identity and spent budget. After start or revise, use world tools in this same session.',
    execute: async (_id, value) => {
      const args = value as {
        text?: string;
        goal?: string;
        reply?: string;
        relatedToTask?: boolean;
      };
      if (name === 'reply') {
        if (
          args.relatedToTask &&
          o.memory.task.current &&
          ['running', 'waiting'].includes(o.memory.task.current.status) &&
          !checkBudgetCap(o.memory.task.current, o.userConfig)
        )
          o.attach();
        await o.send(args.text!);
        o.state.terminal = true;
        return result({ replied: true });
      }
      if (!o.message) throw new AgentRuntimeError('任务控制需要明确玩家指令。');
      o.authorize();
      await o.stopAction();
      o.onActionStopped();
      o.budget.flushTime();
      const command = {
        type: name.replace('_task', ''),
        goal: args.goal,
      } as TaskCommand;
      // Switching tasks within one event must never reset already charged usage.
      if (command.type === 'start') Object.assign(o.config, o.defaults);
      else Object.assign(o.config, o.userConfig);
      try {
        await o.service.commit(
          command,
          { kind: 'player', message: o.message },
          o.config,
          () => o.save(),
          o.budget,
          o.beforeNewTaskHook,
        );
      } catch (error) {
        if (error instanceof AgentRuntimeError && error.fatal) {
          o.state.persistenceFailed = true;
          o.state.terminal = true;
        }
        throw error;
      }
      const lease = o.service.lease();
      o.onTaskCommitted(lease);
      if (command.type === 'start') Object.assign(o.userConfig, o.config);
      if (['pause'].includes(command.type)) o.state.terminal = true;
      await o.observe();
      if (args.reply) await o.send(args.reply);
      return result({ task: o.memory.task.current });
    },
  }));
}
