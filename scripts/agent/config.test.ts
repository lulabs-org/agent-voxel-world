import { describe, expect, it } from 'vitest';
import { agentConfig } from './config';

describe('CLI environment configuration', () => {
  it('requires credentials and bounds the inference budget', () => {
    expect(() => agentConfig({})).toThrow('DEEPSEEK_API_KEY');
    expect(agentConfig({ DEEPSEEK_API_KEY: 'fixture' })).toMatchObject({
      model: 'deepseek-flash',
      maxTurns: 100,
      allowEdits: false,
    });
    for (const env of [
      { AGENT_MAX_TURNS: '0' },
      { AGENT_MAX_TURNS: '1001' },
      { AGENT_INTERVAL_MS: '10' },
      { AGENT_ALLOW_EDITS: 'yes' },
    ])
      expect(() => agentConfig({ DEEPSEEK_API_KEY: 'key', ...env })).toThrow();
  });
  it('supports explicit CLI scheduling settings while preserving finite defaults', () => {
    expect(agentConfig({ DEEPSEEK_API_KEY: 'fixture' })).toMatchObject({
      continuous: false,
      intervalMode: 'fixed',
    });
    expect(
      agentConfig({
        DEEPSEEK_API_KEY: 'fixture',
        AGENT_CONTINUOUS: 'true',
        AGENT_INTERVAL_MODE: 'random',
        AGENT_INTERVAL_MIN_MS: '4000',
        AGENT_INTERVAL_MAX_MS: '8000',
      }),
    ).toMatchObject({
      continuous: true,
      intervalMode: 'random',
      intervalMinMs: 4000,
      intervalMaxMs: 8000,
    });
    for (const env of [
      { AGENT_CONTINUOUS: 'yes' },
      { AGENT_INTERVAL_MODE: 'bad' },
      { AGENT_INTERVAL_MIN_MS: '9000', AGENT_INTERVAL_MAX_MS: '4000' },
      { AGENT_INTERVAL_MIN_MS: '0' },
    ])
      expect(() =>
        agentConfig({ DEEPSEEK_API_KEY: 'fixture', ...env }),
      ).toThrow();
  });
  it('preserves Agent overrides and DeepSeek fallback settings', () => {
    expect(
      agentConfig({
        DEEPSEEK_API_KEY: 'fallback',
        DEEPSEEK_MODEL: 'fallback-model',
        DEEPSEEK_THINKING: 'enabled',
        DEEPSEEK_REASONING_EFFORT: 'high',
      }),
    ).toMatchObject({
      apiKey: 'fallback',
      model: 'fallback-model',
      thinking: 'enabled',
      reasoningEffort: 'high',
      maxTokens: 4096,
    });
    expect(
      agentConfig({
        DEEPSEEK_API_KEY: 'fallback',
        AGENT_API_KEY: ' override ',
        DEEPSEEK_MODEL: 'fallback-model',
        AGENT_MODEL: 'override-model',
        DEEPSEEK_MAX_TOKENS: '4096',
        AGENT_MAX_TOKENS: '1024',
        DEEPSEEK_TIMEOUT_MS: '60000',
        AGENT_TIMEOUT_MS: '5000',
      }),
    ).toMatchObject({
      apiKey: 'override',
      model: 'override-model',
      maxTokens: 1024,
      timeoutMs: 5000,
    });
  });
});
