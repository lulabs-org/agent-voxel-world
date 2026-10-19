import { loadEnvironment } from './config';
import { createServer } from './server';

try {
  const config = loadEnvironment();
  const server = await createServer({ config });
  const url = (await server.listen()).replace(/^ws:/, 'http:');
  console.log(
    config.gateway.token
      ? 'Agent Gateway 使用 AGENT_GATEWAY_TOKEN。'
      : `Agent Gateway 令牌文件 ${config.gateway.tokenFile}`,
  );
  console.log(`Voxel server ${url}`);
  console.log(`Swagger UI   ${url}/api-docs`);
  console.log(`OpenAPI JSON ${url}/api-docs.json`);
  const stop = () => {
    void server
      .close()
      .then(() => {
        process.exitCode = 0;
      })
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
