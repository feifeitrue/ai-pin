import {bridgeRequest,readCodexBinding,type CodexBinding} from './codexConnection';

export async function sendImageToCodex(bindingFile:string|CodexBinding,path:string,instruction:string):Promise<void> {
  const binding=typeof bindingFile==='string'?readCodexBinding(bindingFile):bindingFile;
  const result=await bridgeRequest(binding,{op:'image',path,instruction,threadId:binding.threadId});
  if(!result.threadId || (binding.threadId && result.threadId!==binding.threadId))throw Error('Codex 没有确认目标聊天，发送结果未确认');
}
