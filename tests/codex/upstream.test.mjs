import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAppTools, isAppTools } from '../../src/main/codex/upstream.mjs';
test('expired pipe resolves to the sole app-tools service, ignoring browser services', async () => {
  const found = await findAppTools('dead', async p => { if (p === 'dead') throw Error('ENOENT'); return p === 'app'; }, async () => ['browser', 'app']);
  assert.equal(found, 'app');
});
test('ambiguous or absent endpoints fail rather than send to an arbitrary service', async () => {
  await assert.rejects(findAppTools(null, async () => true, async () => ['a', 'b']), /Multiple/);
  await assert.rejects(findAppTools(null, async () => false, async () => ['browser']), /unavailable/);
});
test('endpoint recognition requires the Codex namespace and send capability', () => {
  assert.equal(isAppTools({ result: { tools: [{ name: 'send_message_to_thread', namespace: 'browser' }] } }), false);
  assert.equal(isAppTools({ result: { tools: [{ name: 'send_message_to_thread', namespace: 'codex_app' }] } }), true);
});
