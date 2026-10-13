import net from 'node:net';
import { readdir } from 'node:fs/promises';

export function rpc(pipe, request, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    let data = Buffer.alloc(0);
    const fail = error => { socket.destroy(); reject(error); };
    socket.setTimeout(timeout, () => fail(new Error('Codex response timed out; delivery may be uncertain')));
    socket.on('error', fail);
    socket.on('end', () => fail(new Error('Codex closed the connection before acknowledging')));
    socket.on('connect', () => {
      const bytes = Buffer.from(JSON.stringify(request));
      const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
      socket.write(Buffer.concat([header, bytes]));
    });
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 32 * 1024 * 1024) return fail(new Error('Codex response too large'));
      if (data.length < 4 || data.length < 4 + data.readUInt32LE(0)) return;
      socket.destroy();
      try {
        const result = JSON.parse(data.subarray(4, 4 + data.readUInt32LE(0)).toString());
        if (result.error) reject(new Error(result.error.message)); else resolve(result);
      } catch (error) { reject(error); }
    });
  });
}

export function isAppTools(response) {
  return response?.result?.tools?.some(t => t.namespace === 'codex_app' && t.name === 'send_message_to_thread') === true;
}

// Discovery is read-only. A mutating send is never retried on another endpoint.
export async function findAppTools(preferred, probe = async pipe => isAppTools(await rpc(pipe,
  { id: 1, jsonrpc: '2.0', method: 'tools/list', params: { threadStartKind: 'all' } }, 1500)),
  list = async () => (await readdir('\\\\.\\pipe\\')).filter(n => n.startsWith('codex-browser-use-')).map(n => `\\\\.\\pipe\\${n}`)) {
  if (preferred && await probe(preferred).catch(() => false)) return preferred;
  const candidates = (await list()).filter(p => p !== preferred);
  const checked = await Promise.allSettled(candidates.map(async pipe => await probe(pipe) ? pipe : null));
  const found = checked.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);
  if (found.length !== 1) throw new Error(found.length ? 'Multiple Codex app endpoints; rebind from the intended app' : 'Codex desktop message endpoint unavailable');
  return found[0];
}
