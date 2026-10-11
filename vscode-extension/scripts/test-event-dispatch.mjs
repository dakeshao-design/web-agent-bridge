import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bridgePath = fileURLToPath(new URL('../src/services/AgentHostBridge.ts', import.meta.url));
const { outputFiles } = await build({
  entryPoints: [bridgePath],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node18',
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
const { AgentHostBridge, consumeEventBatch } = await import(moduleUrl);

const bridge = new AgentHostBridge({});
let responseCalls = 0;
let failResponse = true;
bridge.onChatMessage(async () => {
  throw new Error('chat sync failed');
});
bridge.onResponse(async (agentId, text, key) => {
  assert.equal(agentId, 'test-agent');
  assert.equal(text, 'tool response');
  assert.equal(key, '');
  if (failResponse) throw new Error('response handler failed');
  responseCalls++;
});
const toolEvent = {
  seq: 10,
  type: 'chat',
  agentId: 'test-agent',
  role: 'agent',
  key: '',
  text: 'tool response',
};
const callbackFailures = [];
const failedToolBatch = await consumeEventBatch(
  [toolEvent],
  0,
  (event) => bridge.dispatch(event),
  (event, error) => callbackFailures.push({ seq: event.seq, message: error.message })
);
assert.equal(failedToolBatch.cursor, 0, 'response failures must leave the tool event pending');
assert.equal(failedToolBatch.failedEvent.seq, 10);
assert.deepEqual(callbackFailures, [{ seq: 10, message: 'response handler failed' }]);

failResponse = false;
const retriedToolBatch = await consumeEventBatch(
  [toolEvent],
  failedToolBatch.cursor,
  (event) => bridge.dispatch(event),
  (event, error) => callbackFailures.push({ seq: event.seq, message: error.message })
);
assert.equal(retriedToolBatch.cursor, 10);
assert.equal(responseCalls, 1, 'chat sync failures must not block empty-key tool responses');
bridge.onChatMessage(async () => undefined);
await bridge.dispatch({
  seq: 11,
  type: 'chat',
  agentId: 'test-agent',
  role: 'agent',
  key: 'conversation-1',
  text: 'ordinary chat message',
});
assert.equal(responseCalls, 1, 'keyed chat messages must not trigger tool response handling');

const attempted = [];
const failures = [];
const initialBatch = await consumeEventBatch(
  [{ seq: 1 }, { seq: 2 }, { seq: 3 }],
  0,
  async (event) => {
    attempted.push(event.seq);
    if (event.seq === 2) throw new Error('handler failed');
  },
  (event, error) => failures.push({ seq: event.seq, message: error.message })
);
assert.equal(initialBatch.cursor, 1, 'failed events must not advance the cursor');
assert.equal(initialBatch.processed, 1);
assert.equal(initialBatch.failedEvent.seq, 2);
assert.deepEqual(attempted, [1, 2], 'later events must remain unprocessed after failure');
assert.deepEqual(failures, [{ seq: 2, message: 'handler failed' }]);

const retriedBatch = await consumeEventBatch(
  [{ seq: 2 }, { seq: 3 }],
  initialBatch.cursor,
  async (event) => attempted.push(event.seq),
  (event, error) => failures.push({ seq: event.seq, message: error.message })
);
assert.equal(retriedBatch.cursor, 3, 'a retry should consume the failed and subsequent events');
assert.equal(retriedBatch.processed, 2);
assert.deepEqual(attempted, [1, 2, 2, 3]);

console.log('test-event-dispatch: ok');