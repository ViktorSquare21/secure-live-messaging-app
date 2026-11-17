import { fileURLToPath } from 'node:url';
import { isProductionMode, resolveServerHost, resolveServerPort } from './config';
import { startServer } from './create-server';
import { resolveOriginPolicy } from './origin-policy';
import { loadStaticSite } from './static-files';
import type { StaticSite } from './static-site';

const CLIENT_BUILD_DIR = fileURLToPath(new URL('../../client/dist/client/browser', import.meta.url));

const production = isProductionMode(process.argv.slice(2), process.env);

const portResult = resolveServerPort(process.env);
if (!portResult.ok) {
  console.error('server_start_failed invalid_port');
  process.exit(1);
}

const originResult = resolveOriginPolicy(process.env, production);
if (!originResult.ok) {
  console.error('server_start_failed invalid_origins');
  process.exit(1);
}

let staticSite: StaticSite | undefined;
if (production) {
  try {
    staticSite = await loadStaticSite(CLIENT_BUILD_DIR);
  } catch {
    console.error('server_start_failed missing_client_build');
    process.exit(1);
  }
}

const server = await startServer({
  port: portResult.port,
  host: resolveServerHost(process.env),
  originPolicy: originResult.policy,
  staticSite,
});
console.log(`server_listening port=${server.port} static=${staticSite === undefined ? 'off' : 'on'}`);

const shutdown = (): void => {
  server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
