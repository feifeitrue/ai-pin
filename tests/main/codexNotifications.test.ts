import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({pipe:'\\\\.\\pipe\\lolping-codex-one',sockets:[] as any[]}));
vi.mock('node:fs',()=>({readFileSync:()=>JSON.stringify({pipe:h.pipe})}));
vi.mock('node:net',()=>({createConnection:()=>{
 const socket=Object.assign(new EventEmitter(),{setEncoding:vi.fn(),setTimeout:vi.fn(),write:vi.fn(),destroy(){(this as unknown as EventEmitter).emit('close')}});
 h.sockets.push(socket);return socket;
}}));
import { startCodexNotifications } from '../../src/main/codexNotifications';
afterEach(()=>{vi.useRealTimers();h.sockets=[];h.pipe='\\\\.\\pipe\\lolping-codex-one'});
it('skips historical completion, preserves pending questions, deduplicates and reconnects',async()=>{
 vi.useFakeTimers();const notify=vi.fn();const stop=startCodexNotifications('binding.json',notify);
 await vi.advanceTimersByTimeAsync(750);
 h.sockets.at(-1).emit('data',JSON.stringify({sequence:3,pending:[{id:'q'}],events:[{sequence:1,kind:'completed'},{sequence:2,kind:'needs-input',id:'old'},{sequence:3,kind:'needs-input',id:'q'}]})+'\n');
 expect(notify.mock.calls.map(c=>c[0].kind)).toEqual(['needs-input']);
 await vi.advanceTimersByTimeAsync(750);
 h.sockets.at(-1).emit('data',JSON.stringify({sequence:5,pending:[],events:[{sequence:3,kind:'needs-input',id:'q'},{sequence:4,kind:'input-resolved'},{sequence:5,kind:'completed'}]})+'\n');
 expect(notify.mock.calls.map(c=>c[0].kind)).toEqual(['needs-input','input-resolved','completed']);
 await vi.advanceTimersByTimeAsync(750);h.sockets.at(-1).emit('error',Error('disconnected'));h.sockets.at(-1).destroy();
 h.pipe='\\\\.\\pipe\\lolping-codex-two';await vi.advanceTimersByTimeAsync(750);
 h.sockets.at(-1).emit('data',JSON.stringify({sequence:1,pending:[{id:'new'}],events:[{sequence:1,kind:'needs-input',id:'new'}]})+'\n');
 expect(notify).toHaveBeenLastCalledWith({sequence:1,kind:'needs-input',id:'new'},1);stop();
});
