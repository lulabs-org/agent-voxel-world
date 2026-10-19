import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAgentsController } from './agents/useAgentsController';
import { useProvidersController } from './providers/useProvidersController';
import { useConsoleFeedback } from './useConsoleFeedback';
import { useVoiceServices } from './voice/useVoiceServices';
export function useConsoleController(open: boolean, initialTab?: 'agents') {
  const [tab, setTab] = useState<
    'agents' | 'plans' | 'providers' | 'voice' | 'asr'
  >('agents');
  const body = useRef<HTMLDivElement>(null);
  const feedback = useConsoleFeedback();
  const providers = useProvidersController(open, tab, feedback);
  const agents = useAgentsController(
    open,
    initialTab,
    providers.providers,
    providers.resetModels,
    feedback,
  );
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
