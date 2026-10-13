import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
vi.mock('electron',()=>({app:{}}));
import {readCodexBinding} from '../../src/main/codexConnection';
import {sendImageToCodex} from '../../src/main/codexSend';

it('uses the queued target and authenticated pipe snapshot after the binding file changes',async()=>{
 const pipe=`\\\\.\\pipe\\lolping-codex-${randomUUID()}`,requests:any[]=[];
 const server=createServer(s=>{s.on('data',data=>{requests.push(JSON.parse(data.toString()));s.end(JSON.stringify({threadId:'A'})+'\n');});});
 await new Promise<void>(r=>server.listen(pipe,r));
 try{
  const file=join(mkdtempSync(join(tmpdir(),'ai-pin-send-')),'binding.json');
  writeFileSync(file,JSON.stringify({pipe,token:'test-secret',threadId:'A'}));const queued=readCodexBinding(file);
  writeFileSync(file,JSON.stringify({pipe:'\\\\.\\pipe\\lolping-codex-other',threadId:'B'}));
  await sendImageToCodex(queued,'screen.png','focus');
  expect(requests).toEqual([{op:'image',path:'screen.png',instruction:'focus',threadId:'A',token:'test-secret'}]);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
it('does not retry an ambiguous delivery',async()=>{
 const pipe=`\\\\.\\pipe\\lolping-codex-${randomUUID()}`;let requests=0;
 const server=createServer(s=>s.on('data',()=>{requests++;s.end();}));
 await new Promise<void>(r=>server.listen(pipe,r));
 try{await expect(sendImageToCodex({pipe,threadId:'A'},'screen.png','focus')).rejects.toThrow('未确认');expect(requests).toBe(1);}
 finally{await new Promise<void>(r=>server.close(()=>r()));}
});
