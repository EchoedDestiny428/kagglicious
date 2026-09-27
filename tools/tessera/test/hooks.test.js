import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/main/config.js';
import { buildCommand, hookSettings } from '../src/main/launch.js';
import { hookState, notificationText, TaskWatch } from '../src/renderer/checkins.js';

const MIN = 60000;

test('hook events map to pane states', () => {
  assert.equal(hookState({ event: 'Stop' }), 'stopped');
  assert.equal(hookState({ event: 'UserPromptSubmit' }), 'prompt');
  assert.equal(hookState({ event: 'Notification', type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }), 'needs-input');
  assert.equal(hookState({ event: 'Notification', message: 'Claude needs your permission to use Write' }), 'needs-input', 'older versions send no type');
  assert.equal(hookState({ event: 'Notification', type: 'idle_prompt', message: 'Claude is waiting for your input' }), null);
  assert.equal(hookState({ event: 'Notification', message: 'Claude is waiting for your input' }), null);
  assert.equal(hookState({ event: 'PreToolUse' }), null);
});

test('with hooks, a stop is reported at once and a question once per wait', () => {
  const w = new TaskWatch();
  w.started('2', 1000);
  const asking = { id: '2', name: 'fib', state: 'needs-input', idleMs: 0, lastOutputAt: 1500, stoppedAt: 0, message: 'Allow Bash?' };
  assert.deepEqual(w.check([asking], 2000, 5 * MIN), [{ id: '2', name: 'fib', minutes: 1, kind: 'needs-input', message: 'Allow Bash?' }]);
  assert.deepEqual(w.check([asking], 4000, 5 * MIN), [], 'not repeated while still waiting');
  assert.deepEqual(w.check([{ ...asking, state: 'working', message: '' }], 5000, 5 * MIN), []);
  const done = w.check([{ ...asking, state: 'working', stoppedAt: 6000, message: '' }], 6000, 5 * MIN);
  assert.deepEqual(done.map((e) => e.kind), ['stopped'], 'no idle wait needed with a Stop hook');
  assert.equal(w.size, 0);
});

test('a Stop from before the task does not count', () => {
  const w = new TaskWatch();
  w.started('2', 5000);
  const before = { id: '2', name: 'fib', state: 'idle', idleMs: 60000, lastOutputAt: 100, stoppedAt: 4000 };
  assert.deepEqual(w.check([before], 70000, 5 * MIN), []);
});

test('notifications gather events into one message', () => {
  assert.deepEqual(notificationText([{ name: 'fib', kind: 'needs-input', message: 'Claude needs your permission to use Bash' }]),
    { title: 'fib needs you', body: 'Claude needs your permission to use Bash' });
  assert.deepEqual(notificationText([{ name: 'fib', kind: 'needs-input' }]), { title: 'fib needs you', body: 'Waiting for your input' });
  assert.deepEqual(notificationText([{ name: 'fib', kind: 'stopped', message: 'Done: fib.py prints 0..610' }]),
    { title: 'fib finished', body: 'Done: fib.py prints 0..610' });
  assert.deepEqual(notificationText([{ name: 'fib', kind: 'stopped' }, { name: 'primes', kind: 'needs-input' }, { name: 'web', kind: 'needs-input' }]),
    { title: '2 sessions need you', body: 'primes, web; 1 more finished' });
  assert.deepEqual(notificationText([{ name: 'fib', kind: 'stopped' }, { name: 'primes', kind: 'stopped' }]),
    { title: '2 sessions finished', body: 'fib, primes' });
});

test('claude sessions get the hooks file, unless claude.args has its own --settings', () => {
  const { hooks } = hookSettings();
  assert.deepEqual(Object.keys(hooks).sort(), ['Notification', 'Stop', 'UserPromptSubmit']);
  assert.equal(hooks.Stop[0].hooks[0].command, 'tessera hook');
  const env = { PATH: '' };
  const text = (c) => JSON.stringify(c);
  const config = sanitize({ claude: { command: process.execPath } }).config;
  assert.ok(text(buildCommand({ role: 'agent', hooksFile: '/tmp/hooks.json' }, config, env)).includes('/tmp/hooks.json'));
  assert.ok(!text(buildCommand({ role: 'agent' }, config, env)).includes('--settings'));
  const shell = sanitize({ shell: { command: process.execPath } }).config;
  assert.ok(!text(buildCommand({ role: 'shell', hooksFile: '/tmp/hooks.json' }, shell, env)).includes('hooks.json'));
  const own = sanitize({ claude: { command: process.execPath, args: ['--settings', 'mine.json'] } }).config;
  assert.ok(!text(buildCommand({ role: 'agent', hooksFile: '/tmp/hooks.json' }, own, env)).includes('/tmp/hooks.json'));
});
