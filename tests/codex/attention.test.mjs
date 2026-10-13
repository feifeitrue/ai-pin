import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionTracker, NativeAttention } from '../../src/main/codex/attention.mjs';
const call = (id, name='request_user_input_async', count=1) => ({ type: 'response_item', payload: { type: 'function_call', name, call_id: id, arguments: JSON.stringify({ questions: Array.from({length:count}, () => ({title:'请选择'})) }) } });
const output = (id, value) => ({ type:'response_item', payload: {type:'function_call_output', call_id:id, output:JSON.stringify(value)} });
const reply = (id, index=0) => ({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`<send_user_message_question_reply>\n${JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',id,index]),answer:'yes'}])}\n</send_user_message_question_reply>`}]}});
test('accepted async request waits for its matching reply, not the initial tool return', () => {
 const t=new QuestionTracker();t.ingest(call('a'));assert.equal(t.pending().length,0);
 t.ingest(output('a',{accepted:true}));assert.equal(t.pending().length,1);
 t.ingest(reply('other'));assert.equal(t.pending().length,1);
 t.ingest(reply('a'));assert.equal(t.pending().length,0);
});
test('multiple questions resolve independently; duplicates do not reset answers', () => {
 const t=new QuestionTracker();t.ingest(call('a','request_user_input_async',2));t.ingest(output('a',{accepted:true}));
 t.ingest(reply('a',0));t.ingest(call('a','request_user_input_async',2));assert.equal(t.pending().length,1);
 t.ingest(reply('a',1));assert.equal(t.pending().length,0);
});
test('rejected calls and ordinary text are not pending; synchronous calls clear on return', () => {
 const t=new QuestionTracker();t.ingest(call('a'));t.ingest(output('a',{accepted:false}));assert.equal(t.pending().length,0);
 t.ingest({type:'response_item',payload:{type:'message',role:'assistant',content:[{text:'需要你确认？'}]}});assert.equal(t.pending().length,0);
 t.ingest(call('b','request_user_input'));assert.equal(t.pending().length,1);t.ingest(output('b',{answers:{}}));assert.equal(t.pending().length,0);
});
test('historical request followed by answer does not create a startup reminder', () => {
 const t=new QuestionTracker();[call('a'),output('a',{accepted:true}),reply('a')].forEach(r=>t.ingest(r));assert.deepEqual(t.pending(),[]);
});
test('approval states alert once per waiting episode and clear on valid resolution', () => {
 const n=new NativeAttention();const a=n.update({type:'active',activeFlags:['waitingOnApproval']});
 assert.equal(a.length,1);assert.deepEqual(n.update({type:'active',activeFlags:['waitingOnApproval']}),a);
 assert.deepEqual(n.update({type:'notLoaded'}),a);assert.throws(()=>n.update(null));
 assert.deepEqual(n.update({type:'active',activeFlags:[]}),[]);
 assert.notEqual(n.update({type:'active',activeFlags:['waitingOnApproval']})[0].id,a[0].id);
});
test('normal running and idle are not approvals; structured input avoids a second alert', () => {
 const n=new NativeAttention();assert.deepEqual(n.update({type:'active',activeFlags:[]}),[]);
 assert.deepEqual(n.update({type:'active',activeFlags:['waitingOnUserInput']},true),[]);
 assert.equal(n.update({type:'active',activeFlags:['waitingOnUserInput']},false).length,1);
 assert.deepEqual(n.update({type:'idle'}),[]);
});
