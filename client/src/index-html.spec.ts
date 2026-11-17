import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexHtml = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');

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
});
