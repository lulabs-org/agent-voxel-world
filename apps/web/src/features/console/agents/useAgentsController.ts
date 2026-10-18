import {
  agentPermissions,
  type ManagedAgentView,
  type ProviderView,
} from '@voxel/shared';
import { useEffect, useState } from 'react';
import type { ConsoleFeedback } from '../useConsoleFeedback';
import { agentsApi } from './api';
import { initialAgent } from './model';
export function useAgentsController(
  open: boolean,
  initialTab: 'agents' | undefined,
  providers: ProviderView[],
  resetModels: () => void,
  resetTaskEditor: () => void,
  feedback: ConsoleFeedback,
) {
  const { setError, setNotice, perform, mutation, jobsRevision } = feedback;
  const [jobs, setJobs] = useState<ManagedAgentView[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [startTaskOnCreate, setStartTaskOnCreate] = useState(false);
  const [agent, setAgent] = useState(initialAgent);
  const [editingAgent, setEditingAgent] = useState<string>();
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [pollError, setPollError] = useState('');
  const selected = providers.find((p) => p.id === agent.providerId);
  useEffect(() => {
    if (providers[0])
      setAgent((a) => ({
        ...a,
        providerId: a.providerId || providers[0].id,
        model: a.providerId ? a.model : providers[0].defaultModel,
      }));
  }, [providers]);
  useEffect(() => {
    if (!open) return;
    if (initialTab) setShowAgentForm(false);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = jobsRevision.current;
      try {
        const list = await agentsApi.listAgents(abort.signal);
        if (abort.signal.aborted) return;
        if (!mutation.current && revision === jobsRevision.current) {
          setJobs(list);
          setPollError('');
          setLoadingJobs(false);
        }
      } catch {
        if (!abort.signal.aborted) {
          setPollError('无法刷新 Agent 状态，请检查世界服务连接。');
          setLoadingJobs(false);
        }
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [open, initialTab]);
  const openAgentEditor = (job?: ManagedAgentView) => {
    resetModels();
    setEditingAgent(job?.id);
    if (job) setSelectedAgentId(job.id);
    setStartTaskOnCreate(false);
    setAgent(
      job
        ? {
            ...job,
            model:
              providers.find((p) => p.id === job.providerId)?.defaultModel ??
              '',
            goal: job.task?.goal ?? job.goal,
          }
        : {
            ...initialAgent,
            providerId: providers[0]?.id ?? '',
            model: providers[0]?.defaultModel ?? '',
          },
    );
    setError('');
    setNotice('');
    setShowAgentForm(true);
  };
  const selectAgent = (id: string) => {
    setSelectedAgentId(id);
    setShowAgentForm(false);
    resetTaskEditor();
    setError('');
    setNotice('');
  };
  const chooseProvider = (id: string) => {
    resetModels();
    setError('');
    setNotice('');
    const p = providers.find((p) => p.id === id);
    setAgent((a) => ({
      ...a,
      providerId: id,
      model: p?.defaultModel ?? '',
      thinking: 'disabled',
    }));
  };
  const saveAgent = () =>
    perform(async () => {
      if (!selected?.defaultModel.trim())
        throw new Error('请先在模型服务中配置并保存模型 ID。');
      const {
        goal,
        timeoutMs,
        maxTokens,
        thinking,
        reasoningEffort,
        maxTurns,
        tokenBudget,
        taskTimeoutMs,
        intervalMode,
        intervalMs,
        intervalMinMs,
        intervalMaxMs,
        ...profile
      } = agent;
      const saved = await agentsApi.saveAgent(
        {
          ...profile,
          model: selected.defaultModel,
          ...(editingAgent
            ? {}
            : {
                maxTurns,
                tokenBudget,
                taskTimeoutMs,
                intervalMode,
                intervalMs: intervalMode === 'fixed' ? intervalMs : 3000,
                intervalMinMs: intervalMode === 'random' ? intervalMinMs : 4000,
                intervalMaxMs: intervalMode === 'random' ? intervalMaxMs : 8000,
                goal: startTaskOnCreate ? goal : '',
                startTask: startTaskOnCreate,
                taskTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }),
        },
        editingAgent,
      );
      setJobs(await agentsApi.listAgents());
      setSelectedAgentId(saved.id);
      if (editingAgent) setAgent(saved);
      setShowAgentForm(false);
      setNotice(
        editingAgent
          ? '角色设置已保存。'
          : startTaskOnCreate
            ? '角色正在加入世界，随后开始任务。'
            : agentPermissions(agent).chat
              ? '角色正在加入世界待命，可通过私聊或 @ 交流。'
              : '角色正在加入世界待命。发送聊天已关闭，可在控制台安排任务和查看进展。',
      );
    });
  const joinAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await agentsApi.joinAgent(job.id);
      setJobs(await agentsApi.listAgents());
      setNotice('正在加入世界待命，原任务不会自动执行。');
    });
  const stopAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await agentsApi.stopAgent(job.id);
      setJobs(await agentsApi.listAgents());
    });
  const deleteAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await agentsApi.deleteAgent(job.id);
      setJobs((list) => list.filter((item) => item.id !== job.id));
      setSelectedAgentId(undefined);
      setEditingAgent(undefined);
      setShowAgentForm(false);
      resetTaskEditor();
      setNotice(`已删除 ${job.name}。`);
    });
  const toggleVoiceReplies = (job: ManagedAgentView) =>
    perform(async () => {
      const saved = await agentsApi.setVoiceReplies(job.id, !job.voiceReplies);
      if (editingAgent === job.id)
        setAgent((draft) => ({ ...draft, voiceReplies: saved.voiceReplies }));
      setJobs(await agentsApi.listAgents());
    });
  const providerSaved = (saved: ProviderView, previous?: ProviderView) =>
    setAgent((a) =>
      !a.providerId || a.providerId === saved.id
        ? {
            ...a,
            providerId: saved.id,
            model: saved.defaultModel,
            thinking: previous?.type === saved.type ? a.thinking : 'disabled',
          }
        : a,
    );
  const providerRemoved = (id: string, list: ProviderView[]) =>
    setAgent((a) =>
      a.providerId === id
        ? {
            ...a,
            providerId: list[0]?.id ?? '',
            model: list[0]?.defaultModel ?? '',
          }
        : a,
    );
  return {
    jobs,
    setJobs,
    loadingJobs,
    selectedAgentId,
    selectAgent,
    startTaskOnCreate,
    setStartTaskOnCreate,
    agent,
    setAgent,
    editingAgent,
    showAgentForm,
    setShowAgentForm,
    pollError,
    selected,
    openAgentEditor,
    chooseProvider,
    saveAgent,
    joinAgent,
    stopAgent,
    deleteAgent,
    toggleVoiceReplies,
    providerSaved,
    providerRemoved,
  };
}
