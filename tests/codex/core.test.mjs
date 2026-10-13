import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createBridgeCore} from '../../src/main/codex/core.mjs';
test('connect validates the target, remembers it, and in-flight images retain their own destination',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'ai-pin-core-'));const calls=[];
 const call=async(tool,args)=>{calls.push({tool,args});if(tool==='read_thread')return {thread:{id:args.threadId,kind:'codex',title:'Chat '+args.threadId}};if(tool==='send_message_to_thread')return {threadId:args.threadId};throw Error('unexpected tool');};
 const findSession=async id=>['A','B'].includes(id)?{threadId:id}:null;
 const core=createBridgeCore({directory,call,findSession});
 await core.dispatch({op:'bind',threadId:'A'});
 const capturedDestination='A';await core.dispatch({op:'bind',threadId:'B'});
 const image=join(directory,'sample.png');writeFileSync(image,'image');
 const delivered=await core.dispatch({op:'image',threadId:capturedDestination,path:image,instruction:'look here'});
 assert.equal(delivered.threadId,'A');assert.equal(core.getSelected().threadId,'B');
 const send=calls.find(c=>c.tool==='send_message_to_thread');assert.equal(send.args.threadId,'A');assert.match(send.args.prompt,/return-result.cmd/);
 await assert.rejects(core.dispatch({op:'bind',threadId:'unknown'}));assert.equal(core.getSelected().threadId,'B');
 const restored=createBridgeCore({directory,call,findSession});assert.equal(restored.getSelected().threadId,'B');
 const task=JSON.parse(readFileSync(join(directory,'tasks',delivered.questionId+'.json'),'utf8'));assert.equal(task.threadId,'A');
});
test('sending without confirmation is not retried or reported as delivered',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'ai-pin-core-'));const file=join(directory,'sample.png');writeFileSync(file,'image');let sends=0;
 const core=createBridgeCore({directory,findSession:async()=>true,call:async()=>{sends++;throw Error('uncertain');}});
 await assert.rejects(core.dispatch({op:'image',threadId:'A',path:file}),/uncertain/);assert.equal(sends,1);
 assert.equal((await core.dispatch({op:'snapshot'})).lastError,'uncertain');
});
test('discovery only offers unique local Codex user chats',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'ai-pin-core-'));
 const core=createBridgeCore({directory,findSession:async id=>id!=='child',call:async()=>({pinnedThreads:[{id:'A',title:'Pinned',kind:'codex',hostId:'local'}],threads:[{id:'A',kind:'codex',hostId:'local'},{id:'remote',kind:'codex',hostId:'other'},{id:'gpt',kind:'chatgpt',hostId:'local'},{id:'child',kind:'codex',hostId:'local'}]})});
 assert.deepEqual((await core.dispatch({op:'list'})).chats.map(c=>c.id),['A']);
});
