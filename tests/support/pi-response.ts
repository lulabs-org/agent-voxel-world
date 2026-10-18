/** OpenAI SSE fixture: exercise Pi's actual provider adapter and tool parsing. */
export function toolResponse(
  tools: { name: string; arguments: unknown }[],
  tokens = 100,
) {
  const delta = {
    role: 'assistant',
    tool_calls: tools.map((t, index) => ({
      index,
      id: `call-${index}`,
      type: 'function',
      function: { name: t.name, arguments: JSON.stringify(t.arguments) },
    })),
  };
  const chunks = [
    { id: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] },
    {
      id: 'fixture',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: {
        prompt_tokens: tokens - 10,
        completion_tokens: 10,
        total_tokens: tokens,
      },
    },
  ];
  return new Response(
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') +
      'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
