import {Button,Dropdown,Option,Spinner} from '@fluentui/react-components';
import {useEffect,useRef,useState} from 'react';
import type {CodexChat,CodexConnectionState} from '../../../shared/codexConnection';
import {api} from '../api';

export function CodexConnectionCard() {
  const [state,setState]=useState<CodexConnectionState|null>(null);
  const [chats,setChats]=useState<CodexChat[]|null>(null);
  const [chosen,setChosen]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{
    let mounted=true,polling=false;
    const refresh=async()=>{if(polling)return;polling=true;const current=generation.current;try{const next=await api.codexStatus();if(mounted&&current===generation.current)setState(next);}catch(e){if(mounted&&current===generation.current)setError(String(e));}finally{polling=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    return ()=>{mounted=false;clearInterval(timer);};
  },[]);
  const discover=async()=>{
    setBusy(true);setError('');
    try {
      const reply=await api.codexDiscover();
      if(!reply.ok){setError(reply.error);return;}
      setChats(reply.value);
      setChosen(reply.value.some(c=>c.id===state?.threadId)?state!.threadId!:'');
      if(!reply.value.length)setError('没有找到可接收的本机聊天。请在 Codex 中打开目标聊天并发送一句消息，再刷新。');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const connect=async()=>{
    generation.current++;
    setBusy(true);setError('');
    try{
      const reply=await api.codexConnect(chosen);
      if(!reply.ok){setError(reply.error);return;}
      setState(reply.value);setChats(null);
    }catch(e){setError(String(e));}finally{setBusy(false);}
  };
  return <section className="card codexConnection" aria-label="Codex 连接">
    <div className="codexConnectionHead">
      <div className="lbl"><b>Codex 连接</b><span className="desc">连接已打开的 Codex 桌面版，选择截图接收聊天。无需填写 API Key。</span></div>
      <Button disabled={busy} onClick={()=>void discover()}>{state?.phase==='connected'?'更换接收聊天':'连接 Codex'}</Button>
    </div>
    <div className="codexConnectionStatus" role="status">
      {busy?<Spinner size="tiny" label="正在连接 Codex…"/>:<><b>{state?.phase==='connected'?'已连接':state?.phase==='unavailable'?'连接不可用':'未连接'}</b>{state?.title?<span>{state.title}</span>:null}<span className="desc">{state?.message}</span></>}
    </div>
    {chats?<div className="codexConnectionPicker">
      <Dropdown aria-label="接收聊天" placeholder="选择接收聊天" disabled={busy} selectedOptions={chosen?[chosen]:[]}
        value={chats.find(c=>c.id===chosen)?.title||''} onOptionSelect={(_,d)=>setChosen(d.optionValue||'')}>
        {chats.map(c=><Option key={c.id} value={c.id} text={c.title}>{c.title}</Option>)}
      </Dropdown>
      <Button appearance="primary" disabled={busy||!chosen} onClick={()=>void connect()}>连接并启用 AI</Button>
      <Button disabled={busy} onClick={()=>void discover()}>刷新</Button>
      <span className="desc">列出最近的本机聊天。找不到时，在 Codex 打开目标聊天后刷新。</span>
    </div>:null}
    {error?<div className="codexConnectionError" role="alert">{error}</div>:null}
  </section>;
}
