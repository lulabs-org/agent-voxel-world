import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAgentsController } from './agents/useAgentsController';
import { useProvidersController } from './providers/useProvidersController';
import { useTaskController, useTaskEditor } from './tasks/useTaskController';
import { useConsoleFeedback } from './useConsoleFeedback';
import { useVoiceServices } from './voice/useVoiceServices';
export function useConsoleController(open: boolean, initialTab?: 'agents') {
  const [tab, setTab] = useState<'agents' | 'providers' | 'voice' | 'asr'>(
    'agents',
  );
  const body = useRef<HTMLDivElement>(null);
  const feedback = useConsoleFeedback();
  const providers = useProvidersController(open, tab, feedback);
  const taskEditor = useTaskEditor();
  const agents = useAgentsController(
    open,
    initialTab,
    providers.providers,
    providers.resetModels,
    taskEditor.resetTaskEditor,
    feedback,
  );
  const tasks = useTaskController(taskEditor, agents.setJobs, feedback);
  const voices = useVoiceServices(open, feedback.setError);
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [agents.showAgentForm, tab]);
  return {
    ...feedback,
    ...providers,
    ...agents,
    ...tasks,
    ...voices,
    tab,
    setTab,
    body,
    saveProvider: (event: FormEvent) =>
      providers.saveProvider(event, agents.providerSaved),
    removeProvider: () => providers.removeProvider(agents.providerRemoved),
  };
}
export type ConsoleController = ReturnType<typeof useConsoleController>;
