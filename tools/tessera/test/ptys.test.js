import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PtyManager } from '../src/main/ptys.js';

// A fake pty: records writes and kills; exits when told to.
function fakeSpawn(behaviour = {}) {
  const procs = [];
  const spawn = () => {
    const p = {
      writes: [],
      killed: false,
      exitHandlers: [],
      onData() {},
      onExit(fn) {
        this.exitHandlers.push(fn);
      },
      exit(code = 0) {
        for (const fn of this.exitHandlers) fn({ exitCode: code });
      },
      write(data) {
        this.writes.push(data);
        behaviour.onWrite?.(this);
      },
      kill() {
        this.killed = true;
        setImmediate(() => this.exit(1));
      },
      resize() {},
    };
    procs.push(p);
    return p;
  };
  return { spawn, procs };
}

const manager = (spawn) => new PtyManager({ onData() {}, onExit() {}, spawn });

test('stop presses the exit keys and resolves when the process quits', async () => {
  // Exits on the second Ctrl+C, like claude.
  const { spawn, procs } = fakeSpawn({ onWrite: (p) => p.writes.length === 2 && setImmediate(() => p.exit(0)) });
  const m = manager(spawn);
  const { id } = m.spawn({ file: 'claude', args: [], meta: { exitKeys: '\x03' } });
  assert.equal(m.size, 1);
  const done = m.stop(id, 5000);
  assert.equal(m.size, 0, 'counts as gone at once');
  await done;
  assert.deepEqual(procs[0].writes, ['\x03', '\x03']);
  assert.equal(procs[0].killed, false, 'quit on its own; never killed');
});

test('stop kills a process that does not quit in time', async () => {
  const { spawn, procs } = fakeSpawn();
  const m = manager(spawn);
  const { id } = m.spawn({ file: 'claude', args: [], meta: { exitKeys: '\x03' } });
  await m.stop(id, 50);
  assert.equal(procs[0].killed, true);
  assert.ok(procs[0].writes.length >= 1);
});

test('processes without exit keys (shells) are killed at once; stopAll waits for all', async () => {
  const { spawn, procs } = fakeSpawn({ onWrite: (p) => p.writes.length === 2 && setImmediate(() => p.exit(0)) });
  const m = manager(spawn);
  m.spawn({ file: 'sh', args: [], meta: {} });
  m.spawn({ file: 'claude', args: [], meta: { exitKeys: '\x03' } });
  await m.stopAll(5000);
  assert.equal(procs[0].killed, true);
  assert.equal(procs[1].killed, false);
  assert.equal(m.sessions.size, 0);
  await m.stop(999); // unknown id: nothing to do
});
