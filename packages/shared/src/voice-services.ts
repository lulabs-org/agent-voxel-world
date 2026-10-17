export type VoiceServiceType = 'local' | 'browser' | 'bailian' | 'compatible';
export type VoiceServiceSettings = {
  name: string;
  type: VoiceServiceType;
  baseUrl: string;
  model: string;
  voice: string;
  speed: number;
  voiceLanguage?: string;
};
export type VoiceServiceView = VoiceServiceSettings & {
  id: string;
  capability: 'tts';
  hasApiKey: boolean;
};
export type VoiceServiceDraft = VoiceServiceSettings & { apiKey: string };
