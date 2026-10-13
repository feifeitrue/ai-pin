import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { resolveInside } from './safePath';

export const APP_SCHEME = 'lolping';

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

const notFound = (): Response => new Response('Not found', { status: 404 });

export function serveAppScheme(opts: { rendererRoot: string | null }): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host === 'app' && opts.rendererRoot) {
      const file = resolveInside(opts.rendererRoot, url.pathname);
      if (file) return net.fetch(pathToFileURL(file).toString());
    }
    return notFound();
  });
}
