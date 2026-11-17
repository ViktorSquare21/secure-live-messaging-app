import { readdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, relative, sep } from 'node:path';
import { contentTypeFor, INDEX_PATH, responseHeaders, routeRequest, type StaticFile, type StaticSite } from './static-site';

export class MissingClientBuildError extends Error {
  constructor() {
    super('missing_client_build');
  }
}

export async function loadStaticSite(root: string): Promise<StaticSite> {
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    throw new MissingClientBuildError();
  }
  const site = new Map<string, StaticFile>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    const urlPath = '/' + relative(root, absolute).split(sep).join('/');
    site.set(urlPath, { body: await readFile(absolute), contentType: contentTypeFor(urlPath) });
  }
  if (!site.has(INDEX_PATH)) throw new MissingClientBuildError();
  return site;
}

export function createStaticHandler(site: StaticSite): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const route = routeRequest(request.method, request.url, site);
    const file =
      route.kind === 'file' ? site.get(route.path) : route.kind === 'index' ? site.get(INDEX_PATH) : undefined;
    response.writeHead(route.kind === 'method_not_allowed' ? 405 : 200, responseHeaders(route, file));
    response.end(request.method === 'HEAD' || file === undefined ? undefined : file.body);
  };
}
