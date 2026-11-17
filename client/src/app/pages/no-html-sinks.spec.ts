import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appDir = resolve(process.cwd(), 'src/app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('client sources', () => {
  it('never write HTML strings into the DOM or bypass the sanitiser', () => {
    const files = sourceFiles(appDir);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|bypassSecurityTrust/);
    }
  });
});
