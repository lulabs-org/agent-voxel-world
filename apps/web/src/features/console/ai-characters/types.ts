import type { AICharacterFormProps } from './editor/types';
import type { AICharactersController } from './useAICharactersController';
export type AICharactersProps = Omit<
  AICharacterFormProps,
  'disabled' | 'capacityFull' | 'leaveDisabled'
> &
  Pick<
    AICharactersController,
    | 'loadingJobs'
    | 'pollError'
    | 'selectedAgentId'
    | 'showAgentForm'
    | 'openAgentEditor'
    | 'refreshJobs'
  > & { active: boolean };
