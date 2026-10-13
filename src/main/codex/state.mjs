// State is scoped to one bound chat. Explicit question IDs prevent duplicate pings.
export class NotificationState {
  pending = new Map();
  seen = new Map();
  events = [];
  sequence = 0;
  lastTurn = null;
  initialized = false;
  completedTurns = new Set();

  restore(snapshot) {
    if (!Number.isInteger(snapshot.sequence) || !Array.isArray(snapshot.pending) || !Array.isArray(snapshot.events)) throw new Error('Invalid notification snapshot');
    this.sequence = snapshot.sequence;
    this.pending = new Map(snapshot.pending.map(p => [p.id, p.summary]));
    this.events = snapshot.events.map(e => ({ ...e }));
    this.seen = new Map(this.events.filter(e => e.id).map(e => [e.id, e.kind === 'input-resolved' ? 'resolved' : 'pending']));
    for (const [id] of this.pending) this.seen.set(id, 'pending');
    this.completedTurns = new Set(this.events.filter(e => e.kind === 'completed').map(e => e.turnId));
    this.lastTurn = snapshot.turn;
    this.initialized = true;
  }

  complete(turnId) {
    if (this.completedTurns.has(turnId)) return false;
    this.completedTurns.add(turnId);
    this.lastTurn = { id: turnId, status: 'completed' };
    this.emit('completed', { turnId });
    return true;
  }

  emit(kind, fields = {}) {
    const event = { sequence: ++this.sequence, kind, ...fields, at: new Date().toISOString() };
    this.events.push(event);
    this.events = this.events.slice(-200);
    return event;
  }

  question(id, summary) {
    if (this.seen.has(id)) return false;
    this.seen.set(id, 'pending');
    this.pending.set(id, summary);
    this.emit('needs-input', { id, summary });
    return true;
  }

  resolve(id) {
    if (!this.pending.has(id)) return false;
    this.pending.delete(id);
    this.seen.set(id, 'resolved');
    this.emit('input-resolved', { id });
    return true;
  }

  observe(turn) {
    if (!turn) return;
    const old = this.lastTurn;
    this.lastTurn = { id: turn.id, status: turn.status };
    if (!this.initialized) { this.initialized = true; return; }
    if (old?.id === turn.id && old?.status === turn.status) return;
    if (turn.status === 'completed') this.emit('completed', { turnId: turn.id });
    else if (turn.status === 'failed' || turn.status === 'interrupted') this.emit(turn.status, { turnId: turn.id });
  }

  snapshot(after = 0) {
    return { sequence: this.sequence, pending: [...this.pending].map(([id, summary]) => ({ id, summary })),
      events: this.events.filter(e => e.sequence > after), turn: this.lastTurn };
  }
}
