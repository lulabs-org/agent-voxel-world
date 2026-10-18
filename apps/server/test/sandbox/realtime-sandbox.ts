import { createTestServer } from '../helpers/test-server';
// Isolated memory world; no dotenv, production storage or real voice credentials.
const server = await createTestServer({
  port: 2598,
  origin: 'http://127.0.0.1:5188',
});
console.log(`Offline memory sandbox: ${server.httpUrl} (real voice disabled)`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
