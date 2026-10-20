/** Keep Pi's tool loop while using Ollama's native context/thinking controls. */
export async function ollamaCompletion(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  request: typeof fetch,
  contextWindow: number,
  thinking: boolean,
) {
  const body = JSON.parse(String(init.body));
  const names = new Map<string, string>();
  const messages = body.messages.map((message: any) => {
    for (const call of message.tool_calls ?? [])
      names.set(call.id, call.function.name);
    return {
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : (message.content ?? [])
              .map((part: any) => part.text ?? '')
              .join(''),
      ...(message.tool_calls && {
        tool_calls: message.tool_calls.map((call: any) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.function.name,
            arguments: JSON.parse(call.function.arguments),
          },
        })),
      }),
      ...(message.role === 'tool' && {
        tool_name: message.name ?? names.get(message.tool_call_id),
      }),
    };
  });
  const url = new URL(String(input));
  url.pathname = url.pathname.replace(
    /\/(?:v1\/)?chat\/completions$/,
    '/api/chat',
  );
  const response = await request(url, {
    ...init,
    redirect: 'error',
    body: JSON.stringify({
      model: body.model,
      messages,
      tools: body.tools,
      think: thinking,
      // Pi consumes OpenAI events below. A bounded single response also keeps
      // partially generated tool arguments from reaching the executor.
      stream: false,
      options: {
        num_ctx: contextWindow,
        num_predict: body.max_tokens ?? body.max_completion_tokens,
        ...(body.temperature !== undefined && {
          temperature: body.temperature,
        }),
      },
    }),
  });
  if (!response.ok) return response;
  const value = await response.json();
  if (value.error || !value.done || !value.message)
    throw Error('Incomplete Ollama response');
  const calls = value.message.tool_calls ?? [];
  const id = `ollama-${crypto.randomUUID()}`;
  const delta = {
    role: 'assistant',
    content: value.message.content ?? '',
    reasoning_content: value.message.thinking ?? '',
    tool_calls: calls.map((call: any, index: number) => ({
      index,
      id: `${id}-${index}`,
      type: 'function',
      function: {
        name: call.function.name,
        arguments: JSON.stringify(call.function.arguments),
      },
    })),
  };
  const chunks = [
    { id, choices: [{ index: 0, delta, finish_reason: null }] },
    {
      id,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason:
            value.done_reason === 'length'
              ? 'length'
              : calls.length
                ? 'tool_calls'
                : 'stop',
        },
      ],
      usage: {
        prompt_tokens: value.prompt_eval_count ?? 0,
        completion_tokens: value.eval_count ?? 0,
        total_tokens: (value.prompt_eval_count ?? 0) + (value.eval_count ?? 0),
      },
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
      'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
