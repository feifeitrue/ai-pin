import { findUserSessionFiles } from './user-sessions.mjs';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

const parse = text => { try { return JSON.parse(text); } catch { return null; } };

/** Reads structured request/answer records only; ordinary prose never creates alerts. */
export class QuestionTracker {
  calls = new Map();
  // Rotation may repeat an old call or reveal its reply before the call file.
  resolved = new Set();
  answers = new Map();
  accepted = new Set();
  finish(id) { this.calls.delete(id); this.answers.delete(id); this.accepted.delete(id); this.resolved.add(id); }
  ingest(record) {
    if (record.type !== 'response_item') return;
    const p = record.payload;
    if (!p) return;
    const name = p.name?.split('.').at(-1);
    if (p.type === 'function_call' && ['request_user_input_async', 'request_user_input'].includes(name)) {
      const args = parse(p.arguments);
      if (!p.call_id || !Array.isArray(args?.questions) || !args.questions.length || this.calls.has(p.call_id) || this.resolved.has(p.call_id)) return;
      const remaining = new Set(args.questions.map((_, i) => i).filter(i => !this.answers.get(p.call_id)?.has(i)));
      if (!remaining.size) { this.finish(p.call_id); return; }
      this.calls.set(p.call_id, {
        async: name === 'request_user_input_async', accepted: name === 'request_user_input' || this.accepted.has(p.call_id),
        remaining,
        summary: String(args.questions[0].title || args.questions[0].question || 'Codex 需要你回答').slice(0, 220),
      });
    } else if (p.type === 'function_call_output') {
      const q = this.calls.get(p.call_id);
      if (this.resolved.has(p.call_id)) return;
      const value = parse(p.output);
      if (value?.accepted === true && (!q || q.async)) {
        this.accepted.add(p.call_id); if (q) q.accepted = true;
      } else if (q || value?.accepted === false || value?.answers) this.finish(p.call_id);
    } else if (p.type === 'message' && p.role === 'user') {
      for (const content of p.content || []) {
        const match = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(content.text || '');
        const replies = match ? parse(match[1]) : null;
        if (!Array.isArray(replies)) continue;
        for (const reply of replies) {
          const key = parse(reply.questionItemId);
          if (!Array.isArray(key) || key[0] !== 'request_user_input_async') continue;
          if (typeof key[1] !== 'string' || !Number.isInteger(key[2]) || key[2] < 0 || this.resolved.has(key[1])) continue;
          const answered = this.answers.get(key[1]) || new Set();
          answered.add(key[2]); this.answers.set(key[1], answered);
          const q = this.calls.get(key[1]);
          if (q) { q.remaining.delete(key[2]); if (!q.remaining.size) this.finish(key[1]); }
        }
      }
    }
  }
  pending() { return [...this.calls].filter(([, q]) => q.accepted).map(([id, q]) => ({ id, summary: q.summary })); }
}

/** Reconcile native waiting flags without converting disconnected/failed reads to resolution. */
export class NativeAttention {
  pending = new Map();
  update(status, hasStructuredQuestion = false) {
    if (!status || !['active', 'idle', 'systemError', 'notLoaded'].includes(status.type)) throw new Error('Unrecognized Codex status');
    if (status.type === 'notLoaded') return [...this.pending.values()];
    const flags = status.type === 'active' ? status.activeFlags : [];
    if (!Array.isArray(flags)) throw new Error('Missing activeFlags');
    const wanted = new Set(flags.filter(f => f === 'waitingOnApproval' || (f === 'waitingOnUserInput' && !hasStructuredQuestion)));
    for (const flag of this.pending.keys()) if (!wanted.has(flag)) this.pending.delete(flag);
    for (const flag of wanted) if (!this.pending.has(flag)) this.pending.set(flag, {
      id: `${flag}:${randomUUID()}`, summary: flag === 'waitingOnApproval' ? 'Codex 需要确认操作，请回到对应聊天审批' : 'Codex 需要你回答，请回到对应聊天',
    });
    return [...this.pending.values()];
  }
}

/** File-local bytes only. Question state belongs to the thread, never to a file. */
class TranscriptTail {
  offset = 0;
  decoder = new StringDecoder('utf8');
  partial = '';
  primed = false;
  constructor(file, since) { this.file = file; this.since = since; }
  async read() {
    const size = (await stat(this.file)).size;
    if (size < this.offset) { this.offset = 0; this.partial = ''; this.decoder = new StringDecoder('utf8'); this.primed = false; }
    const records = [];
    if (size === this.offset) return records;
    const file = await open(this.file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size - this.offset, 1024 * 1024));
      while (this.offset < size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - this.offset), this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        this.partial += this.decoder.write(buffer.subarray(0, bytesRead));
        let end;
        while ((end = this.partial.indexOf('\n')) >= 0) {
          const record = parse(this.partial.slice(0, end));
          this.partial = this.partial.slice(end + 1);
          if (!record) continue;
          const timestamp = Date.parse(record.timestamp);
          // Copied historical records must stay historical even in an already-read file.
          const live = Number.isFinite(timestamp) ? timestamp >= this.since : this.primed;
          if (live && (record.type === 'event_msg' || record.type === 'response_item')) records.push(record);
        }
      }
    } finally { await file.close(); }
    this.primed = true;
    return records;
  }
}

const eventOrder = r => r.payload?.type === 'function_call' ? 0 : r.payload?.type === 'function_call_output' ? 1 : 2;
const recordTime = r => Number.isFinite(Date.parse(r.timestamp)) ? Date.parse(r.timestamp) : 0;

export function startAttentionMonitor({ threadIds, state, readStatus, log, discover, now = Date.now, automatic = true }) {
  const monitorSince=Date.now();
  const scopes = new Map();
  const addFile = (scope, file) => {
    const path = resolve(file), key = process.platform === 'win32' ? path.toLowerCase() : path;
    if (!scope.tails.has(key)) scope.tails.set(key, new TranscriptTail(path, monitorSince));
  };
  const add = ({threadId,file}) => {
    if(scopes.has(threadId)){
      const scope=scopes.get(threadId);
      if(file)addFile(scope,file);
      scope.dirty=true;if(scope.idle)scope.nextPoll=now();scope.idle=false;return;
    }
    const scope={threadId,tails:new Map(),tracker:new QuestionTracker(),filesResolved:false,
      native:new NativeAttention(),ids:new Set(),nativeIds:new Set(),ready:false,idle:false,dirty:true,nextPoll:0,failures:0};
    if(file)addFile(scope,file);
    for(const [id,summary] of state.pending){
      const q=`auto:${threadId}:question:`, n=`auto:${threadId}:native:`;
      if(id.startsWith(q))scope.ids.add(id);
      if(id.startsWith(n)){scope.nativeIds.add(id);const local=id.slice(n.length);scope.native.pending.set(local.split(':')[0],{id:local,summary});}
    }
    scopes.set(threadId,scope);
  };
  threadIds.forEach(threadId=>add({threadId}));
  let reading = false, polling = false, stopped = false;
  const health = { mode:discover?'all-user-chats':'selected-chats',threads:[...scopes.keys()],transcriptError:null,statusError:null,statusReads:0,statusFailures:0,maxConcurrent:0,transcriptFiles:0 };
  const reconcile = (scope, source, pending, previous) => {
    const next = new Set(pending.map(q => `auto:${scope.threadId}:${source}:${q.id}`));
    for (const q of pending) {
      const id = `auto:${scope.threadId}:${source}:${q.id}`;
      if (state.question(id, q.summary)) log({ source, threadId: scope.threadId, id, action: 'requested' });
    }
    for (const id of previous) if (!next.has(id) && state.resolve(id)) log({ source, threadId: scope.threadId, id, action: 'resolved' });
    return next;
  };
  async function readTranscripts() {
    if (reading || stopped) return;
    reading = true;
    try {
      if(discover)for(const item of await discover())add(item);
      health.transcriptError=null;
      for(const scope of scopes.values()){
        if(discover&&!scope.dirty)continue;
        scope.dirty=false;
        try{
          if(!scope.filesResolved){
            for(const item of await findUserSessionFiles(scope.threadId))addFile(scope,item.file);
            scope.filesResolved=true;
          }
          const records=[];
          for(const tail of [...scope.tails.values()].sort((a,b)=>a.file.localeCompare(b.file))){
            try{records.push(...await tail.read());}
            catch(e){if(e.code!=='ENOENT'){scope.dirty=true;health.transcriptError=`${scope.threadId}: ${e.message}`;}}
          }
          // One reconciliation after the entire batch: discovery order cannot create
          // a transient question ping for an already-answered cross-file question.
          records.sort((a,b)=>recordTime(a)-recordTime(b)||eventOrder(a)-eventOrder(b));
          for(const record of records){
            scope.tracker.ingest(record);
            const p=record.payload;
            if(record.type==='event_msg'&&typeof p?.turn_id==='string'){
              if(p.type==='task_complete')state.complete(p.turn_id);
              else if(p.type==='turn_aborted')state.emit('interrupted',{turnId:p.turn_id,threadId:scope.threadId});
            }
          }
          scope.ids=reconcile(scope,'question',scope.tracker.pending(),scope.ids);scope.ready=true;
        }catch(e){scope.dirty=true;health.transcriptError=`${scope.threadId}: ${e.message}`;}

      }
      health.threads=[...scopes.values()].filter(s=>!s.idle).map(s=>s.threadId);
      health.transcriptFiles=[...scopes.values()].reduce((n,s)=>n+s.tails.size,0);
    } catch (e) { health.transcriptError = e.message; }
    finally { reading = false; }
  }
  async function pollStatus() {
    if (polling || stopped) return;
    polling = true;
    try {
      health.statusError=null;
      // One bounded batch, oldest due first. A busy/failed chat cannot monopolize the queue.
      const batch=[...scopes.values()].filter(s=>!s.idle&&s.nextPoll<=now())
        .sort((a,b)=>a.nextPoll-b.nextPoll).slice(0,2);
      health.maxConcurrent=Math.max(health.maxConcurrent,batch.length);
      await Promise.all(batch.map(async scope=>{
        scope.nextPoll=now()+5000;health.statusReads++;
        try{
          const status=await readStatus(scope.threadId);
          scope.nativeIds=reconcile(scope,'native',scope.native.update(status,scope.tracker.pending().length>0),scope.nativeIds);
          scope.failures=0;
          // Unloaded chats are quiescent too. Keep their transcript offsets and pending
          // state: new file activity reattaches them without replaying old history.
          if(discover&&['idle','notLoaded','systemError'].includes(status.type))scope.idle=true;
        }catch(e){
          health.statusFailures++;health.statusError=`${scope.threadId}: ${e.message}`;
          scope.failures++;scope.nextPoll=now()+Math.min(60000,5000*2**Math.min(scope.failures-1,4));
        }
      }));
      health.threads=[...scopes.values()].filter(s=>!s.idle).map(s=>s.threadId);
      health.transcriptFiles=[...scopes.values()].reduce((n,s)=>n+s.tails.size,0);
    } catch (e) { health.statusError = e.message; }
    finally { polling = false; }
  }
  const transcriptTimer = automatic ? setInterval(readTranscripts, 700) : null;
  const statusTimer = automatic ? setInterval(pollStatus, 2500) : null;
  if(automatic)void readTranscripts().then(pollStatus);
  return { health, readTranscripts, pollStatus, stop: () => { stopped = true; clearInterval(transcriptTimer); clearInterval(statusTimer); } };
}
