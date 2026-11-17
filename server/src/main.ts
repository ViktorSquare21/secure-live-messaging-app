import { resolveServerPort, SERVER_HOST } from './config';
import { startServer } from './create-server';
import { resolveOriginPolicy } from './origin-policy';

const portResult = resolveServerPort(process.env);
if (!portResult.ok) {
  console.error('server_start_failed invalid_port');
  process.exit(1);
}

const originResult = resolveOriginPolicy(process.env);
if (!originResult.ok) {
  console.error('server_start_failed invalid_origins');
  process.exit(1);
}

const server = await startServer({ port: portResult.port, host: SERVER_HOST, originPolicy: originResult.policy });
console.log(`server_listening port=${server.port}`);

const shutdown = (): void => {
  server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
