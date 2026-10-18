/** Deployment settings only: clients cannot choose internal service addresses. */
export function speechEndpoint(engine: 'whisper' | 'piper') {
  const keys =
    engine === 'whisper'
      ? ['WHISPER_API_URL', 'SPEECH_API_URL']
      : ['PIPER_API_URL', 'SPEECH_API_URL', 'WHISPER_API_URL'];
  return (
    keys.map((key) => process.env[key]?.trim()).find(Boolean) ||
    'http://127.0.0.1:8000/v1'
  ).replace(/\/+$/, '');
}
