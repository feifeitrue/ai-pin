import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationState } from '../../src/main/codex/state.mjs';

test('Stop delivery does not need an upstream connection and deduplicates by turn', () => {
  const state = new NotificationState();
  assert.equal(state.complete('turn-a'), true);
  assert.equal(state.complete('turn-a'), false);
  assert.equal(state.complete('turn-b'), true);
  assert.deepEqual(state.events.map(e => e.turnId), ['turn-a', 'turn-b']);
});

test('questions are independent, idempotent and cannot be revived by retries', () => {
  const state = new NotificationState();
  assert.equal(state.question('a', 'A'), true);
  assert.equal(state.question('a', 'A'), false);
  state.question('b', 'B');
  assert.equal(state.resolve('unknown'), false);
  assert.equal(state.resolve('a'), true);
  assert.equal(state.question('a', 'A'), false);
  assert.deepEqual(state.snapshot().pending, [{ id: 'b', summary: 'B' }]);
  assert.equal(state.snapshot().events.length, 3);
});

test('no false completion on startup; errors and interruptions are distinct', () => {
  const state = new NotificationState();
  state.observe({ id: 'old', status: 'completed' });
  assert.equal(state.sequence, 0);
  state.observe({ id: 'new', status: 'inProgress' });
  state.observe({ id: 'new', status: 'completed' });
  state.observe({ id: 'new', status: 'completed' });
  state.observe({ id: 'bad', status: 'failed' });
  state.observe({ id: 'stop', status: 'interrupted' });
  assert.deepEqual(state.events.map(e => e.kind), ['completed', 'failed', 'interrupted']);
});

test('turn completion does not silently clear unanswered questions', () => {
  const state = new NotificationState();
  state.question('a', 'A');
  state.observe({ id: 'x', status: 'inProgress' });
  state.observe({ id: 'x', status: 'completed' });
  assert.equal(state.pending.size, 1);
  assert.equal(state.snapshot(1).events[0].kind, 'completed');
});
