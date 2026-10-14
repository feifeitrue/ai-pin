import net from 'node:net';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

/** The OS releases this lease on exit/crash. It closes the check-then-spawn race. */
export function acquireBridgeOwner(directory) {
  const key = createHash('sha256').update(resolve(directory).toLowerCase()).digest('hex').slice(0, 24);
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\aiping-owner-${key}` : join(tmpdir(), `aiping-owner-${key}.sock`);
  return new Promise((resolveOwner, reject) => {
    const server = net.createServer(socket => socket.destroy());
    server.once('error', error => error.code === 'EADDRINUSE' ? resolveOwner(null) : reject(error));
    server.listen(path, () => resolveOwner(server));
  });
}
