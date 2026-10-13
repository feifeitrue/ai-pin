import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationState } from './state.mjs';
import { TaskStore } from './task-store.mjs';
import { imageQuestion } from './image-question.mjs';

export function createBridgeCore({directory,call,findSession,log=()=>{}}) {
  const state=new NotificationState();
  const tasks=new TaskStore(join(directory,'tasks'));
  const configPath=join(directory,'connection.json');
  let selected=null,lastError=null;
  if(existsSync(configPath))try{selected=JSON.parse(readFileSync(configPath,'utf8'));}catch{}
  const saveSelection=next=>{
    writeFileSync(configPath+'.tmp',JSON.stringify(next,null,2));renameSync(configPath+'.tmp',configPath);selected=next;
  };
  const dispatch=async request=>{
    if(request.op==='snapshot')return {...state.snapshot(Number(request.after)||0),managed:true,protocol:1,threadId:selected?.threadId,title:selected?.title,lastError};
    if(request.op==='list') {
      const listed=await call('list_threads',{limit:50});
      const rows=[...(listed.pinnedThreads||[]),...(listed.threads||[])];const found=[];const seen=new Set();
      for(const t of rows) {
        if(t.kind!=='codex'||t.hostId!=='local'||seen.has(t.id)||!await findSession(t.id))continue;
        seen.add(t.id);found.push({id:t.id,title:t.title||'未命名聊天',status:t.status});
      }
      return {chats:found};
    }
    if(request.op==='bind') {
      if(!await findSession(request.threadId))throw Error('请选择本机 Codex 的用户聊天');
      const {thread}=await call('read_thread',{threadId:request.threadId,hostId:'local',turnLimit:1,includeOutputs:false,maxOutputCharsPerItem:0});
      if(thread?.id!==request.threadId||thread.kind!=='codex')throw Error('Codex 没有确认该聊天');
      saveSelection({threadId:thread.id,title:thread.title||'未命名聊天'});lastError=null;
      return {threadId:thread.id,title:selected.title};
    }
    if(request.op==='health') {
      if(!selected?.threadId)return {connected:false};
      await call('read_thread',{threadId:selected.threadId,hostId:'local',turnLimit:1,includeOutputs:false,maxOutputCharsPerItem:0});
      return {connected:true,...selected};
    }
    if(request.op==='result') {
      const saved=tasks.save(request.result);
      if(!saved.duplicate)state.emit('result-saved',{intent:saved.intent,summary:saved.title,questionId:saved.questionId,savedPath:saved.savedPath});
      return saved;
    }
    if(request.op==='image') {
      // Each accepted queue item carries its own destination, even if the user rebinds meanwhile.
      const threadId=request.threadId||selected?.threadId;
      if(!threadId||!await findSession(threadId))throw Error('请先在设置中连接 Codex 并选择接收聊天');
      const {prompt,...question}=imageQuestion(request);
      tasks.create({...question,threadId});log({status:'sending',threadId,...question});
      try {
        const result=await call('send_message_to_thread',{threadId,hostId:'local',prompt});
        if(result.threadId!==threadId)throw Error('Codex 未确认目标聊天，发送结果不明确');
        lastError=null;log({status:'delivered',threadId,...question});return {threadId,questionId:question.questionId};
      }catch(e){lastError=e.message;log({status:'unconfirmed',threadId,...question,error:e.message});throw e;}
    }
    throw Error('Unsupported bridge operation');
  };
  return {state,tasks,dispatch,getSelected:()=>selected};
}
