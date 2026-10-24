import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { stream } from '@earendil-works/pi-ai/api/openai-completions';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AgentConfig, ModelEndpoint } from '../../contracts/config';
import { AgentRuntimeError } from '../../contracts/errors';
import { mergeSignals, withDeadline } from '../../kernel/abort';
import { ollamaCompletion } from './ollama';
import { createModel } from './pi';
import type { RequestAccounting } from './port';

/** No shared auth store, hidden retries, redirects, or raw provider errors in transcripts. */
export function createModelStream(
  config: AgentConfig,
  endpoint: ModelEndpoint,
  budget: RequestAccounting,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  reserve: () => Promise<void> = async () => {},
): StreamFn {
  return (_model, context, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      let counted = false,
        settled = false,
        status = 0;
      const deadline = withDeadline(
        mergeSignals(signal, options?.signal),
        Math.min(config.timeoutMs, budget.remainingMs),
        'model_timeout',
      );
      const combined = deadline.signal;
      const model = createModel(config, endpoint);
      const estimate =
        Math.ceil(JSON.stringify(context).length / 2) + config.maxTokens;
      const empty = (): AssistantMessage => ({
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'error',
        timestamp: Date.now(),
      });
      try {
        combined.throwIfAborted();
        const maxTokens = budget.begin();
        counted = true;
        await reserve();
        combined.throwIfAborted();
        const source = stream(model, context, {
          apiKey: config.apiKey || 'ollama',
          signal: combined,
          maxTokens,
          maxRetries: 0,
          toolChoice: 'required',
          timeoutMs: config.timeoutMs,
          cacheRetention: 'none',
          fetch: async (url, init) => {
            const response =
              endpoint.type === 'ollama'
                ? await ollamaCompletion(
                    url,
                    init ?? {},
                    request,
                    model.contextWindow,
                    config.thinking === 'enabled',
                  )
                : await request(url, { ...init, redirect: 'error' });
            status = response.status;
            return response;
          },
          onPayload: (payload) => {
            const body = payload as Record<string, unknown>;
            if (endpoint.type === 'deepseek') {
              body.thinking = { type: config.thinking };
              if (config.thinking === 'enabled')
                body.reasoning_effort = config.reasoningEffort;
              else delete body.reasoning_effort;
            }
            return body;
          },
        });
        for await (const event of source) {
          if (event.type === 'done' || event.type === 'error') {
            const message = event.type === 'done' ? event.message : event.error;
            const known = message.usage.totalTokens > 0;
            budget.finish(known ? message.usage.totalTokens : estimate, !known);
            settled = true;
            if (event.type === 'error' || combined.aborted) {
              const reason = signal.aborted
                ? 'Agent 已停止。'
                : deadline.expired
                  ? '模型请求超时，已停止本次处理。'
                  : status >= 400
                    ? `模型服务 HTTP ${status}，请检查模型、工具调用支持及凭据。`
                    : '模型请求失败，请检查服务及工具调用支持。';
              const safe = {
                ...empty(),
                stopReason: signal.aborted
                  ? ('aborted' as const)
                  : ('error' as const),
                errorMessage: reason,
              };
              output.push({
                type: 'error',
                reason: safe.stopReason,
                error: safe,
              });
            } else output.push(event);
          } else if (!combined.aborted) output.push(event);
        }
      } catch (error) {
        if (counted && !settled) budget.finish(estimate, true);
        const message = {
          ...empty(),
          errorMessage:
            error instanceof AgentRuntimeError
              ? error.message
              : signal.aborted
                ? 'Agent 已停止。'
                : '模型请求失败，已停止本次处理。',
        };
        output.push({ type: 'error', reason: 'error', error: message });
      } finally {
        deadline.clear();
        output.end();
      }
    })();
    return output;
  };
}
