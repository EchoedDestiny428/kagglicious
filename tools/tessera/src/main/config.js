// Machine-specific settings and state, kept in one untracked JSON file
// (config.local.json). Everything read from disk is validated; unknown keys are
// kept so hand-written additions survive a rewrite.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  folder: null, // the open folder
  recent: [], // recently opened folders, newest first
  sessions: {}, // folder key -> { orchestrator, agents } saved for that folder
  // model / effort / permissionMode: '' leaves Claude Code's own default.
  claude: { command: 'claude', args: [], model: '', effort: '', permissionMode: '', resumeOnRestore: true, orchestration: true },
  orchestrator: { checkIns: false, checkInterval: 5 }, // minutes between progress check-ins
  shell: { command: '', args: [] }, // terminal in the zoomed view; empty = platform default
  terminal: { fontSize: 13, scrollback: 10000, fontFamily: '' },
  ui: { theme: null, orchestratorWidth: 460, confirmClose: true, confirmQuit: true },
  window: null,
  jobs: { host: '', command: '', intervalSeconds: 30, sshCommand: 'ssh', sshArgs: [] },
});

export const MAX_RECENT = 10;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Modes that skip permission checks entirely are left to claude.args on purpose.
export const PERMISSION_MODES = ['auto', 'acceptEdits', 'plan', 'manual'];
const MODEL_RE = /^[A-Za-z0-9._\-[\]]{1,64}$/; // an alias like "opus" or a full name like "opus[1m]"

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, fallback, max = 4096) => (typeof v === 'string' && v.length <= max ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const int = (v, fallback, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
const strList = (v, max = 64) =>
  Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.length <= 4096).slice(0, max) : [];

// Hostnames live only in the local config; still refuse anything ssh could
// read as an option (e.g. "-oProxyCommand=...").
export const isSafeHost = (h) => typeof h === 'string' && /^[A-Za-z0-9_.@:%\[\]-]{1,255}$/.test(h) && !h.startsWith('-');

const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);

// One spelling per folder: resolved, no trailing separator, and
// case-insensitive on Windows, where C:\Code and c:\code are the same folder.
export function folderKey(p, platform = process.platform) {
  const resolved = pathFor(platform).resolve(p);
  const trimmed = resolved.length > 3 ? resolved.replace(/[\/]+$/, '') : resolved;
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

export function sanitizeRecent(list, platform = process.platform) {
  const p = pathFor(platform);
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== 'string' || !item.trim() || !p.isAbsolute(item)) continue;
    const key = folderKey(item, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.resolve(item));
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

function sanitizeWindow(w) {
  if (!isObj(w)) return null;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const out = { x: n(w.x), y: n(w.y), width: n(w.width), height: n(w.height), maximized: w.maximized === true };
  if (out.width === null || out.height === null || out.width < 200 || out.height < 150) return null;
  return out;
}

export function sanitize(raw, platform = process.platform) {
  const src = isObj(raw) ? raw : {};
  const warnings = [];
  const pick = (key) => (isObj(src[key]) ? src[key] : {});
  const claude = pick('claude');
  const orchestrator = pick('orchestrator');
  const shell = pick('shell');
  const terminal = pick('terminal');
  const ui = pick('ui');
  const jobs = pick('jobs');

  // The open folder is always the first recent one.
  const folder = typeof src.folder === 'string' && pathFor(platform).isAbsolute(src.folder)
    ? pathFor(platform).resolve(src.folder)
    : null;
  const recent = sanitizeRecent(folder ? [folder, ...(Array.isArray(src.recent) ? src.recent : [])] : src.recent, platform);

  // Saved panes are kept only for folders still in the recent list.
  const keep = new Set(recent.map((r) => folderKey(r, platform)));
  const sessions = {};
  if (isObj(src.sessions)) {
    for (const [key, tree] of Object.entries(src.sessions)) {
      if (isObj(tree) && keep.has(key)) sessions[key] = tree;
    }
  }

  const host = str(jobs.host, '', 255).trim();
  if (host && !isSafeHost(host)) warnings.push('jobs.host is not a valid ssh host or alias; the jobs strip is off.');

  return {
    config: {
      ...src,
      folder,
      recent,
      sessions,
      claude: {
        ...claude,
        command: str(claude.command, DEFAULTS.claude.command).trim() || DEFAULTS.claude.command,
        args: strList(claude.args),
        model: typeof claude.model === 'string' && MODEL_RE.test(claude.model) ? claude.model : '',
        effort: EFFORTS.includes(claude.effort) ? claude.effort : '',
        permissionMode: PERMISSION_MODES.includes(claude.permissionMode) ? claude.permissionMode : '',
        resumeOnRestore: bool(claude.resumeOnRestore, DEFAULTS.claude.resumeOnRestore),
        orchestration: bool(claude.orchestration, DEFAULTS.claude.orchestration),
      },
      orchestrator: {
        ...orchestrator,
        checkIns: bool(orchestrator.checkIns, false),
        checkInterval: int(orchestrator.checkInterval, DEFAULTS.orchestrator.checkInterval, 1, 60),
      },
      shell: { ...shell, command: str(shell.command, '').trim(), args: strList(shell.args) },
      terminal: {
        ...terminal,
        fontSize: int(terminal.fontSize, DEFAULTS.terminal.fontSize, 8, 32),
        scrollback: int(terminal.scrollback, DEFAULTS.terminal.scrollback, 500, 200000),
        fontFamily: str(terminal.fontFamily, '', 200),
      },
      ui: {
        ...ui,
        theme: ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : null,
        orchestratorWidth: int(ui.orchestratorWidth, DEFAULTS.ui.orchestratorWidth, 280, 1200),
        confirmClose: bool(ui.confirmClose, true),
        confirmQuit: bool(ui.confirmQuit, true),
      },
      window: sanitizeWindow(src.window),
      jobs: {
        ...jobs,
        host: isSafeHost(host) ? host : '',
        command: str(jobs.command, '', 2000).trim(),
        intervalSeconds: int(jobs.intervalSeconds, DEFAULTS.jobs.intervalSeconds, 10, 3600),
        sshCommand: str(jobs.sshCommand, 'ssh', 1024).trim() || 'ssh',
        sshArgs: strList(jobs.sshArgs),
      },
    },
    warnings,
  };
}

// Offset of the first JSON syntax error in `text`, or -1. JSON.parse does not
// report positions in every engine version, so scan for it ourselves.
export function findJsonError(text) {
  let i = 0;
  const fail = () => {
    throw new RangeError(String(i));
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const str = () => {
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') return void i++;
      if (c < ' ') fail();
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
        else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else fail();
      } else i++;
    }
    fail();
  };
  const value = (depth) => {
    if (depth > 200) fail();
    ws();
    const c = text[i];
    if (c === '"') return str();
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (text[i] === close) return void i++;
      for (;;) {
        if (c === '{') {
          ws();
          if (text[i] !== '"') fail();
          str();
          ws();
          if (text[i] !== ':') fail();
          i++;
        }
        value(depth + 1);
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === close) return void i++;
        else fail();
      }
    }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) fail();
    i += m[0].length;
  };
  try {
    value(0);
    ws();
    if (i < text.length) fail();
    return -1;
  } catch (err) {
    if (err instanceof RangeError && /^\d+$/.test(err.message)) return Number(err.message);
    throw err;
  }
}

// "line L, column C" for the first syntax error, with a hint for the most
// common mistake: single backslashes in Windows paths.
export function describeJsonError(text) {
  const pos = findJsonError(text);
  if (pos < 0) return 'invalid JSON';
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  const hint = text[pos] === '\\' ? '; write Windows paths with \\\\ or /' : '';
  return `line ${line}, column ${col}${hint}`;
}

// Loads, validates, watches and atomically rewrites the config file.
// If the file on disk cannot be parsed it is never overwritten: the app keeps
// running on the last good values (or defaults) until the file is fixed.
export class ConfigStore extends EventEmitter {
  constructor(file, { platform = process.platform, debounceMs = 400 } = {}) {
    super();
    this.file = file;
    this.platform = platform;
    this.debounceMs = debounceMs;
    this.config = sanitize({}, platform).config;
    this.error = null;
    this.warnings = [];
    this.lastText = null;
    this.timer = null;
    this.watcher = null;
  }

  load() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.error = null;
        this.lastText = null;
        return this.config;
      }
      this.error = `Could not read ${path.basename(this.file)}: ${err.code || err.message}`;
      return this.config;
    }
    if (text === this.lastText) {
      // Back to the last good version (e.g. an edit was undone): nothing to reload.
      this.error = null;
      return this.config;
    }
    let raw;
    try {
      raw = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      this.error = `${path.basename(this.file)} has a syntax error (${describeJsonError(text.replace(/^﻿/, ''))}). Changes are not saved until it is fixed.`;
      return this.config;
    }
    const { config, warnings } = sanitize(raw, this.platform);
    this.config = config;
    this.warnings = warnings;
    this.error = null;
    this.lastText = text;
    return this.config;
  }

  update(mutate) {
    const draft = structuredClone(this.config);
    mutate(draft);
    this.config = sanitize(draft, this.platform).config;
    this.schedule();
    return this.config;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.error) return false;
    const text = `${JSON.stringify(this.config, null, 2)}\n`;
    if (text === this.lastText) return true;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      try {
        fs.renameSync(tmp, this.file);
      } catch {
        // Windows refuses to replace a file another program holds open.
        fs.writeFileSync(this.file, text, 'utf8');
        fs.rmSync(tmp, { force: true });
      }
      this.lastText = text;
      return true;
    } catch (err) {
      this.emit('write-error', err);
      return false;
    }
  }

  // Watch the directory rather than the file: atomic replacement by editors
  // (and by us) swaps the inode, which ends a plain file watch.
  watch() {
    if (this.watcher) return;
    const dir = path.dirname(this.file);
    const base = path.basename(this.file);
    let pending = null;
    try {
      this.watcher = fs.watch(dir, (_event, name) => {
        if (name && name !== base) return;
        clearTimeout(pending);
        pending = setTimeout(() => {
          const before = { text: this.lastText, error: this.error };
          this.load();
          if (this.lastText !== before.text || this.error !== before.error) this.emit('change', this.config);
        }, 150);
      });
      this.watcher.on('error', () => this.unwatch());
    } catch {
      this.watcher = null;
    }
  }

  unwatch() {
    this.watcher?.close();
    this.watcher = null;
  }
}
