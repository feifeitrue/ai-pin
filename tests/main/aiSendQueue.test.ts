import { it, expect } from 'vitest';
import { AiSendQueue } from '../../src/main/aiSendQueue';
const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

it('captures every burst immediately, delivers FIFO even if capture completion is reversed', async () => {
  const captured: number[] = [], sent: string[] = [];
  const shots = [deferred<string>(), deferred<string>(), deferred<string>()];
  const firstSend = deferred<void>();
  const q = new AiSendQueue<number,string>({ capture: async id => { captured.push(id); return shots[id].promise; },
    send: async (id, shot) => { sent.push(`${id}:${shot}`); if(id===0) await firstSend.promise; }, failed: () => { throw Error('unexpected failure'); } });
  [0,1,2].forEach(id=>q.enqueue(id));
  await Promise.resolve();expect(captured).toEqual([0,1,2]);expect(q.pending).toBe(3);
  shots[2].resolve('C');shots[1].resolve('B');shots[0].resolve('A');
  await new Promise(resolve=>setTimeout(resolve,0));expect(sent).toEqual(['0:A']);
  firstSend.resolve();await q.whenIdle();expect(sent).toEqual(['0:A','1:B','2:C']);expect(q.pending).toBe(0);
});

it('a failed capture or send is reported once without dropping subsequent jobs', async () => {
  const sent: number[] = [], failures: Array<[number,boolean]> = [];
  const q = new AiSendQueue<number,string>({capture: async id=>{if(id===1)throw Error('capture failed');return `shot${id}`;},
    send: async id=>{sent.push(id);if(id===0)throw Error('send uncertain');}, failed:(id,_error,shot)=>failures.push([id,shot!==undefined])});
  [0,1,2].forEach(id=>q.enqueue(id));await q.whenIdle();expect(sent).toEqual([0,2]);expect(failures).toEqual([[0,true],[1,false]]);expect(q.pending).toBe(0);
  q.enqueue(3);await q.whenIdle();expect(sent).toEqual([0,2,3]);
});
