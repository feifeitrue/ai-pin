import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

interface Notice { sequence: number; kind: string; id?: string; summary?: string; intent?: string }
interface Snapshot { sequence: number; pending: { id: string; summary: string }[]; events: Notice[]; error?: string }

/** Optional local prototype transport. Never emits the overlay's user-input events. */
export function startCodexNotifications(bindingFile: string, notify: (event: Notice, pendingCount: number) => void): () => void {
  let after = 0;
  let busy = false;
  let stopped = false;
  let current: ReturnType<typeof createConnection> | null = null;
  let currentPipe = '';
  let initialized = false;
  const poll = (): void => {
    if (busy || stopped) return;
    let pipe: string;let token:string|undefined;
    try { const binding=JSON.parse(readFileSync(bindingFile, 'utf8'));pipe=binding.pipe;token=binding.token; }
    catch { return; }
    if (typeof pipe !== 'string' || !pipe.startsWith('\\\\.\\pipe\\lolping-codex-')) return;
    if (pipe !== currentPipe) { after = 0; currentPipe = pipe; initialized = false; }
    busy = true;
    const socket = createConnection(pipe);
    current = socket;
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2500, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => { busy = false; current = null; });
    socket.on('connect', () => socket.write(JSON.stringify({ op: 'snapshot', after, token }) + '\n'));
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 256 * 1024) { socket.destroy(); return; }
      const end = data.indexOf('\n');
      if (end < 0) return;
      socket.destroy();
      try {
        const snapshot = JSON.parse(data.slice(0, end)) as Snapshot;
        if (snapshot.error || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.pending)) return;
        if (!stopped) for (const event of snapshot.events) {
          // A newly attached app must not replay old completion/save sounds.
          // Still show questions that are actually waiting for the user.
          if (!initialized && event.kind !== 'needs-input') continue;
          if (event.sequence <= after) continue;
          // A resolved old question must not flash again when the app connects late.
          if (event.kind === 'needs-input' && !snapshot.pending.some(p => p.id === event.id)) continue;
          notify(event, snapshot.pending.length);
        }
        after = snapshot.sequence;
        initialized = true;
      } catch { /* Retry on the next poll; don't crash desktop input. */ }
    });
  };
  const timer = setInterval(poll, 750);
  // Give overlay renderer pages time to subscribe before the first notification.
  const initial = setTimeout(poll, 1500);
  return () => { stopped = true; clearInterval(timer); clearTimeout(initial); current?.destroy(); };
}
