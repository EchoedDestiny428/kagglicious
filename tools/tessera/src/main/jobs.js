// Polls a command on a remote machine over ssh and turns its output into a
// list of jobs for the status strip.
//
// The remote command prints one job per line, either as JSON
//   {"name": "train-v4", "state": "running", "detail": "epoch 12/40", "progress": 0.3}
// or as tab-separated text
//   train-v4<TAB>running<TAB>epoch 12/40
//
// ssh runs with BatchMode=yes: authentication must come from keys or an agent
// configured in ~/.ssh, so no password is ever stored or typed here.
import { execFile } from 'node:child_process';
import { isSafeHost } from './config.js';

const MAX_JOBS = 50;
const MAX_TEXT = 160;
export const STATES = ['running', 'queued', 'done', 'failed', 'unknown'];

const STATE_ALIASES = {
  running: 'running', run: 'running', active: 'running', busy: 'running', started: 'running', in_progress: 'running', training: 'running',
  queued: 'queued', queue: 'queued', pending: 'queued', waiting: 'queued', scheduled: 'queued',
  done: 'done', complete: 'done', completed: 'done', finished: 'done', success: 'done', succeeded: 'done', ok: 'done',
  failed: 'failed', fail: 'failed', error: 'failed', errored: 'failed', crashed: 'failed', cancelled: 'failed', canceled: 'failed', killed: 'failed',
};

// Remove terminal escapes and control characters, collapse whitespace, cap length.
export function cleanText(value, max = MAX_TEXT) {
  if (value === undefined || value === null) return '';
  const s = String(value)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function normalizeState(value) {
  const key = cleanText(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return STATE_ALIASES[key] ?? 'unknown';
}

function toJob(fields) {
  const name = cleanText(fields.name, 60);
  if (!name) return null;
  const job = { name, state: normalizeState(fields.state), detail: cleanText(fields.detail) };
  let p = typeof fields.progress === 'string' ? parseFloat(fields.progress) : fields.progress;
  if (typeof fields.progress === 'string' && fields.progress.trim().endsWith('%')) p /= 100;
  if (Number.isFinite(p)) job.progress = Math.min(1, Math.max(0, p > 1 && p <= 100 ? p / 100 : p));
  return job;
}

export function parseJobs(text) {
  const jobs = [];
  let skipped = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let job = null;
    if (line.startsWith('{')) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object') job = toJob(obj);
      } catch {
        job = null;
      }
    } else {
      const [name, state, ...rest] = line.split('\t');
      job = toJob({ name, state, detail: rest.join(' ') });
    }
    if (job) jobs.push(job);
    else skipped++;
    if (jobs.length >= MAX_JOBS) break;
  }
  return { jobs, skipped };
}

// The last meaningful line of ssh's stderr is usually the reason it failed.
export function describeSshError(err, stderr) {
  const lines = String(stderr ?? '').split(/\r?\n/).map((l) => cleanText(l, 200)).filter(Boolean);
  const last = lines.filter((l) => !/^warning: permanently added/i.test(l)).pop();
  if (err?.code === 'ENOENT') return 'ssh was not found. Install OpenSSH or set jobs.sshCommand.';
  if (err?.killed) return 'Timed out waiting for the server.';
  if (last) return last;
  if (typeof err?.code === 'number') return `Remote command exited with code ${err.code}.`;
  return cleanText(err?.message ?? 'ssh failed', 200);
}

export function sshArgs(jobs) {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2',
    ...jobs.sshArgs,
    '--', jobs.host, jobs.command,
  ];
}

export const jobsConfigured = (jobs) => Boolean(jobs && jobs.host && jobs.command && isSafeHost(jobs.host));

// Runs the poll on a timer: never overlapping, backing off after failures,
// paused while the window is hidden.
export class JobsPoller {
  constructor({ getConfig, onUpdate, run = execFile }) {
    this.getConfig = getConfig;
    this.onUpdate = onUpdate;
    this.run = run;
    this.timer = null;
    this.child = null;
    this.current = null;
    this.failures = 0;
    this.paused = false;
    this.state = { configured: false };
  }

  get config() {
    return this.getConfig().jobs;
  }

  // Call after the config changes.
  reset() {
    this.stop();
    this.failures = 0;
    const jobs = this.config;
    if (!jobsConfigured(jobs)) {
      this.publish({ configured: false });
      return;
    }
    this.publish({ configured: true, host: jobs.host, jobs: [], loading: true, error: null, updatedAt: null });
    if (!this.paused) this.poll();
  }

  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      clearTimeout(this.timer);
      this.timer = null;
    } else if (this.state.configured && !this.current) {
      this.poll();
    }
  }

  refresh() {
    if (!this.state.configured || this.current) return;
    clearTimeout(this.timer);
    this.poll();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
    this.child?.kill();
    this.child = null;
  }

  publish(state) {
    this.state = state;
    this.onUpdate(state);
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.paused || !this.state.configured) return;
    const base = this.config.intervalSeconds * 1000;
    // 1x, 2x, 4x ... the interval after failures, capped at five minutes.
    const delay = this.failures ? Math.min(base * 2 ** (this.failures - 1), Math.max(base, 300000)) : base;
    this.timer = setTimeout(() => this.poll(), delay);
  }

  poll() {
    const jobs = this.config;
    if (!jobsConfigured(jobs)) return;
    this.publish({ ...this.state, loading: true });
    const token = {};
    this.current = token;
    const done = (err, stdout, stderr) => {
      if (this.current !== token) return; // stopped or superseded
      this.current = null;
      this.child = null;
      if (err) {
        this.failures++;
        this.publish({ ...this.state, loading: false, error: describeSshError(err, stderr) });
      } else {
        this.failures = 0;
        const { jobs: list } = parseJobs(stdout);
        this.publish({ configured: true, host: jobs.host, jobs: list, loading: false, error: null, updatedAt: Date.now() });
      }
      this.schedule();
    };
    try {
      const child = this.run(
        jobs.sshCommand,
        sshArgs(jobs),
        { timeout: 25000, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
        done,
      );
      if (this.current === token) this.child = child;
    } catch (err) {
      done(err, '', '');
    }
  }
}
