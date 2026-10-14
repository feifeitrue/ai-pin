import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startAttentionMonitor} from '../../src/main/codex/attention.mjs';
import {NotificationState} from '../../src/main/codex/state.mjs';
import {createStatusReader} from '../../src/main/codex/status-reader.mjs';
import {acquireBridgeOwner} from '../../src/main/codex/bridge-owner.mjs';

test('unloaded chats stop polling, retain offsets and resume completion notifications',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aiping-poll-')),file=join(dir,'thread.jsonl');
 await writeFile(file,'');let dirty=true,reads=0,clock=0;
 const state=new NotificationState();
 const monitor=startAttentionMonitor({threadIds:[],state,log:()=>{},automatic:false,now:()=>clock,
  discover:async()=>{const out=dirty?[{threadId:'old-chat',file}]:[];dirty=false;return out;},
  readStatus:async()=>{reads++;return {type:'notLoaded'};}});
 try{
  await monitor.readTranscripts();await monitor.pollStatus();assert.equal(reads,1);
  for(let i=0;i<20;i++){clock+=5000;await monitor.readTranscripts();await monitor.pollStatus();}
  assert.equal(reads,1);
  await appendFile(file,JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'task_complete',turn_id:'finished'}})+'\n');
  dirty=true;await monitor.readTranscripts();await monitor.pollStatus();
  assert.equal(reads,2);assert.equal(state.events.filter(e=>e.kind==='completed').length,1);
  dirty=true;await monitor.readTranscripts();assert.equal(state.events.length,1);
 }finally{monitor.stop();}
});

test('many active chats have bounded, fair polling',async()=>{
 let clock=0,active=0,maximum=0;const reads=[];const state=new NotificationState();
 const ids=Array.from({length:30},(_,i)=>`chat-${i}`);
 const monitor=startAttentionMonitor({threadIds:ids,state,log:()=>{},automatic:false,now:()=>clock,
  discover:async()=>[{threadId:'chat-0'}],readStatus:async id=>{
   reads.push({id,at:clock});active++;maximum=Math.max(maximum,active);await new Promise(r=>setImmediate(r));active--;
   if(id==='chat-0')throw Error('timeout');return {type:'active',activeFlags:[]};}});
 try{
  for(let i=0;i<16;i++){await monitor.pollStatus();clock+=2500;}
  assert.equal(maximum,2);assert.equal(new Set(reads.map(r=>r.id)).size,30);
  assert.equal(reads.length,32);assert.equal(monitor.health.statusFailures,2);
 }finally{monitor.stop();}
});

test('transcript activity does not cancel the backoff of a failing status endpoint',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aiping-backoff-')),file=join(dir,'thread.jsonl');
 await writeFile(file,'');let clock=0,reads=0;
 const monitor=startAttentionMonitor({threadIds:[],state:new NotificationState(),log:()=>{},automatic:false,now:()=>clock,
  discover:async()=>[{threadId:'busy',file}],readStatus:async()=>{reads++;throw Error('offline');}});
 try{
  await monitor.readTranscripts();await monitor.pollStatus();assert.equal(reads,1);
  clock=1000;await monitor.readTranscripts();await monitor.pollStatus();assert.equal(reads,1);
  clock=5000;await monitor.pollStatus();assert.equal(reads,2);
  clock=6000;await monitor.readTranscripts();await monitor.pollStatus();assert.equal(reads,2);
  clock=15000;await monitor.pollStatus();assert.equal(reads,3);
 }finally{monitor.stop();}
});

test('summaries avoid reading cold threads, share one request and still probe old unlisted active chats',async()=>{
 let clock=0,lists=0,full=0;
 const reader=createStatusReader(async(tool,args)=>{
  if(tool==='list_threads'){lists++;await new Promise(r=>setImmediate(r));return {threads:[{id:'cold',kind:'codex',hostId:'local',status:'notLoaded'},{id:'busy',kind:'codex',hostId:'local',status:'active'}]};}
  full++;return {thread:{status:{type:'active',activeFlags:['waitingOnApproval']}}};
 },{now:()=>clock});
 const values=await Promise.all([reader.readStatus('cold'),reader.readStatus('busy'),reader.readStatus('older-than-list')]);
 assert.equal(lists,1);assert.equal(full,2);assert.equal(values[0].type,'notLoaded');assert.equal(values[2].activeFlags[0],'waitingOnApproval');
 await reader.readStatus('cold');assert.equal(lists,1);assert.equal(full,2);
 clock=11000;await reader.readStatus('cold');assert.equal(lists,2);
});

test('failed summary discovery is cooled down rather than retried by every chat',async()=>{
 let reads=0;const reader=createStatusReader(async()=>{reads++;throw Error('Codex unavailable');});
 for(let i=0;i<30;i++)await assert.rejects(reader.readStatus(`thread-${i}`));
 assert.equal(reads,1);
});

test('only one bridge owns a profile, and ownership is released on close',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aiping-owner-'));
 const one=await acquireBridgeOwner(dir);assert.ok(one);
 try{assert.equal(await acquireBridgeOwner(dir),null);}finally{await new Promise(r=>one.close(r));}
 const next=await acquireBridgeOwner(dir);assert.ok(next);await new Promise(r=>next.close(r));
});
