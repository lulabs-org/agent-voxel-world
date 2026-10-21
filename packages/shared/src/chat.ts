import type { WorldEvent } from './world';
export type ChatRoute = { scope: 'public' | 'private'; recipients: string[] };
export type ChatData = Omit<ChatRoute, 'scope'> & {
  scope: 'public' | 'private' | 'nearby';
  name: string;
  text: string;
  kind: 'text' | 'audio';
  audioId?: string;
  durationMs?: number;
  transcriptAvailable?: boolean;
};
export type ChatEntry = WorldEvent & { data: ChatData };
export type AgentSpeechEvent = {
  id: string;
  actor: string;
  text: string;
  scope: 'public' | 'private';
  durationMs: number;
  expiresAt: number;
  browserVoice?: { voice: string; speed: number; voiceLanguage?: string };
};
export function parseChatRoute(value: unknown): ChatRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('无效消息。');
  const p = value as Record<string, unknown>;
  const scope = p.scope === undefined ? 'public' : p.scope;
  const recipients = p.recipients === undefined ? [] : p.recipients;
  if (
    (scope !== 'public' && scope !== 'private') ||
    !Array.isArray(recipients) ||
    recipients.length > 8 ||
    recipients.some(
      (id) => typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id),
    ) ||
    new Set(recipients).size !== recipients.length
  )
    throw Error('接收对象无效，最多选择 8 位。');
  if (scope === 'private' && !recipients.length)
    throw Error('私聊请先通过 @ 选择接收对象。');
  return { scope, recipients: recipients as string[] };
}
