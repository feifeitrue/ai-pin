import { watch, createReadStream } from 'node:fs';
import { glob, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const sessionsRoot = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
const root=sessionsRoot;
const known = new Map();
export function userSession(meta) {
  return meta && typeof meta.id === 'string' && /^[a-zA-Z0-9-]+$/.test(meta.id)
    && !meta.parent_thread_id && !meta.source?.subagent
    && !(typeof meta.agent_path === 'string' && meta.agent_path.startsWith('/root/'));
}
async function inspect(file) {
  const stream=createReadStream(file,{encoding:'utf8'});
  const reader=createInterface({input:stream,crlfDelay:Infinity});
  try {
    for await(const line of reader) {
      const record=JSON.parse(line);
      const meta=record.type==='session_meta'?record.payload:null;
      if(!meta?.id)return null;
      const result=userSession(meta)?{threadId:meta.id,file}:null;
      known.set(meta.id,result);return result;
    }
  } finally {reader.close();stream.destroy();}
  return null;
}
export async function findUserSession(id) {
  if(typeof id!=='string'||!/^[a-zA-Z0-9-]+$/.test(id))return null;
  if(known.has(id))return known.get(id);
  for await(const name of glob(`**/*${id}.jsonl`,{cwd:root}))return inspect(join(root,name));
  return null;
}
/** Enumerate every existing rollout once when a thread enters the monitor. */
export async function findUserSessionFiles(id) {
  if(typeof id!=='string'||!/^[a-zA-Z0-9-]+$/.test(id))return [];
  const found=[];
  for await(const name of glob(`**/*${id}*.jsonl`,{cwd:root})){
    try{const item=await inspect(join(root,name));if(item?.threadId===id)found.push(item);}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return found;
}
/** Watches activity across the complete session tree, including older chats resumed later. */
export function watchUserSessions() {
  const dirty=new Set();let error=null;
  const watcher=watch(root,{recursive:true},(_event,name)=>{if(name?.endsWith('.jsonl'))dirty.add(join(root,name));});
  watcher.on('error',e=>{error=e;});
  return {
    async discover(){
      if(error)throw error;
      const paths=[...dirty];dirty.clear();const out=[];
      for(const file of paths){try{const s=await inspect(file);if(s)out.push(s);}catch{dirty.add(file);}}
      return out;
    },
    close(){watcher.close();},
  };
}

export async function latestUserSession() {
  const files=[];
  try { for await(const name of glob('**/*.jsonl',{cwd:root})) { const file=join(root,name);try{files.push({file,at:(await stat(file)).mtimeMs});}catch{} } }catch{return null;}
  files.sort((a,b)=>b.at-a.at);
  for(const {file} of files){try{const session=await inspect(file);if(session)return session;}catch{}}
  return null;
}
