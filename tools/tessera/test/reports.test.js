// What the orchestrator learns about agents: last replies, background work,
// and the commands that act on several agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ControlServer } from '../src/main/control.js';
import { hookSettings } from '../src/main/launch.js';
import { lastReply } from '../src/main/sessions.js';
import { backgroundWork, checkInMessage, excerpt, TaskWatch } from '../src/renderer/checkins.js';

const SESSION = '22222222-2222-4222-8222-222222222222';

test('background work is read from the footer under the input box only', () => {
  const screen = (footer, above = 'Done. 2 shells were used earlier.') => [
    above,
    '✻ Churned for 9s · done 3:30 PM · 1 shell still running',
    '──────────────────────────────── nametest ─',
    '❯ ',
    '────────────────────────────────────────────',
    footer,
  ];
  assert.equal(backgroundWork(screen('  ⏸ manual mode on · 1 shell · ← for agents · ↓ to manage')), '1 shell');
  assert.equal(backgroundWork(screen('  ⏵⏵ auto mode on · 2 shells, 1 monitor · ↓ to manage')), '2 shells, 1 monitor');
  assert.equal(backgroundWork(screen('  ⏸ manual mode on · ? for shortcuts · ← for agents')), '', 'text above the box does not count');
  assert.equal(backgroundWork(['no input box on screen', '3 shells']), '', 'without the box, nothing is guessed');
  assert.equal(backgroundWork([]), '');
});

test('a finished agent check-in carries the start of its reply and its background work', () => {
  const watch = new TaskWatch();
  watch.started('2', 1000);
  const [event] = watch.check([{
    id: '2', name: 'gemma', state: 'idle', idleMs: 0, lastOutputAt: 5000, stoppedAt: 5000,
    report: excerpt('Submitted v3.\n\nCV 0.912, LB pending.'), background: '1 shell',
  }], 6000, 0);
  assert.equal(event.kind, 'stopped');
  const msg = checkInMessage([event]);
  assert.match(msg, /gemma \(pane 2\) has finished its turn \(1 shell still running, it will wake up/);
  assert.match(msg, /saying: "Submitted v3\. CV 0\.912, LB pending\."/);
  assert.match(msg, /tessera last/);
  assert.ok(!msg.includes('\n'), 'still one line');
  assert.equal(excerpt('x'.repeat(500)).length, 200);
  assert.equal(excerpt(null), '');
});

test('lastReply reads the final assistant message from a transcript', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-claude-'));
  const dir = path.join(root, 'projects', 'C--work-arc');
  fs.mkdirSync(dir, { recursive: true });
  const line = (o) => JSON.stringify(o);
  const assistant = (id, content) => line({ type: 'assistant', message: { id, role: 'assistant', content } });
  fs.writeFileSync(path.join(dir, `${SESSION}.jsonl`), [
    line({ type: 'user', message: { role: 'user', content: 'first task' } }),
    assistant('m1', [{ type: 'text', text: 'Old reply.' }]),
    line({ type: 'user', message: { role: 'user', content: 'second task' } }),
    assistant('m2', [{ type: 'text', text: 'Looking.' }]),
    assistant('m2', [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }]),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }),
    assistant('m3', [{ type: 'text', text: '## Report' }]),
    assistant('m3', [{ type: 'text', text: 'Line one of a long report.' }]),
    line({ type: 'cost-state' }),
    '',
  ].join('\n'));
  assert.equal(lastReply(SESSION, root), '## Report\n\nLine one of a long report.');
  assert.equal(lastReply('33333333-3333-4333-8333-333333333333', root), null, 'no transcript');
  assert.equal(lastReply('not-a-session', root), null);
});

test('agents get no prompt suggestions; the orchestrator keeps them', () => {
  assert.equal(hookSettings('agent').promptSuggestionEnabled, false);
  assert.ok(!('promptSuggestionEnabled' in hookSettings('orchestrator')));
  assert.deepEqual(Object.keys(hookSettings('agent').hooks).sort(), ['Notification', 'Stop', 'UserPromptSubmit']);
});

// Runs the `tessera` command against a control server that answers like the page.
function runCli(server, args, stdin = '') {
  return new Promise((resolve, reject) => {
    const cli = path.join(import.meta.dirname, '..', 'src', 'cli', 'tessera.mjs');
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, TESSERA_SOCKET: server.address, TESSERA_TOKEN: server.token, TESSERA_PANE: '1' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(stdin);
  });
}

test('tessera list, send all, last and close', async () => {
  const seen = [];
  const server = new ControlServer({
    handle: (cmd, args) => {
      seen.push({ cmd, args });
      if (cmd === 'list') {
        return {
          panes: [
            { id: '1', name: 'lab', role: 'orchestrator', state: 'idle', idle: 1, title: '', background: '' },
            { id: '2', name: 'gemma', role: 'agent', state: 'idle', idle: 90, title: 'training', background: '1 shell' },
            { id: '3', name: 'arc', role: 'agent', state: 'idle', idle: 90, title: '', background: '' },
          ],
          checkIns: 0,
        };
      }
      if (cmd === 'send') return args.id === 'all' ? ['2', '3'] : [args.id];
      if (cmd === 'last') return 'Full report\nsecond line';
      if (cmd === 'close') {
        if (!args.force) throw new Error('gemma is working. Add --force to close it anyway.');
        return 'gemma';
      }
      return null;
    },
  });
  await server.start();
  try {
    const list = await runCli(server, ['list']);
    assert.match(list.out, /2 +idle, 1 shell +gemma/);
    assert.match(list.out, /3 +idle +arc/);
    assert.match(list.out, /wakes up when it finishes/);

    const all = await runCli(server, ['send', 'all', 'pull', 'and', 'sync']);
    assert.equal(all.out.trim(), 'Sent to panes 2, 3.');
    assert.deepEqual(seen.find((s) => s.cmd === 'send').args, { id: 'all', text: 'pull and sync' });

    assert.equal((await runCli(server, ['last', '2'])).out, 'Full report\nsecond line\n');

    const busy = await runCli(server, ['close', '2']);
    assert.equal(busy.code, 1);
    assert.match(busy.err, /Add --force/);
    const forced = await runCli(server, ['close', '2', '--force']);
    assert.equal(forced.out.trim(), 'Closed gemma.');
    assert.equal((await runCli(server, ['close', '1'])).code, 1, 'a pane cannot close itself');
  } finally {
    server.stop();
  }
});
