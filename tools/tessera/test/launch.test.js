import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/main/config.js';
import {
  buildCommand, childEnv, defaultShell, ORCHESTRATION_HINT, quoteCmdArg, resolveExecutable, stripSessionFlags, wrapForPlatform,
} from '../src/main/launch.js';

test('childEnv drops launcher state and keeps user settings', () => {
  const env = childEnv({
    PATH: '/bin',
    HOME: '/home/me',
    npm_config_prefix: '/x',
    INIT_CWD: '/y',
    CLAUDECODE: '1',
    CLAUDE_CODE_SESSION_ID: 'abc',
    CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
    CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe',
    ANTHROPIC_MODEL: 'opus',
    TERM_PROGRAM: 'vscode',
    VSCODE_GIT_IPC_HANDLE: 'x',
    GIT_ASKPASS: '/vscode/askpass.sh',
    ELECTRON_RUN_AS_NODE: '1',
    TESSERA_TOKEN: 'outer',
    ORIGINAL_XDG_CURRENT_DESKTOP: 'GNOME',
    ORIGINAL_PATH: '/usr/bin',
    XDG_CURRENT_DESKTOP: 'Unity',
  }, 'linux');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\\Git\\bin\\bash.exe');
  assert.equal(env.ANTHROPIC_MODEL, 'opus');
  for (const k of ['npm_config_prefix', 'INIT_CWD', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_TOKEN',
    'VSCODE_GIT_IPC_HANDLE', 'GIT_ASKPASS', 'ELECTRON_RUN_AS_NODE', 'TESSERA_TOKEN', 'ORIGINAL_XDG_CURRENT_DESKTOP', 'ORIGINAL_PATH']) {
    assert.equal(k in env, false, k);
  }
  assert.equal(env.XDG_CURRENT_DESKTOP, 'GNOME');
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.TERM_PROGRAM, 'tessera');
});

test('childEnv matches names case-insensitively on Windows', () => {
  const env = childEnv({ Path: 'C:\\bin', Npm_Config_Cache: 'x', ClaudeCode: '1' }, 'win32');
  assert.deepEqual(Object.keys(env).sort(), ['COLORTERM', 'Path', 'TERM', 'TERM_PROGRAM']);
});

test('resolveExecutable follows PATH and PATHEXT', () => {
  const files = new Set(['C:\\npm\\claude.cmd', 'C:\\npm\\claude', 'C:\\tools\\pwsh.exe', '/usr/local/bin/claude']);
  const exists = (p) => files.has(p);
  const winEnv = { Path: 'C:\\tools;"C:\\npm"', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(resolveExecutable('claude', winEnv, 'win32', exists), 'C:\\npm\\claude.cmd', 'extension-less file is skipped');
  assert.equal(resolveExecutable('pwsh', winEnv, 'win32', exists), 'C:\\tools\\pwsh.exe');
  assert.equal(resolveExecutable('C:\\tools\\pwsh', winEnv, 'win32', exists), 'C:\\tools\\pwsh.exe');
  assert.equal(resolveExecutable('missing', winEnv, 'win32', exists), null);
  assert.equal(resolveExecutable('claude', { PATH: '/usr/bin:/usr/local/bin' }, 'linux', exists), '/usr/local/bin/claude');
  assert.equal(resolveExecutable('', {}, 'linux', exists), null);
});

test('batch files run through cmd.exe with safe quoting', () => {
  const out = wrapForPlatform('C:\\Program Files\\npm\\claude.cmd', ['--session-id', 'abc'], { ComSpec: 'C:\\Windows\\cmd.exe' }, 'win32');
  assert.equal(out.file, 'C:\\Windows\\cmd.exe');
  assert.deepEqual(out.args, ['/d', '/s', '/c', '""C:\\Program Files\\npm\\claude.cmd" --session-id abc"']);
  assert.equal(quoteCmdArg('a&b'), '"a&b"');
  assert.equal(quoteCmdArg('say "hi"'), '"say ""hi"""');
  assert.equal(quoteCmdArg(''), '""');
  assert.deepEqual(wrapForPlatform('/bin/claude', ['x'], {}, 'linux'), { file: '/bin/claude', args: ['x'] });
});

test('session flags from the config never clash with ours', () => {
  assert.deepEqual(
    stripSessionFlags(['--model', 'opus', '--resume', 'abc', '-c', '--session-id=1', '--fork-session', '-r', '--verbose']),
    ['--model', 'opus', '--verbose'],
  );
});

test('buildCommand: orchestrator, agent and shell', () => {
  const env = { PATH: '/bin', SHELL: '/bin/zsh' };
  // resolveExecutable checks the real filesystem, so point at a file that exists on any OS.
  const config = sanitize({
    claude: { command: process.execPath, args: ['--model', 'opus', '--continue'] },
    shell: { command: process.execPath, args: ['-i'] },
  }).config;
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const text = (cmd) => JSON.stringify(cmd);

  const orchestrator = buildCommand({ role: 'orchestrator', session: { id, resume: false } }, config, env);
  assert.ok(text(orchestrator).includes('--session-id'));
  assert.ok(text(orchestrator).includes(ORCHESTRATION_HINT.slice(0, 30)), 'only the orchestrator is told about tessera');
  assert.ok(!text(orchestrator).includes('--continue'));

  const agent = buildCommand({ role: 'agent', session: { id, resume: true } }, config, env);
  assert.ok(text(agent).includes('--resume'));
  assert.ok(!text(agent).includes('append-system-prompt'));

  const bad = buildCommand({ role: 'agent', session: { id: 'not-a-uuid', resume: true } }, config, env);
  assert.ok(!text(bad).includes('not-a-uuid'));

  const noHint = sanitize({ claude: { command: process.execPath, orchestration: false } }).config;
  assert.ok(!text(buildCommand({ role: 'orchestrator' }, noHint, env)).includes('append-system-prompt'));

  const shell = buildCommand({ role: 'shell' }, config, env);
  assert.ok(text(shell).includes('-i') && !text(shell).includes('--model'));

  assert.throws(() => buildCommand({ role: 'agent' }, sanitize({ claude: { command: 'definitely-not-installed-xyz' } }).config, env),
    /not found on PATH. Set claude.command/);
  assert.throws(() => buildCommand({ role: 'shell' }, sanitize({ shell: { command: 'no-such-shell-xyz' } }).config, env),
    /Set shell.command/);
});

test('default shell per platform', () => {
  assert.deepEqual(defaultShell({ SHELL: '/usr/bin/fish' }, 'linux'), { command: '/usr/bin/fish', args: [] });
  assert.deepEqual(defaultShell({}, 'darwin'), { command: '/bin/zsh', args: ['-l'] });
  assert.equal(defaultShell({ PATH: '' }, 'win32').command, 'powershell.exe');
});
