import { sessionsRoot } from './user-sessions.mjs';
import { glob, open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

const parse = text => { try { return JSON.parse(text); } catch { return null; } };

/** Reads structured request/answer records only; ordinary prose never creates alerts. */
export class QuestionTracker {
  calls = new Map();
  ingest(record) {
    if (record.type !== 'response_item') return;
    const p = record.payload;
    if (!p) return;
    const name = p.name?.split('.').at(-1);
    if (p.type === 'function_call' && ['request_user_input_async', 'request_user_input'].includes(name)) {
      const args = parse(p.arguments);
      if (!p.call_id || !Array.isArray(args?.questions) || !args.questions.length || this.calls.has(p.call_id)) return;
      this.calls.set(p.call_id, {
        async: name === 'request_user_input_async', accepted: name === 'request_user_input',
        remaining: new Set(args.questions.map((_, i) => i)),
        summary: String(args.questions[0].title || args.questions[0].question || 'Codex 需要你回答').slice(0, 220),
      });
    } else if (p.type === 'function_call_output') {
      const q = this.calls.get(p.call_id);
      if (!q) return;
      if (q.async && parse(p.output)?.accepted === true) q.accepted = true;
      else this.calls.delete(p.call_id);
    } else if (p.type === 'message' && p.role === 'user') {
      for (const content of p.content || []) {
        const match = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(content.text || '');
        const replies = match ? parse(match[1]) : null;
        if (!Array.isArray(replies)) continue;
        for (const reply of replies) {
          const key = parse(reply.questionItemId);
          if (!Array.isArray(key) || key[0] !== 'request_user_input_async') continue;
          const q = this.calls.get(key[1]);
          if (!q) continue;
          q.remaining.delete(key[2]);
          if (!q.remaining.size) this.calls.delete(key[1]);
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

class TranscriptTail {
  since=Date.now();
  tracker = new QuestionTracker();
  offset = 0;
  decoder = new StringDecoder('utf8');
  partial = '';
  file = null;
  constructor(threadId, terminal) { this.threadId = threadId; this.terminal = terminal; this.primed=false; }
  async read() {
    if (!this.file) {
      if (!/^[a-zA-Z0-9-]+$/.test(this.threadId)) throw new Error('Invalid thread id');
      for await (const file of glob(`**/*${this.threadId}.jsonl`, { cwd: sessionsRoot })) {
        this.file = join(sessionsRoot, file); break;
      }
      if (!this.file) throw new Error('Chat transcript not found');
    }
    const size = (await stat(this.file)).size;
    if (size < this.offset) { this.offset = 0; this.partial = ''; this.decoder = new StringDecoder('utf8'); this.tracker = new QuestionTracker(); }
    if (size === this.offset) return this.tracker.pending();
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
          if (record) {
            const live=this.primed||Date.parse(record.timestamp)>=this.since;
            // First connection must not resurrect old, abandoned question cards.
            // Genuine pre-existing waits are recovered from the native waiting flags.
            if(live)this.tracker.ingest(record);
            const p=record.payload;
            if(live&&record.type==='event_msg'&&typeof p?.turn_id==='string'){
              if(p.type==='task_complete')this.terminal?.(p.turn_id,'completed');
              else if(p.type==='turn_aborted')this.terminal?.(p.turn_id,'interrupted');
            }
          }
        }
      }
    } finally { await file.close(); }
    this.primed=true;
    return this.tracker.pending();
  }
}

export function startAttentionMonitor({ threadIds, state, readStatus, log, discover, now = Date.now, automatic = true }) {
  const monitorSince=Date.now();
  const scopes = new Map();
  const add = ({threadId,file}) => {
    if(scopes.has(threadId)){const scope=scopes.get(threadId);scope.dirty=true;if(scope.idle)scope.nextPoll=now();scope.idle=false;return;}
    const scope={threadId,tail:new TranscriptTail(threadId,(turnId,status)=>{if(status==='completed')state.complete(turnId);else state.emit(status,{turnId,threadId});}),native:new NativeAttention(),ids:new Set(),nativeIds:new Set(),ready:false,idle:false,dirty:true,nextPoll:0,failures:0};
    scope.tail.since=monitorSince;
    if(file)scope.tail.file=file;
    for(const [id,summary] of state.pending){
      const q=`auto:${threadId}:question:`, n=`auto:${threadId}:native:`;
      if(id.startsWith(q))scope.ids.add(id);
      if(id.startsWith(n)){scope.nativeIds.add(id);const local=id.slice(n.length);scope.native.pending.set(local.split(':')[0],{id:local,summary});}
    }
    scopes.set(threadId,scope);
  };
  threadIds.forEach(threadId=>add({threadId}));
  let reading = false, polling = false, stopped = false;
  const health = { mode:discover?'all-user-chats':'selected-chats',threads:[...scopes.keys()],transcriptError:null,statusError:null,statusReads:0,statusFailures:0,maxConcurrent:0 };
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
        try{scope.ids=reconcile(scope,'question',await scope.tail.read(),scope.ids);scope.ready=true;}
        catch(e){scope.dirty=true;health.transcriptError=`${scope.threadId}: ${e.message}`;}
      }
      health.threads=[...scopes.values()].filter(s=>!s.idle).map(s=>s.threadId);
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
          scope.nativeIds=reconcile(scope,'native',scope.native.update(status,scope.tail.tracker.pending().length>0),scope.nativeIds);
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
    } catch (e) { health.statusError = e.message; }
    finally { polling = false; }
  }
  const transcriptTimer = automatic ? setInterval(readTranscripts, 700) : null;
  const statusTimer = automatic ? setInterval(pollStatus, 2500) : null;
  if(automatic)void readTranscripts().then(pollStatus);
  return { health, readTranscripts, pollStatus, stop: () => { stopped = true; clearInterval(transcriptTimer); clearInterval(statusTimer); } };
}
