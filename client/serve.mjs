import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Runs ng serve without a shell, so the CLIENT_HOST default works the same in cmd.exe, PowerShell and POSIX shells.
const ngCli = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
const host = process.env.CLIENT_HOST?.trim() || 'localhost';

const child = spawn(process.execPath, [ngCli, 'serve', '--host', host, '--port', '4200'], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)));
