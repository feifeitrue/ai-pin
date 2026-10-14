import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('startup finds suffixed rollouts, validates their metadata and filters subagents',async()=>{
 const home=await mkdtemp(join(tmpdir(),'ai-ping-session-files-')),dir=join(home,'sessions','2026','10','14');
 await mkdir(dir,{recursive:true});
 const fixtures=[['rollout-chat-a.jsonl',{id:'chat-a'}],['rollout-chat-a_other-id.jsonl',{id:'chat-a'}],
  ['rollout-chat-a_child.jsonl',{id:'child',parent_thread_id:'chat-a'}],['rollout-chat-a_unrelated.jsonl',{id:'different'}]];
 for(const [name,payload] of fixtures)await writeFile(join(dir,name),JSON.stringify({type:'session_meta',payload})+'\n');
 try{
  const module=new URL('../../src/main/codex/user-sessions.mjs',import.meta.url).href;
  const code=`import {findUserSessionFiles} from ${JSON.stringify(module)};import{basename}from'node:path';console.log(JSON.stringify((await findUserSessionFiles('chat-a')).map(x=>basename(x.file)).sort()));`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CODEX_HOME:home}});
  assert.deepEqual(JSON.parse(stdout),['rollout-chat-a.jsonl','rollout-chat-a_other-id.jsonl']);
 }finally{await rm(home,{recursive:true,force:true});}
});
