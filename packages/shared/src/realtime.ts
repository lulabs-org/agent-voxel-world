import type { Edit } from './world';
export type RealtimeEvent = {
  session: string;
  request?: string;
  kind:
    | 'ready'
    | 'subtitle'
    | 'audio'
    | 'proposal'
    | 'done'
    | 'closed'
    | 'error';
  demo: boolean;
  text?: string;
  audio?: string;
  proposal?: { id: string; edit: Edit };
};
