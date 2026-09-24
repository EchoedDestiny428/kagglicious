// Owns the pseudo-terminals. Output is batched into few IPC messages, and a
// process is paused when the renderer falls behind so a flood of output
// cannot freeze the window.
import pty from 'node-pty';

const FLUSH_MS = 5;
const FLUSH_BYTES = 256 * 1024;
const HIGH_WATER = 1024 * 1024; // chars sent but not yet rendered
const LOW_WATER = 256 * 1024;

export class PtyManager {
  constructor({ onData, onExit, spawn = pty.spawn }) {
    this.onData = onData;
    this.onExit = onExit;
    this.spawnPty = spawn;
    this.sessions = new Map();
    this.nextId = 1;
  }

  // Throws if the process cannot be started (bad cwd, missing binary).
  spawn({ file, args, cwd, env, cols, rows, meta = {} }) {
    const id = this.nextId++;
    const proc = this.spawnPty(file, args, {
      name: 'xterm-256color',
      cwd,
      env,
      cols: clampDim(cols, 80),
      rows: clampDim(rows, 24),
    });
    const s = { id, proc, meta, buffer: '', timer: null, unacked: 0, paused: false, exited: false, killed: false };
    this.sessions.set(id, s);
    proc.onData((data) => this.#push(s, data));
    proc.onExit(({ exitCode, signal }) => {
      s.exited = true;
      this.#flush(s);
      this.sessions.delete(id);
      this.onExit(id, exitCode, signal);
    });
    return { id, pid: proc.pid };
  }

  #push(s, data) {
    s.buffer += data;
    if (s.buffer.length >= FLUSH_BYTES) this.#flush(s);
    else if (!s.timer) s.timer = setTimeout(() => this.#flush(s), FLUSH_MS);
  }

  #flush(s) {
    clearTimeout(s.timer);
    s.timer = null;
    if (!s.buffer) return;
    const chunk = s.buffer;
    s.buffer = '';
    s.unacked += chunk.length;
    this.onData(s.id, chunk);
    if (!s.paused && !s.exited && s.unacked > HIGH_WATER) {
      s.paused = true;
      try {
        s.proc.pause();
      } catch {
        s.paused = false;
      }
    }
  }

  ack(id, chars) {
    const s = this.sessions.get(id);
    if (!s || !Number.isFinite(chars)) return;
    s.unacked = Math.max(0, s.unacked - chars);
    if (s.paused && s.unacked < LOW_WATER) {
      s.paused = false;
      try {
        s.proc.resume();
      } catch {
        // Process already gone.
      }
    }
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (!s || s.exited || typeof data !== 'string') return;
    try {
      s.proc.write(data);
    } catch {
      // Writing races with exit; the exit event follows.
    }
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    const c = clampDim(cols, 0);
    const r = clampDim(rows, 0);
    if (!c || !r) return;
    try {
      s.proc.resize(c, r);
    } catch {
      // Resizing a pty whose process just exited throws on some platforms.
    }
  }

  kill(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    // Counts as gone right away; the exit event can take a moment.
    s.killed = true;
    try {
      s.proc.kill();
    } catch {
      // Already exited.
    }
  }

  killAll() {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  // Processes still running and not being shut down.
  get size() {
    let n = 0;
    for (const s of this.sessions.values()) if (!s.exited && !s.killed) n++;
    return n;
  }

  find(predicate) {
    for (const s of this.sessions.values()) if (!s.exited && !s.killed && predicate(s.meta)) return s.id;
    return null;
  }
}

function clampDim(v, fallback) {
  return Number.isInteger(v) && v > 0 ? Math.min(v, 1000) : fallback;
}
