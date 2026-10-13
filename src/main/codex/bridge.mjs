import net from 'node:net';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {findAppTools,rpc} from './upstream.mjs';
import {findUserSession,watchUserSessions,latestUserSession} from './user-sessions.mjs';
import {startAttentionMonitor} from './attention.mjs';
import {createBridgeCore} from './core.mjs';

const directory=process.env.AIPIN_BRIDGE_DIR;
if(!directory)throw Error('AIPIN_BRIDGE_DIR is required');
mkdirSync(directory,{recursive:true});
const bindingPath=join(directory,'binding.json');
const [command,...args]=process.argv.slice(2);
function exchange(binding,request) {
  return new Promise((accept,reject)=>{
    const socket=net.createConnection(binding.pipe);let text='';
    const fail=e=>{socket.destroy();reject(e);};socket.setEncoding('utf8');socket.setTimeout(14000,()=>fail(Error('连接超时，结果未确认')));
    socket.on('error',fail);socket.on('end',()=>fail(Error('连接提前关闭')));
    socket.on('connect',()=>socket.write(JSON.stringify({...request,token:binding.token})+'\n'));
    socket.on('data',chunk=>{text+=chunk;if(text.length>1024*1024)return fail(Error('响应过大'));if(!text.includes('\n'))return;socket.destroy();try{const v=JSON.parse(text.split('\n')[0]);if(v.error)reject(Error(v.error));else accept(v);}catch(e){reject(e);}});
  });
}
async function start() {
  // A second launch reuses the live owner instead of replacing it.
  try{const old=JSON.parse(readFileSync(bindingPath,'utf8'));const v=await exchange(old,{op:'snapshot'});if(v.managed&&v.protocol===1)return;}catch{}
  let bootstrap=await latestUserSession();
  if(!bootstrap)throw Error('请先打开 Codex 桌面版，新建一个聊天并发送一句消息，然后重试');
  let upstream;
  const call=async(tool,arguments_)=>{
    if(!bootstrap)bootstrap=await latestUserSession();
    if(!bootstrap)throw Error('请先打开 Codex 桌面版，新建一个聊天并发送一句消息，然后重试');
    try{upstream=await findAppTools(upstream);}catch{throw Error('未找到可用的 Codex 桌面接口，请打开 Codex 桌面版；多个实例时请先关闭多余实例');}
    const result=await rpc(upstream,{id:randomUUID(),jsonrpc:'2.0',method:'tools/call',params:{namespace:'codex_app',tool,arguments:arguments_,callerSource:'codex',threadId:bootstrap.threadId,turnId:'ai-pin-bridge',callId:randomUUID()}});
    if(!result.result?.success){bootstrap=null;throw Error('Codex 拒绝了连接请求，请确认已登录，并刷新聊天列表');}
    const item=result.result.contentItems?.find(i=>i.type==='inputText');
    if(!item)throw Error('此版本的 Codex 接口不兼容');
    return JSON.parse(item.text);
  };
  const core=createBridgeCore({directory,call,findSession:findUserSession,
    log:entry=>appendFileSync(join(directory,'deliveries.jsonl'),JSON.stringify({at:new Date().toISOString(),...entry})+'\n')});
  const sessions=watchUserSessions();
  const selected=core.getSelected();let seed=[bootstrap,selected?.threadId?await findUserSession(selected.threadId):null].filter(Boolean);
  // Periodically seed active desktop chats as well as observing every local transcript change.
  let nextSeed=0;
  const attention=startAttentionMonitor({threadIds:[],state:core.state,log:entry=>appendFileSync(join(directory,'attention.jsonl'),JSON.stringify({at:new Date().toISOString(),...entry})+'\n'),
    discover:async()=>{
      const found=[...seed,...await sessions.discover()];seed=[];
      if(Date.now()>nextSeed){nextSeed=Date.now()+10000;try{const list=await call('list_threads',{limit:50});for(const t of [...(list.pinnedThreads||[]),...(list.threads||[])])if(t.kind==='codex'&&t.hostId==='local'&&t.status==='active'){const s=await findUserSession(t.id);if(s)found.push(s);}}catch{}}
      return found;
    },
    readStatus:async id=>(await call('read_thread',{threadId:id,hostId:'local',turnLimit:1,includeOutputs:false,maxOutputCharsPerItem:0})).thread.status,
  });
  const token=randomBytes(32).toString('hex'),pipe=`\\\\.\\pipe\\lolping-codex-${randomUUID()}`;
  const server=net.createServer(socket=>{
    let text='';socket.setEncoding('utf8');socket.setTimeout(15000,()=>socket.destroy());socket.on('error',()=>{});
    socket.on('data',chunk=>{
      text+=chunk;if(text.length>256*1024){socket.destroy();return;}if(!text.includes('\n'))return;socket.removeAllListeners('data');
      Promise.resolve().then(()=>{const r=JSON.parse(text.split('\n')[0]);if(r.token!==token)throw Error('连接凭据不匹配，请重新连接');return core.dispatch(r);})
        .then(value=>socket.end(JSON.stringify(value)+'\n')).catch(e=>socket.end(JSON.stringify({error:e.message})+'\n'));
    });
  });
  server.listen(pipe,()=>{
    writeFileSync(bindingPath+'.tmp',JSON.stringify({pipe,token,pid:process.pid,managed:true,protocol:1},null,2));renameSync(bindingPath+'.tmp',bindingPath);
    console.log('AI Pin Codex bridge ready');
  });
  server.on('error',e=>{console.error(e.message);process.exit(1);});
  process.on('SIGINT',()=>{attention.stop();sessions.close();server.close();process.exit(0);});
}
async function main() {
  if(command==='start')return start();
  const binding=JSON.parse(readFileSync(bindingPath,'utf8'));
  if(command==='result') {
    const result=JSON.parse(readFileSync(resolve(args[0]),'utf8').replace(/^\uFEFF/,''));
    console.log(JSON.stringify(await exchange(binding,{op:'result',result}),null,2));
  }else if(command==='snapshot')console.log(JSON.stringify(await exchange(binding,{op:'snapshot'}),null,2));
  else throw Error('Unsupported bridge command');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
