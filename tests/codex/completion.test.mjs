import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startAttentionMonitor} from '../../src/main/codex/attention.mjs';import {NotificationState} from '../../src/main/codex/state.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const line=(turn,time)=>JSON.stringify({type:'event_msg',timestamp:time,payload:{type:'task_complete',turn_id:turn}})+'\n';
test('real transcript completion is delivered once without hooks; historical completions stay silent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ai-pin-events-'));const file=join(dir,'user.jsonl');await writeFile(file,line('old','2020-01-01T00:00:00Z'));
 const state=new NotificationState();let dirty=true;
 const monitor=startAttentionMonitor({threadIds:[],state,log:()=>{},discover:async()=>{if(!dirty)return [];dirty=false;return [{threadId:'main',file}];},readStatus:async()=>({type:'idle'})});
 try{
  await sleep(850);assert.equal(state.events.length,0);
  await appendFile(file,line('new',new Date().toISOString()));dirty=true;
  await sleep(800);assert.deepEqual(state.events.map(e=>e.turnId),['new']);
  await appendFile(file,line('new',new Date().toISOString()));dirty=true;
  await sleep(800);assert.equal(state.events.length,1);
 }finally{monitor.stop();}
});
test('first connection ignores abandoned historical questions but accepts newly arriving ones',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ai-pin-questions-'));const file=join(dir,'user.jsonl');
 const question=(id,t)=>[{type:'response_item',timestamp:t,payload:{type:'function_call',name:'request_user_input_async',call_id:id,arguments:JSON.stringify({questions:[{title:'question'}]})}},{type:'response_item',timestamp:t,payload:{type:'function_call_output',call_id:id,output:'{"accepted":true}'}}].map(r=>JSON.stringify(r)).join('\n')+'\n';
 await writeFile(file,question('old','2020-01-01T00:00:00Z'));const state=new NotificationState();let dirty=true;
 const monitor=startAttentionMonitor({threadIds:[],state,log:()=>{},discover:async()=>{if(!dirty)return [];dirty=false;return [{threadId:'main',file}];},readStatus:async()=>({type:'active',activeFlags:[]})});
 try{await sleep(850);assert.equal(state.pending.size,0);await appendFile(file,question('new',new Date().toISOString()));dirty=true;await sleep(800);assert.equal(state.pending.size,1);assert.match([...state.pending.keys()][0],/question:new$/);}
 finally{monitor.stop();}
});
