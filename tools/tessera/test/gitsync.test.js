import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStatus, syncRoot, syncStatus, unsynced } from '../src/main/gitsync.js';

test('parseStatus reads branch counts and changed files', () => {
  const text = [
    '# branch.oid 0123abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb fib/fib.py',
    '? notes.md',
    'u UU N... 1 2 3 4 a b c conflict.py',
  ].join('\n');
  assert.deepEqual(parseStatus(text), { dirty: 3, ahead: 2, behind: 1, upstream: true });
  assert.deepEqual(parseStatus('# branch.head main\n'), { dirty: 0, ahead: 0, behind: 0, upstream: false });
  assert.equal(unsynced({ dirty: 0, ahead: 0, behind: 0 }), false);
  assert.equal(unsynced({ dirty: 0, ahead: 0, behind: 3 }), true);
  assert.equal(unsynced(null), false);
});

test('syncRoot only accepts repos with sync.sh; syncStatus sees changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-sync-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  fs.mkdirSync(path.join(dir, 'fib'));
  assert.equal(await syncRoot(path.join(dir, 'fib')), null, 'no sync.sh');
  fs.writeFileSync(path.join(dir, 'sync.sh'), '#!/bin/sh\n');
  const root = await syncRoot(path.join(dir, 'fib'));
  assert.equal(path.resolve(root).toLowerCase(), path.resolve(dir).toLowerCase());
  const status = await syncStatus(root);
  assert.equal(status.dirty, 1, 'sync.sh itself is untracked');
  assert.equal(status.upstream, false);
  assert.equal(await syncRoot(os.tmpdir()), null, 'not a repo');
});
