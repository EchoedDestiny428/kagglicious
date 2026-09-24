import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/main/config.js';
import { settingFlags } from '../src/main/launch.js';
import { checkInMessage, DONE_AFTER_IDLE_MS, TaskWatch } from '../src/renderer/checkins.js';

const MIN = 60000;
const agent = (id, state, { idleMs = 0, lastOutputAt = 0 } = {}) => ({ id, name: `a${id}`, state, idleMs, lastOutputAt });

test('only agents with a task are reported', () => {
  const w = new TaskWatch();
  assert.deepEqual(w.check([agent('2', 'idle', { idleMs: 60000, lastOutputAt: 5 })], 10, MIN), []);
});

test('a task is reported once, when the agent goes quiet after working', () => {
  const w = new TaskWatch();
  w.started('2', 1000);
  // Still working: nothing yet.
  assert.deepEqual(w.check([agent('2', 'working', { lastOutputAt: 3000 })], 3000, 5 * MIN), []);
  // Quiet, but not for long enough.
  assert.deepEqual(w.check([agent('2', 'idle', { idleMs: 1000, lastOutputAt: 3000 })], 4000, 5 * MIN), []);
  const events = w.check([agent('2', 'idle', { idleMs: DONE_AFTER_IDLE_MS, lastOutputAt: 3000 })], 8000, 5 * MIN);
  assert.deepEqual(events.map((e) => e.kind), ['stopped']);
  assert.equal(w.size, 0);
  assert.deepEqual(w.check([agent('2', 'idle', { idleMs: 99999, lastOutputAt: 3000 })], 20000, 5 * MIN), []);
});

test('an agent that never reacted is not reported as stopped', () => {
  const w = new TaskWatch();
  w.started('2', 1000);
  assert.deepEqual(w.check([agent('2', 'idle', { idleMs: 60000, lastOutputAt: 500 })], 61000, 5 * MIN), []);
});

test('progress check-ins while an agent keeps working', () => {
  const w = new TaskWatch();
  w.started('3', 0);
  assert.deepEqual(w.check([agent('3', 'working')], 4 * MIN, 5 * MIN), []);
  const first = w.check([agent('3', 'working')], 5 * MIN, 5 * MIN);
  assert.deepEqual(first, [{ id: '3', name: 'a3', kind: 'working', minutes: 5 }]);
  assert.deepEqual(w.check([agent('3', 'working')], 7 * MIN, 5 * MIN), [], 'not again until another interval');
  assert.equal(w.check([agent('3', 'working')], 10 * MIN, 5 * MIN).length, 1);
  assert.deepEqual(w.check([agent('3', 'working')], 30 * MIN, 0), [], 'interval 0 turns progress reports off');
});

test('exits are reported; closed agents are forgotten', () => {
  const w = new TaskWatch();
  w.started('2', 0);
  w.started('3', 0);
  const events = w.check([agent('2', 'exited')], 1000, MIN);
  assert.deepEqual(events.map((e) => [e.id, e.kind]), [['2', 'exited']]);
  assert.equal(w.size, 0, 'agent 3 is gone from the list, so its task is dropped');
});

test('when the orchestrator looks itself, it is not told again', () => {
  const w = new TaskWatch();
  w.started('2', 0);
  w.looked('2', false, 4 * MIN); // still working: the progress clock restarts
  assert.deepEqual(w.check([agent('2', 'working')], 5 * MIN, 5 * MIN), []);
  w.looked('2', true, 6 * MIN); // it saw the result
  assert.equal(w.size, 0);
});

test('check-in message is one line and says what to do', () => {
  const msg = checkInMessage([
    { id: '2', name: 'fib', kind: 'stopped', minutes: 3 },
    { id: '3', name: 'primes', kind: 'working', minutes: 5 },
  ]);
  assert.ok(msg.startsWith('[tessera] Check-in: '));
  assert.ok(!msg.includes('\n'));
  assert.match(msg, /fib \(pane 2\) has stopped/);
  assert.match(msg, /primes \(pane 3\) is still working \(5 min\)/);
  assert.match(msg, /tell the user when everything is done/);
  assert.match(checkInMessage([{ id: '3', name: 'p', kind: 'working', minutes: 5 }]), /step in only if/);
});

test('settings become claude flags and replace the same flags in claude.args', () => {
  const claude = sanitize({ claude: { model: 'opus', effort: 'max', permissionMode: 'plan' } }).config.claude;
  assert.deepEqual(
    settingFlags(claude, ['--model', 'sonnet', '--permission-mode=auto', '--verbose']),
    ['--verbose', '--model', 'opus', '--effort', 'max', '--permission-mode', 'plan'],
  );
  const none = sanitize({}).config.claude;
  assert.deepEqual(settingFlags(none, ['--model', 'sonnet']), ['--model', 'sonnet'], 'empty settings leave args alone');
  assert.equal(sanitize({ claude: { permissionMode: 'bypassPermissions' } }).config.claude.permissionMode, '');
  assert.equal(sanitize({ claude: { model: 'opus; rm -rf /' } }).config.claude.model, '');
  assert.equal(sanitize({ orchestrator: { checkInterval: 0 } }).config.orchestrator.checkInterval, 1);
});
