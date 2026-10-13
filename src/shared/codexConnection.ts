export interface CodexChat {id:string;title:string;status:string}
export interface CodexConnectionState {
  phase:'disconnected'|'connected'|'unavailable';
  title?:string;
  threadId?:string;
  message:string;
  managed:boolean;
}
export type CodexReply<T>={ok:true;value:T}|{ok:false;error:string};
