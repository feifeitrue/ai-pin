import {app} from 'electron';
import {spawn} from 'node:child_process';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import type {CodexChat,CodexConnectionState} from '../shared/codexConnection';
import type {SettingsStore} from './settingsStore';

export interface CodexBinding {pipe:string;token?:string;threadId?:string}
export function readCodexBinding(file:string):CodexBinding {
  const value=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(typeof value.pipe!=='string'||!value.pipe.startsWith('\\\\.\\pipe\\lolping-codex-'))throw Error('Codex 连接配置无效');
  return {pipe:value.pipe,token:value.token,threadId:value.threadId};
}
export function bridgeRequest(binding:CodexBinding,request:Record<string,unknown>,timeout=14000):Promise<any> {
  return new Promise((resolve,reject)=>{
    const socket=createConnection(binding.pipe);let data='';
    const fail=(error:Error)=>{socket.destroy();reject(error);};
    socket.setEncoding('utf8');socket.setTimeout(timeout,()=>fail(Error('连接超时，结果未确认，请不要重复发送')));
    socket.on('error',fail);socket.on('end',()=>fail(Error('连接提前关闭，结果未确认')));
    socket.on('connect',()=>socket.write(JSON.stringify({...request,token:binding.token})+'\n'));
    socket.on('data',chunk=>{
      data+=chunk;if(data.length>1024*1024)return fail(Error('连接响应过大'));
      if(!data.includes('\n'))return;socket.destroy();
      try{const response=JSON.parse(data.split('\n')[0]);if(response.error)reject(Error(response.error));else resolve(response);}catch(e){reject(e);}
    });
  });
}

export class CodexConnection {
  readonly directory:string;
  readonly bindingFile:string;
  private starting:Promise<void>|null=null;
  private errorFile:string;
  constructor(private store:SettingsStore) {
    this.directory=join(store.dir,'codex');this.bindingFile=join(this.directory,'binding.json');this.errorFile=join(this.directory,'bridge.stderr.log');
  }
  private script():string {return app.isPackaged?join(process.resourcesPath,'codex-bridge.js'):join(__dirname,'codex-bridge.js');}
  private async alive():Promise<boolean> {
    try {const status=await bridgeRequest(readCodexBinding(this.bindingFile),{op:'snapshot'},1200);return status.managed===true&&status.protocol===1;}catch{return false;}
  }
  async ensure():Promise<void> {
    if(this.starting)return this.starting;
    this.starting=this.start().finally(()=>{this.starting=null;});return this.starting;
  }
  private async start():Promise<void> {
    if(process.platform!=='win32')throw Error('此版本的一键连接暂仅支持 Windows');
    mkdirSync(this.directory,{recursive:true});
    const runner=join(this.directory,'return-result.cmd');
    const quote=(s:string)=>s.replace(/'/g,"''");
    writeFileSync(runner,'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0return-result.ps1" "%~1"\r\nexit /b %errorlevel%\r\n','utf8');
    writeFileSync(join(this.directory,'return-result.ps1'),`\uFEFFparam([Parameter(Mandatory=$true)][string]$ResultFile)\r\n$env:ELECTRON_RUN_AS_NODE='1'\r\n$env:AIPIN_BRIDGE_DIR=$PSScriptRoot\r\n& '${quote(process.execPath)}' '${quote(this.script())}' result $ResultFile 2>&1 | ForEach-Object { "$_" }\r\nexit $LASTEXITCODE\r\n`,'utf8');
    if(await this.alive())return;
    const stdout=openSync(join(this.directory,'bridge.stdout.log'),'a'),stderr=openSync(this.errorFile,'w');
    let exited=false;
    try {
      const env:NodeJS.ProcessEnv={...process.env,ELECTRON_RUN_AS_NODE:'1',AIPIN_BRIDGE_DIR:this.directory,AIPIN_RESULT_RUNNER:runner};
      // A normal desktop launch has no Codex tool environment; discovery must work without it.
      delete env.CODEX_APP_TOOLS_PIPE_PATH;delete env.CODEX_THREAD_ID;
      const child=spawn(process.execPath,[this.script(),'start'],{env,windowsHide:true,detached:true,stdio:['ignore',stdout,stderr]});
      child.once('error',()=>{exited=true;});child.once('exit',()=>{exited=true;});child.unref();
    }finally{closeSync(stdout);closeSync(stderr);}
    for(let i=0;i<40;i++){
      if(await this.alive())return;
      if(exited)break;
      await new Promise(r=>setTimeout(r,250));
    }
    const details=existsSync(this.errorFile)?readFileSync(this.errorFile,'utf8').trim().split('\n').at(-1):'';
    throw Error(details||'连接服务未能启动，请打开 Codex 桌面版后重试');
  }
  async discover():Promise<CodexChat[]> {
    await this.ensure();const result=await bridgeRequest(readCodexBinding(this.bindingFile),{op:'list'});
    if(!Array.isArray(result.chats))throw Error('Codex 聊天列表格式不兼容');return result.chats;
  }
  async connect(threadId:string):Promise<CodexConnectionState> {
    if(!/^[a-zA-Z0-9-]+$/.test(threadId))throw Error('请选择接收聊天');
    await this.ensure();const selected=await bridgeRequest(readCodexBinding(this.bindingFile),{op:'bind',threadId});
    // Store the target separately so enqueue can freeze it without an async RPC.
    this.store.update({aiBindingFile:this.bindingFile,aiThreadId:selected.threadId,aiMode:true});await this.store.flush();
    return {phase:'connected',threadId:selected.threadId,title:selected.title,managed:true,message:'已连接，截图会发送到此聊天；所有用户聊天均有状态提醒'};
  }
  async status():Promise<CodexConnectionState> {
    const file=this.store.get().aiBindingFile;
    if(!file)return {phase:'disconnected',managed:false,message:'打开 Codex 桌面版，连接后选择接收聊天'};
    try {
      const binding=readCodexBinding(file);
      if(file!==this.bindingFile){const s=await bridgeRequest(binding,{op:'snapshot'},1500);return {phase:'connected',threadId:s.threadId,managed:false,message:'现有连接正常；可通过下方按钮切换为应用内管理'};}
      const h=await bridgeRequest(binding,{op:'health'},5000);
      return h.connected?{phase:'connected',threadId:h.threadId,title:h.title,managed:true,message:'已连接，截图发送到此聊天'}:{phase:'disconnected',managed:true,message:'请选择接收聊天'};
    }catch(e){return {phase:'unavailable',managed:file===this.bindingFile,message:e instanceof Error?e.message:'连接不可用，请重试'};}
  }
  async restore():Promise<void> {if(this.store.get().aiBindingFile===this.bindingFile)await this.ensure();}
}
