import type { ManagedAgentView } from '@voxel/shared';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { agentsApi } from '../agents/api';
import type { ConsoleFeedback } from '../useConsoleFeedback';
import { tasksApi } from './api';
import type { TaskBudget } from './model';
export function useTaskEditor() {
  const [taskEditor, setTaskEditor] = useState<string>();
  const [taskGoal, setTaskGoal] = useState('');
  return {
    taskEditor,
    setTaskEditor,
    taskGoal,
    setTaskGoal,
    resetTaskEditor: () => {
      setTaskEditor(undefined);
      setTaskGoal('');
    },
  };
}
export function useTaskController(
  editor: ReturnType<typeof useTaskEditor>,
  setJobs: Dispatch<SetStateAction<ManagedAgentView[]>>,
  feedback: ConsoleFeedback,
) {
  const { taskGoal, setTaskEditor } = editor;
  const { perform } = feedback;
  const resumeAgent = (job: ManagedAgentView, limits?: TaskBudget) =>
    perform(async () => {
      await tasksApi.resumeAgent(job.id, limits);
      setJobs(await agentsApi.listAgents());
    });
  const pauseAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await tasksApi.pauseAgent(job.id);
      setJobs(await agentsApi.listAgents());
    });
  const cancelTask = (job: ManagedAgentView) =>
    perform(async () => {
      await tasksApi.cancelTask(job.id);
      setJobs(await agentsApi.listAgents());
    });
  const assignTask = (job: ManagedAgentView, limits?: TaskBudget) =>
    perform(async () => {
      await tasksApi.assignTask(job.id, taskGoal, limits);
      setJobs(await agentsApi.listAgents());
      setTaskEditor(undefined);
    });
  return { ...editor, resumeAgent, pauseAgent, cancelTask, assignTask };
}
