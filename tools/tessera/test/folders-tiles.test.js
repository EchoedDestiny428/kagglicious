import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInside, listDir } from '../src/main/folders.js';
import { agentStateText, gridLayout, gridShape, readSaved } from '../src/renderer/tiles.js';

test('file tree listing: folders first, natural order, .git hidden', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-tree-'));
  for (const d of ['src', '.git', '.github', 'node_modules']) fs.mkdirSync(path.join(root, d));
  for (const f of ['b.txt', 'a10.md', 'a2.md', '.env', 'README.md']) fs.writeFileSync(path.join(root, f), '');
  const { entries, truncated } = listDir(root);
  assert.equal(truncated, false);
  assert.deepEqual(entries, [
    { name: '.github', dir: true },
    { name: 'node_modules', dir: true },
    { name: 'src', dir: true },
    { name: '.env', dir: false },
    { name: 'a2.md', dir: false },
    { name: 'a10.md', dir: false },
    { name: 'b.txt', dir: false },
    { name: 'README.md', dir: false },
  ]);
});

test('isInside keeps the file tree within the open folder', () => {
  assert.equal(isInside('/work/repo/src/a.js', '/work/repo', 'linux'), true);
  assert.equal(isInside('/work/repo', '/work/repo', 'linux'), true);
  assert.equal(isInside('/work/repo-other', '/work/repo', 'linux'), false);
  assert.equal(isInside('/work/repo/../secret', '/work/repo', 'linux'), false);
  assert.equal(isInside('/etc/passwd', '/work/repo', 'linux'), false);
  assert.equal(isInside('C:\\Work\\Repo\\src', 'c:\\work\\repo', 'win32'), true, 'case-insensitive on Windows');
  assert.equal(isInside('D:\\Work\\Repo', 'C:\\Work\\Repo', 'win32'), false);
});

test('gridShape keeps tiles roughly square', () => {
  assert.deepEqual(gridShape(0, 1.5), { cols: 1, rows: 1 });
  assert.deepEqual(gridShape(1, 1.5), { cols: 1, rows: 1 });
  assert.deepEqual(gridShape(2, 1.5), { cols: 2, rows: 1 });
  assert.deepEqual(gridShape(2, 0.6), { cols: 1, rows: 2 }, 'a tall area stacks');
  assert.deepEqual(gridShape(4, 1.4), { cols: 2, rows: 2 });
  assert.deepEqual(gridShape(6, 1.5), { cols: 3, rows: 2 });
  assert.deepEqual(gridShape(3, NaN), { cols: 2, rows: 2 });
  for (let n = 1; n < 30; n++) {
    const { cols, rows } = gridShape(n, 1.3);
    assert.ok(cols * rows >= n && cols <= n, `n=${n}`);
  }
});

test('readSaved tolerates anything in the config file', () => {
  assert.deepEqual(readSaved(null), { orchestrator: null, agents: [], rulesSeen: {} });
  assert.deepEqual(readSaved({ type: 'split', children: [] }), { orchestrator: null, agents: [], rulesSeen: {} });
  assert.deepEqual(readSaved({
    orchestrator: 'abc',
    agents: [{ cwd: '/a', sessionId: 'x' }, { cwd: '' }, null, { cwd: '/b', sessionId: 5 }, 'nope'],
  }), { orchestrator: 'abc', agents: [{ cwd: '/a', sessionId: 'x' }, { cwd: '/b', sessionId: null }], rulesSeen: {} });
});

test('gridLayout keeps tiles above a minimum size and scrolls past it', () => {
  const opts = { minW: 300, minH: 200, gap: 8 };
  assert.deepEqual(gridLayout(4, 1400, 900, opts), { cols: 2, rows: 2, scroll: false });
  // Many agents: columns are capped by the width, rows overflow the height.
  const many = gridLayout(20, 1400, 900, opts);
  assert.equal(many.cols, 4);
  assert.equal(many.rows, 5);
  assert.equal(many.scroll, true);
  // A narrow box gets one column.
  assert.deepEqual(gridLayout(3, 250, 900, opts), { cols: 1, rows: 3, scroll: false });
  assert.deepEqual(gridLayout(1, 0, 0, opts), { cols: 1, rows: 1, scroll: true }, 'an unmeasured box does not throw');
});

test('agentStateText is short and says how long an agent has been idle', () => {
  assert.equal(agentStateText('working'), 'Working');
  assert.equal(agentStateText('needs-input'), 'Needs you');
  assert.equal(agentStateText('idle', 20), 'Idle');
  assert.equal(agentStateText('idle', 4 * 60 + 5), 'Idle 4m');
  assert.equal(agentStateText('idle', 3 * 3600), 'Idle 3h');
  assert.equal(agentStateText('exited'), 'Exited');
  assert.equal(agentStateText('starting'), 'Starting');
});
