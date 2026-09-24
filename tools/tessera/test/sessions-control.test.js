import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ControlServer } from '../src/main/control.js';
import { listSubfolders } from '../src/main/folders.js';
import { hasTranscript } from '../src/main/sessions.js';

const A = '11111111-1111-4111-8111-111111111111';

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('transcript lookup', () => {
  const root = tempDir('tessera-claude-');
  const dir = path.join(root, 'projects', '-work-repo');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(hasTranscript(A, root), false);
  fs.writeFileSync(path.join(dir, `${A}.jsonl`), '{}\n');
  assert.equal(hasTranscript(A, root), true);
  assert.equal(hasTranscript('22222222-2222-4222-8222-222222222222', root), false);
  assert.equal(hasTranscript('../../etc/passwd', root), false);
  assert.equal(hasTranscript(A, path.join(root, 'missing')), false);
});

test('subfolders: sorted naturally, hidden and generated folders skipped, files ignored', () => {
  const root = tempDir('tessera-folders-');
  for (const d of ['beta', 'Alpha', 'v10', 'v2', '.git', '.venv', 'node_modules', '__pycache__']) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  assert.deepEqual(listSubfolders(root).map((p) => path.basename(p)), ['Alpha', 'beta', 'v2', 'v10']);
  assert.ok(listSubfolders(root).every((p) => path.isAbsolute(p)));
  assert.deepEqual(listSubfolders(path.join(root, 'beta')), []);
  assert.throws(() => listSubfolders(path.join(root, 'missing')), { code: 'ENOENT' });
});

function ask(address, payload, raw = false) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(address);
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(raw ? payload : `${JSON.stringify(payload)}\n`));
    sock.on('data', (d) => {
      buf += d;
    });
    sock.on('end', () => resolve(JSON.parse(buf)));
    sock.on('error', reject);
  });
}

test('control server requires the token and relays commands', async () => {
  const seen = [];
  const server = new ControlServer({
    handle: (cmd, args, from) => {
      seen.push({ cmd, args, from });
      if (cmd === 'boom') throw new Error('nope');
      return { echoed: args };
    },
  });
  await server.start();
  try {
    assert.deepEqual(await ask(server.address, { token: 'wrong', cmd: 'list' }), { error: 'Not authorized' });
    assert.deepEqual(await ask(server.address, { cmd: 'list' }), { error: 'Not authorized' });
    assert.deepEqual(await ask(server.address, 'not json\n', true), { error: 'Bad request' });
    assert.equal(seen.length, 0);
    assert.deepEqual(await ask(server.address, { token: server.token, cmd: 'list', args: { a: 1 }, from: '3' }), { ok: true, result: { echoed: { a: 1 } } });
    assert.deepEqual(seen, [{ cmd: 'list', args: { a: 1 }, from: '3' }]);
    assert.deepEqual(await ask(server.address, { token: server.token, cmd: 'boom' }), { error: 'nope' });
  } finally {
    server.stop();
  }
});
