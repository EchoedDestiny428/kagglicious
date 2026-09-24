import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ConfigStore, describeJsonError, findJsonError, folderKey, isSafeHost, MAX_RECENT, sanitize, sanitizeRecent,
} from '../src/main/config.js';

const abs = (p) => path.resolve(p);

test('sanitize fills defaults from nothing', () => {
  const { config, warnings } = sanitize(undefined);
  assert.equal(config.folder, null);
  assert.deepEqual(config.recent, []);
  assert.deepEqual(config.sessions, {});
  assert.equal(config.claude.command, 'claude');
  assert.equal(config.terminal.fontSize, 13);
  assert.equal(config.ui.theme, null);
  assert.equal(config.jobs.host, '');
  assert.deepEqual(warnings, []);
});

test('sanitize clamps, drops wrong types and keeps unknown keys', () => {
  const { config } = sanitize({
    myNote: 'kept',
    terminal: { fontSize: 400, scrollback: 'lots' },
    ui: { theme: 'purple', confirmClose: 'yes' },
    claude: { command: '', args: ['--model', 'opus', 42] },
    jobs: { intervalSeconds: 1 },
    sessions: 'nope',
    window: { width: 10, height: 10 },
  });
  assert.equal(config.myNote, 'kept');
  assert.equal(config.terminal.fontSize, 32);
  assert.equal(config.terminal.scrollback, 10000);
  assert.equal(config.ui.theme, null);
  assert.equal(config.ui.confirmClose, true);
  assert.equal(config.claude.command, 'claude');
  assert.deepEqual(config.claude.args, ['--model', 'opus']);
  assert.equal(config.jobs.intervalSeconds, 10);
  assert.deepEqual(config.sessions, {});
  assert.equal(config.window, null);
});

test('recent folders: absolute, unique (case-insensitive on Windows), capped', () => {
  assert.deepEqual(sanitizeRecent(['/a/b', '/a/b/', 'relative/dir', '/c', null, 7], 'linux'), ['/a/b', '/c']);
  assert.deepEqual(sanitizeRecent(['C:\\Code\\X', 'c:\\code\\x\\', 'D:\\y'], 'win32'), ['C:\\Code\\X', 'D:\\y']);
  const many = Array.from({ length: 30 }, (_, i) => `/f${i}`);
  assert.equal(sanitizeRecent(many, 'linux').length, MAX_RECENT);
  assert.equal(folderKey('C:\\Code\\X\\', 'win32'), 'c:\\code\\x');
  assert.equal(folderKey('C:\\', 'win32'), 'c:\\');
  assert.equal(folderKey('/', 'linux'), '/');
});

test('the open folder leads the recent list and sessions follow it', () => {
  const { config } = sanitize({
    folder: '/work/b',
    recent: ['/work/a', '/work/b'],
    sessions: { '/work/a': { type: 'pane', cwd: '/work/a' }, '/work/gone': { type: 'pane', cwd: '/x' }, '/work/b': 'junk' },
  }, 'linux');
  assert.equal(config.folder, '/work/b');
  assert.deepEqual(config.recent, ['/work/b', '/work/a']);
  assert.deepEqual(Object.keys(config.sessions), ['/work/a'], 'unknown folders and non-objects are dropped');
  assert.equal(sanitize({ folder: 'relative' }, 'linux').config.folder, null);
});

test('ssh host validation refuses option injection', () => {
  assert.equal(isSafeHost('gpu-box'), true);
  assert.equal(isSafeHost('me@10.0.0.2'), true);
  assert.equal(isSafeHost('-oProxyCommand=calc'), false);
  assert.equal(isSafeHost('host; rm -rf ~'), false);
  assert.equal(isSafeHost(''), false);
  const { config, warnings } = sanitize({ jobs: { host: '-oProxyCommand=x', command: 'ls' } });
  assert.equal(config.jobs.host, '');
  assert.equal(warnings.length, 1);
});

test('findJsonError locates the first error', () => {
  assert.equal(findJsonError('{"a": [1, 2, {"b": null}], "c": "x"}'), -1);
  assert.equal(findJsonError('  {"a": 1,}'), 10);
  assert.equal(findJsonError('{"a": tru}'), 6);
  assert.equal(findJsonError('{"a": 1} x'), 9);
  assert.equal(findJsonError('{"a": "unterminated'), 19);
  assert.equal(findJsonError(''), 0);
  const winPath = '{\n  "path": "C:\\Users\\me"\n}';
  assert.equal(describeJsonError(winPath), 'line 2, column 14; write Windows paths with \\\\ or /');
  assert.equal(describeJsonError('{\n  "a": 1,\n}'), 'line 3, column 1');
  for (const good of ['{"s": "\\u00e9 \\n \\" \\\\"}', '[-0.5e+3, true, false, null]', '"x"']) {
    assert.equal(findJsonError(good), -1, good);
    JSON.parse(good);
  }
});

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-test-'));
  return path.join(dir, 'config.local.json');
}

test('ConfigStore: missing file means defaults, writes are atomic and debounced', async () => {
  const file = tempFile();
  const store = new ConfigStore(file, { debounceMs: 10 });
  store.load();
  assert.equal(store.error, null);
  assert.equal(fs.existsSync(file), false);
  store.update((c) => {
    c.folder = abs('/p');
  });
  await new Promise((r) => setTimeout(r, 40));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.recent, [abs('/p')]);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['config.local.json'], 'no temp files left');
});

test('ConfigStore never overwrites a file it cannot parse', () => {
  const file = tempFile();
  const broken = '{ "recent": [   oops ] }';
  fs.writeFileSync(file, broken);
  const store = new ConfigStore(file);
  store.load();
  assert.match(store.error, /syntax error \(line 1, column 17\)/);
  store.update((c) => {
    c.ui.theme = 'light';
  });
  assert.equal(store.flush(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), broken);

  fs.writeFileSync(file, '\uFEFF{"ui": {"theme": "dark"}}');
  store.load();
  assert.equal(store.error, null, 'recovers once fixed, BOM tolerated');
  assert.equal(store.config.ui.theme, 'dark');
});

test('ConfigStore saves again after a broken edit is undone', () => {
  const file = tempFile();
  const store = new ConfigStore(file);
  store.load();
  store.update((c) => {
    c.ui.theme = 'light';
  });
  store.flush();
  const good = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `${good}oops`);
  store.load();
  assert.ok(store.error);
  store.update((c) => {
    c.ui.theme = 'dark';
  });
  assert.equal(store.flush(), false);
  fs.writeFileSync(file, good); // byte-identical to what we last wrote
  store.load();
  assert.equal(store.error, null);
  assert.equal(store.flush(), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ui.theme, 'dark', 'change made while broken is kept');
});

test('ConfigStore picks up external edits', async () => {
  const file = tempFile();
  fs.writeFileSync(file, '{}');
  const store = new ConfigStore(file);
  store.load();
  store.watch();
  const changed = new Promise((resolve) => store.once('change', resolve));
  setTimeout(() => fs.writeFileSync(file, JSON.stringify({ terminal: { fontSize: 18 } })), 50);
  const config = await Promise.race([changed, new Promise((_, rej) => setTimeout(() => rej(new Error('no change event')), 3000))]);
  store.unwatch();
  assert.equal(config.terminal.fontSize, 18);
});
