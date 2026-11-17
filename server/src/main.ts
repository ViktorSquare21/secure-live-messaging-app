import { resolveServerPort, SERVER_HOST } from './config';
import { startServer } from './create-server';

const portResult = resolveServerPort(process.env);
if (!portResult.ok) {
  console.error('server_start_failed invalid_port');
  process.exit(1);
}

const server = await startServer(portResult.port, SERVER_HOST);
console.log(`server_listening port=${server.port}`);

const shutdown = (): void => {
  server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
