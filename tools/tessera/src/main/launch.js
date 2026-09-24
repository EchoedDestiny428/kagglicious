// Turns a pane request into { file, args } for node-pty, and cleans its environment.
import fs from 'node:fs';
import path from 'node:path';

// Variables that describe the process that launched Tessera, not the
// terminal a pane is. Leaking them misleads the child: npm_config_* changes
// what npm does inside the pane, CLAUDECODE makes claude think it is nested,
// TERM_PROGRAM=vscode turns on IDE integration, and so on.
// The CLAUDE_* entries are set per session by a running claude (for example
// when Tessera is started from a Claude Code terminal); settings a user puts
// in their own environment, like CLAUDE_CODE_GIT_BASH_PATH, are kept.
const STRIP_EXACT = new Set([
  // Git Bash's copy of the PATH it started with; login shells rebuild PATH
  // from it, which would drop the folder that holds the `tessera` command.
  'ORIGINAL_PATH',
  'INIT_CWD',
  'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'TESSERA_SOCKET', 'TESSERA_TOKEN', 'TESSERA_PANE', 'TESSERA_NODE', 'TESSERA_CLI',
  'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'COLORTERM', 'TERM',
  'WT_SESSION', 'WT_PROFILE_ID', 'ITERM_SESSION_ID', 'ITERM_PROFILE', 'KITTY_WINDOW_ID', 'KITTY_PID',
  'TMUX', 'TMUX_PANE', 'STY', 'WINDOWID', 'VTE_VERSION', 'KONSOLE_VERSION', 'TERMINAL_EMULATOR',
]);
const STRIP_PREFIX = ['npm_', 'VSCODE_', 'WEZTERM_', 'ALACRITTY_', 'ELECTRON_'];

export function childEnv(base, platform = process.platform) {
  const env = {};
  const fold = (k) => (platform === 'win32' ? k.toUpperCase() : k);
  const exact = new Set([...STRIP_EXACT].map(fold));
  const prefixes = STRIP_PREFIX.map(fold);
  // VS Code's git askpass helper only works with its own IPC variables.
  if (Object.keys(base).some((k) => fold(k) === fold('VSCODE_GIT_IPC_HANDLE'))) exact.add(fold('GIT_ASKPASS'));
  for (const [key, value] of Object.entries(base)) {
    if (typeof value !== 'string') continue;
    const k = fold(key);
    if (exact.has(k) || prefixes.some((p) => k.startsWith(p))) continue;
    env[key] = value;
  }
  // Electron on Linux rewrites XDG_CURRENT_DESKTOP; give children the original.
  if (base.ORIGINAL_XDG_CURRENT_DESKTOP) {
    env.XDG_CURRENT_DESKTOP = base.ORIGINAL_XDG_CURRENT_DESKTOP;
    delete env.ORIGINAL_XDG_CURRENT_DESKTOP;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'tessera';
  if (platform !== 'win32' && !env.LANG) env.LANG = 'en_US.UTF-8';
  return env;
}

export function getEnv(env, name, platform = process.platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key ? env[key] : undefined;
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// Find an executable the way a shell would, including PATHEXT on Windows.
export function resolveExecutable(cmd, env, platform = process.platform, exists = isFile) {
  if (!cmd) return null;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const exts = platform === 'win32'
    ? ['', ...(getEnv(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())]
    : [''];
  const candidates = (base) => {
    if (platform !== 'win32') return [base];
    // A bare name without an extension is not runnable on Windows.
    const hasExt = exts.includes(p.extname(base).toLowerCase()) && p.extname(base) !== '';
    return hasExt ? [base] : exts.filter(Boolean).map((e) => base + e);
  };
  if (cmd.includes('/') || (platform === 'win32' && cmd.includes('\\'))) {
    return candidates(cmd).find(exists) ?? null;
  }
  const dirs = (getEnv(env, 'PATH', platform) || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    const clean = dir.replace(/^"(.*)"$/, '$1');
    for (const c of candidates(p.join(clean, cmd))) if (exists(c)) return c;
  }
  return null;
}

// Quote one argument for cmd.exe /s /c "...": double quotes are doubled and
// cmd metacharacters are only safe inside quotes.
export function quoteCmdArg(arg) {
  if (arg === '') return '""';
  if (!/[\s"&|<>^%!(),;=]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

// .cmd/.bat (e.g. an npm-installed claude) cannot be started directly by
// CreateProcess; run them through cmd.exe. PowerShell scripts need powershell.
export function wrapForPlatform(file, args, env, platform = process.platform) {
  if (platform !== 'win32') return { file, args };
  const ext = path.win32.extname(file).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    const comspec = getEnv(env, 'ComSpec', platform) || 'C:\\Windows\\System32\\cmd.exe';
    const line = [file, ...args].map(quoteCmdArg).join(' ');
    return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`] };
  }
  if (ext === '.ps1') {
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args] };
  }
  return { file, args };
}

export function defaultShell(env, platform = process.platform) {
  if (platform === 'win32') {
    const pwsh = resolveExecutable('pwsh', env, platform);
    return { command: pwsh ?? 'powershell.exe', args: ['-NoLogo'] };
  }
  const shell = getEnv(env, 'SHELL', platform) || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { command: shell, args: platform === 'darwin' ? ['-l'] : [] };
}

// Given to the orchestrator (the session in the open folder itself) so that
// "have the agents ..." works without further explanation.
export const ORCHESTRATION_HINT =
  'You are the orchestrator in Tessera. Other Claude Code sessions ("agents") run in subfolders of this ' +
  'folder and are shown next to you. When the user asks you to delegate to, coordinate, check on, or start ' +
  'agents, use the `tessera` shell command (run `tessera help` first). Messages that start with [tessera] are ' +
  'check-ins sent by Tessera, not by the user: they report on agents you gave tasks to. When one arrives, look ' +
  'at those agents (`tessera read`), follow up or fix problems (`tessera send`), and tell the user once the ' +
  'work is done.';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Remove flags (and the value after them, unless written flag=value) from an
// argument list. `valued` lists the flags that take a value.
export function stripFlags(args, flags, valued = flags) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const [flag] = a.split('=');
    if (!flags.includes(flag)) {
      out.push(a);
      continue;
    }
    if (valued.includes(flag) && !a.includes('=')) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) i++;
    }
  }
  return out;
}

// Session flags are always ours; drop them from user args so they never conflict.
export const stripSessionFlags = (args) =>
  stripFlags(args, ['--session-id', '--resume', '-r', '--continue', '-c', '--fork-session'], ['--session-id', '--resume', '-r']);

// Model, effort and permission mode chosen in Settings, as claude flags.
// A setting replaces the same flag in claude.args; an empty one leaves them.
export function settingFlags(claude, args) {
  const pairs = [['--model', claude.model], ['--effort', claude.effort], ['--permission-mode', claude.permissionMode]];
  const set = pairs.filter(([, value]) => value);
  const out = stripFlags(args, set.map(([flag]) => flag));
  for (const [flag, value] of set) out.push(flag, value);
  return out;
}

// The command for a pane.
//   role 'orchestrator' | 'agent': claude; session { id, resume } becomes
//     --resume <id> (an existing conversation) or --session-id <id> (a new one)
//   role 'shell': the configured shell, or the platform's default
export function buildCommand({ role, session }, config, env, platform = process.platform) {
  let command;
  let args;
  if (role === 'shell') {
    const shell = config.shell.command ? config.shell : defaultShell(env, platform);
    command = shell.command;
    args = shell.args.slice();
  } else {
    command = config.claude.command;
    args = settingFlags(config.claude, stripSessionFlags(config.claude.args));
    if (session && UUID_RE.test(session.id)) args.push(session.resume ? '--resume' : '--session-id', session.id);
    if (role === 'orchestrator' && config.claude.orchestration && !args.some((a) => a.startsWith('--append-system-prompt'))) {
      args.push('--append-system-prompt', ORCHESTRATION_HINT);
    }
  }
  const file = resolveExecutable(command, env, platform);
  if (!file) {
    const key = role === 'shell' ? 'shell.command' : 'claude.command';
    throw new Error(`"${command}" was not found on PATH. Set ${key} in config.local.json to its full path.`);
  }
  return wrapForPlatform(file, args, env, platform);
}
