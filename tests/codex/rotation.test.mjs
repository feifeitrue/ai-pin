import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startAttentionMonitor} from '../../src/main/codex/attention.mjs';
import {NotificationState} from '../../src/main/codex/state.mjs';

const row=(type,payload,time=Date.now()+1000)=>JSON.stringify({type,payload,timestamp:new Date(time).toISOString()})+'\n';
const complete=(id,time)=>row('event_msg',{type:'task_complete',turn_id:id},time);
const call=(id,time)=>row('response_item',{type:'function_call',name:'request_user_input_async',call_id:id,arguments:JSON.stringify({questions:[{title:'question'}]})},time);
const accept=(id,time)=>row('response_item',{type:'function_call_output',call_id:id,output:'{"accepted":true}'},time);
const reply=(id,time)=>row('response_item',{type:'message',role:'user',content:[{text:`<send_user_message_question_reply>${JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',id,0]),answer:'yes'}])}</send_user_message_question_reply>`}]},time);
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'ai-ping-rotation-')),old=join(dir,'old.jsonl'),next=join(dir,'next.jsonl');
 await writeFile(old,'');await writeFile(next,'');let found=[];
 const state=new NotificationState();
 const monitor=startAttentionMonitor({threadIds:[],state,readStatus:async()=>({type:'idle'}),log:()=>{},automatic:false,
  discover:async()=>{const current=found;found=[];return current;}});
 return {old,next,state,monitor,async scan(...files){found=files.map(file=>({threadId:'chat',file}));await monitor.readTranscripts();},async dispose(){monitor.stop();await rm(dir,{recursive:true,force:true});}};
}
test('rotation keeps both tails alive and deduplicates completion across files',async()=>{
 const f=await fixture();try{
  await writeFile(f.old,complete('history',0));await f.scan(f.old);assert.equal(f.state.events.length,0);
  await appendFile(f.next,complete('new'));await f.scan(f.next);
  assert.deepEqual(f.state.events.map(e=>e.turnId),['new']);
  await appendFile(f.old,complete('late-old')+complete('new'));await f.scan(f.old);
  assert.deepEqual(f.state.events.map(e=>e.turnId),['new','late-old']);
  await appendFile(f.next,complete('copied-history',0));await f.scan(f.next);
  assert.equal(f.state.events.length,2,'copying old records into a primed file must not replay them');
 }finally{await f.dispose();}
});
test('cross-file question and answer use event order, not file discovery order',async()=>{
 const f=await fixture();try{
  const t=Date.now()+1000;
  await writeFile(f.old,call('q',t)+accept('q',t+1));await writeFile(f.next,reply('q',t+2));
  await f.scan(f.next,f.old);assert.equal(f.state.pending.size,0);assert.equal(f.state.events.length,0);
  await appendFile(f.old,call('another',t+3)+accept('another',t+4));await f.scan(f.old);
  assert.equal(f.state.pending.size,1,'both discovered files must actually be read');
 }finally{await f.dispose();}
});
test('a late duplicate question cannot resurrect a reply seen in a previous scan',async()=>{
 const f=await fixture();try{
  const t=Date.now()+1000;await appendFile(f.next,reply('q',t+2));await f.scan(f.next);
  await appendFile(f.old,call('q',t)+accept('q',t+1));await f.scan(f.old);
  assert.equal(f.state.pending.size,0);assert.equal(f.state.events.length,0);
  await appendFile(f.old,call('fresh',t+3)+accept('fresh',t+4));await f.scan(f.old);
  assert.equal(f.state.pending.size,1);
 }finally{await f.dispose();}
});
test('truncating one file does not reset questions from another; deleted files do not block completion',async()=>{
 const f=await fixture();try{
  await writeFile(f.old,' '.repeat(800)+'\n');await f.scan(f.old);
  await writeFile(f.next,call('q')+accept('q'));await f.scan(f.next);assert.equal(f.state.pending.size,1);
  await writeFile(f.old,reply('q'));await f.scan(f.old);assert.equal(f.state.pending.size,0);
  await rm(f.old);await appendFile(f.next,complete('after-delete'));await f.scan(f.old,f.next);
  assert.equal(f.state.events.filter(e=>e.kind==='completed').length,1);
 }finally{await f.dispose();}
});
test('a split UTF-8 record keeps its file offset and completes only once',async()=>{
 const f=await fixture();try{
  await f.scan(f.old);const text=Buffer.from(complete('中文完成'));const at=text.indexOf(Buffer.from('中'))+1;
  await appendFile(f.old,text.subarray(0,at));await f.scan(f.old);assert.equal(f.state.events.length,0);
  await appendFile(f.old,text.subarray(at));await f.scan(f.old);assert.equal(f.state.events[0].turnId,'中文完成');
  await f.scan(f.old);assert.equal(f.state.events.length,1);
 }finally{await f.dispose();}
});
