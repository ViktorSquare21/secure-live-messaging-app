import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexHtml = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');
const devIndexHtml = readFileSync(resolve(process.cwd(), 'src/index.dev.html'), 'utf8');

describe('index.html', () => {
  it('loads nothing from another host', () => {
    const references = [...indexHtml.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1] ?? '');

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:)?\/\//i);
    }
  });

  it('adds no font or icon stylesheet links', () => {
    expect(indexHtml).not.toMatch(/fonts\.googleapis|fonts\.gstatic|Material\+Icons|Material\+Symbols/i);
  });

  it('has no base element, which the CSP base-uri none would block', () => {
    expect(indexHtml).not.toMatch(/<base\b/i);
  });

  it('references its own assets by absolute path, so deep routes such as /r/<id> load them', () => {
    const references = [...indexHtml.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1] ?? '');
    for (const reference of references) {
      expect(reference.startsWith('/')).toBe(true);
    }
  });

  it('differs from the dev server index only by the base element the dev server needs', () => {
    expect(devIndexHtml.replace('  <base href="/">\n', '')).toBe(indexHtml);
  });
});
