import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  ManagedAgentView,
  ProviderView,
  VoiceServiceView,
} from '@voxel/shared';
import { consoleApi } from './api';
import { freshProvider, initialAgent } from './model';
export function useConsoleController(open: boolean, initialTab?: 'agents') {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'agents' | 'providers' | 'voice' | 'asr'>(
    'agents',
  );
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [voiceServices, setVoiceServices] = useState<VoiceServiceView[]>([]);
  const [jobs, setJobs] = useState<ManagedAgentView[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [startTaskOnCreate, setStartTaskOnCreate] = useState(false);
  const [agent, setAgent] = useState(initialAgent);
  const [editingAgent, setEditingAgent] = useState<string>();
  const [showAgentForm, setShowAgentForm] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState(freshProvider());
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [taskEditor, setTaskEditor] = useState<string>();
  const [taskGoal, setTaskGoal] = useState('');
  const modelRequest = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const jobsRevision = useRef(0);
  const selected = providers.find((p) => p.id === agent.providerId);
  const editingProvider = providers.find((p) => p.id === editing);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [showAgentForm, tab]);
  useEffect(() => {
    if (tab === 'providers') return;
    modelRequest.current?.abort();
    setLoadingModels(false);
  }, [tab]);
  const openAgentEditor = (job?: ManagedAgentView) => {
    modelRequest.current?.abort();
    setLoadingModels(false);
    setModels([]);
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
    setTaskEditor(undefined);
    setTaskGoal('');
    setError('');
    setNotice('');
  };
  const openModelServices = () => {
    setTab('providers');
    editProvider(selected ?? providers[0]);
  };
  useEffect(() => {
    if (!open) return;
    setLoadingModels(false);
    if (initialTab) {
      setTab(initialTab);
      setShowAgentForm(false);
    }
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    const abort = new AbortController();
    void consoleApi
      .listVoiceServices(abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) setVoiceServices(list);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取语音服务。');
      });
    void consoleApi
      .listProviders(abort.signal)
      .then((list) => {
        if (abort.signal.aborted) return;
        setProviders(list);
        if (list[0])
          setAgent((a) => ({
            ...a,
            providerId: a.providerId || list[0].id,
            model: a.providerId ? a.model : list[0].defaultModel,
          }));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e.message));
      });
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = jobsRevision.current;
      try {
        const list = await consoleApi.listAgents(abort.signal);
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
      modelRequest.current?.abort();
      clearTimeout(timer);
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [open, initialTab]);
  const chooseProvider = (id: string) => {
    modelRequest.current?.abort();
    setLoadingModels(false);
    setModels([]);
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
  const readModels = async (id: string) => {
    modelRequest.current?.abort();
    const abort = new AbortController();
    modelRequest.current = abort;
    setLoadingModels(true);
    setModels([]);
    setError('');
    setNotice('');
    try {
      const result = await consoleApi.listModels(id, abort.signal);
      if (abort.signal.aborted) return;
      setModels(result.models);
      setNotice(
        `连接成功，发现 ${result.models.length} 个模型。可在默认模型 ID 中选择或填写，然后保存服务。`,
      );
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoadingModels(false);
    }
  };
  const perform = async (operation: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true;
    jobsRevision.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const editProvider = (p?: ProviderView) => {
    modelRequest.current?.abort();
    setLoadingModels(false);
    setModels([]);
    setError('');
    setNotice('');
    setEditing(p?.id);
    setDraft(
      p
        ? {
            name: p.name,
            type: p.type,
            baseUrl: p.baseUrl,
            defaultModel: p.defaultModel,
            jsonMode: p.jsonMode,
            tokenField: p.tokenField,
            apiKey: '',
          }
        : freshProvider(),
    );
  };
  const saveProvider = (e: FormEvent) => {
    e.preventDefault();
    void perform(async () => {
      const saved = await consoleApi.saveProvider(draft, editing);
      setProviders(await consoleApi.listProviders());
      setEditing(saved.id);
      setDraft((d) => ({ ...d, apiKey: '' }));
      setAgent((a) =>
        !a.providerId || a.providerId === saved.id
          ? {
              ...a,
              providerId: saved.id,
              model: saved.defaultModel,
              thinking:
                editingProvider?.type === saved.type ? a.thinking : 'disabled',
            }
          : a,
      );
      setModels([]);
      setNotice('模型服务已保存。可在 Agent 玩家中选择此服务。');
    });
  };

  const removeProvider = () =>
    perform(async () => {
      if (!editing) return;
      await consoleApi.deleteProvider(editing);
      const list = await consoleApi.listProviders();
      setProviders(list);
      if (agent.providerId === editing)
        setAgent((a) => ({
          ...a,
          providerId: list[0]?.id ?? '',
          model: list[0]?.defaultModel ?? '',
        }));
      editProvider();
      setNotice('模型服务已删除。');
    });
  const saveAgent = () =>
    perform(async () => {
      if (!selected?.defaultModel.trim())
        throw new Error('请先在模型服务中配置并保存模型 ID。');
      const { goal, ...profile } = agent;
      const saved = await consoleApi.saveAgent(
        {
          ...profile,
          model: selected.defaultModel,
          ...(editingAgent
            ? {}
            : {
                goal: startTaskOnCreate ? goal : '',
                startTask: startTaskOnCreate,
              }),
          intervalMs:
            editingAgent || agent.intervalMode === 'fixed'
              ? agent.intervalMs
              : 3000,
          intervalMinMs:
            editingAgent || agent.intervalMode === 'random'
              ? agent.intervalMinMs
              : 4000,
          intervalMaxMs:
            editingAgent || agent.intervalMode === 'random'
              ? agent.intervalMaxMs
              : 8000,
        },
        editingAgent,
      );
      setJobs(await consoleApi.listAgents());
      setSelectedAgentId(saved.id);
      if (editingAgent) setAgent(saved);
      setShowAgentForm(false);
      setNotice(
        editingAgent
          ? '角色设置已保存。'
          : startTaskOnCreate
            ? '角色正在加入世界，随后开始任务。'
            : '角色正在加入世界待命，可通过私聊或 @ 交流。',
      );
    });
  const joinAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.joinAgent(job.id);
      setJobs(await consoleApi.listAgents());
      setNotice('正在加入世界待命，原任务不会自动执行。');
    });
  const resumeAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.resumeAgent(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const pauseAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.pauseAgent(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const cancelTask = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.cancelTask(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const stopAgent = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.stopAgent(job.id);
      setJobs(await consoleApi.listAgents());
    });
  const assignTask = (job: ManagedAgentView) =>
    perform(async () => {
      await consoleApi.assignTask(job.id, taskGoal);
      setJobs(await consoleApi.listAgents());
      setTaskEditor(undefined);
    });
  const toggleVoiceReplies = (job: ManagedAgentView) =>
    perform(async () => {
      const saved = await consoleApi.setVoiceReplies(job.id, !job.voiceReplies);
      if (editingAgent === job.id)
        setAgent((draft) => ({ ...draft, voiceReplies: saved.voiceReplies }));
      setJobs(await consoleApi.listAgents());
    });
  return {
    dialog,
    tab,
    setTab,
    providers,
    voiceServices,
    setVoiceServices,
    jobs,
    loadingJobs,
    selectedAgentId,
    selectAgent,
    startTaskOnCreate,
    setStartTaskOnCreate,
    openModelServices,
    agent,
    setAgent,
    editingAgent,
    showAgentForm,
    setShowAgentForm,
    body,
    editing,
    draft,
    setDraft,
    models,
    busy,
    loadingModels,
    notice,
    setNotice,
    error,
    setError,
    pollError,
    taskEditor,
    setTaskEditor,
    taskGoal,
    setTaskGoal,
    selected,
    editingProvider,
    openAgentEditor,
    chooseProvider,
    readModels,
    editProvider,
    saveProvider,
    removeProvider,
    saveAgent,
    resumeAgent,
    joinAgent,
    pauseAgent,
    cancelTask,
    stopAgent,
    assignTask,
    toggleVoiceReplies,
  };
}
export type ConsoleController = ReturnType<typeof useConsoleController>;
