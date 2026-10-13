import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TaskStore } from '../../src/main/codex/task-store.mjs';
import { imageQuestion } from '../../src/main/codex/image-question.mjs';

test('all three intents route independently and saved notes preserve source images', () => {
 const root=mkdtempSync(join(tmpdir(),'lolping-modes-'));
 try {
  const store=new TaskStore(join(root,'tasks'));
  for (const [ping,intent] of [['allin','opinion'],['needvision','note'],['enemyvision','note'],['assist','learn']]) {
   const path=join(root,ping+'.png'),cropPath=join(root,ping+'-detail.png');writeFileSync(path,'screen-'+ping);writeFileSync(cropPath,'detail-'+ping);
   writeFileSync(join(root,ping+'.json'),JSON.stringify({path,cropPath,ping,point:{x:100,y:200}}));
   const {prompt,...record}=imageQuestion({path});assert.equal(record.intent,intent);assert.match(prompt,/result/);
   store.create(record);const result={questionId:record.questionId,title:ping,answer:'实际处理后的独立正文'};
   const saved=store.save(result);assert.ok(readFileSync(saved.savedPath,'utf8').includes(result.answer));
   assert.equal(store.save(result).duplicate,true);
   if(intent==='note')assert.equal(readFileSync(join(root,'tasks',record.questionId,'screen.png'),'utf8'),'screen-'+ping);
   assert.throws(()=>store.save({...result,answer:'不同的内容'}),/different result/);
  }
 } finally {rmSync(root,{recursive:true,force:true})}
});
test('missing source, invalid ID and empty output cannot produce a successful save',()=>{
 const root=mkdtempSync(join(tmpdir(),'lolping-save-'));
 try {
  const store=new TaskStore(root);const id='LP-'+randomUUID();store.create({questionId:id,intent:'note',path:join(root,'missing.png')});
  assert.throws(()=>store.save({questionId:id,title:'x',answer:''}),/requires/);
  assert.throws(()=>store.save({questionId:id,title:'x',answer:'content'}));
  assert.equal(JSON.parse(readFileSync(store.path(id),'utf8')).status,'received');
  assert.equal(existsSync(join(root,id,'note.txt')),false);
  assert.throws(()=>store.save({questionId:'../x',title:'x',answer:'x'}),/Invalid/);
 } finally {rmSync(root,{recursive:true,force:true})}
});
