// Sync reminder: for a folder inside a git repo whose root has sync.sh (the
// kaggle-lab convention), report whether it has changes not on GitHub, and
// run sync.sh on request.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GIT_TIMEOUT = 15000;
const SYNC_TIMEOUT = 180000;

// `git status --porcelain=v2 --branch` -> { dirty, ahead, behind, upstream }
export function parseStatus(text) {
  const out = { dirty: 0, ahead: 0, behind: 0, upstream: false };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('# branch.upstream ')) out.upstream = true;
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        out.ahead = Number(m[1]);
        out.behind = Number(m[2]);
      }
    } else if (!line.startsWith('#')) out.dirty++;
  }
  return out;
}

export const unsynced = (s) => Boolean(s && (s.dirty > 0 || s.ahead > 0 || s.behind > 0));

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

// Never let git stop and ask for a password in the background.
const gitEnv = (env) => ({ ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });

// Root of the repo holding `folder`, if that root has sync.sh; otherwise null.
export async function syncRoot(folder, env = process.env) {
  const res = await run('git', ['-C', folder, 'rev-parse', '--show-toplevel'], { timeout: GIT_TIMEOUT, env: gitEnv(env) });
  if (!res.ok) return null;
  const root = path.resolve(res.stdout.trim());
  return fs.existsSync(path.join(root, 'sync.sh')) ? root : null;
}

// fetch: also ask GitHub for new commits (slower; network).
export async function syncStatus(root, { fetch = false, env = process.env } = {}) {
  if (fetch) await run('git', ['-C', root, 'fetch', '-q'], { timeout: GIT_TIMEOUT, env: gitEnv(env) });
  const res = await run('git', ['-C', root, 'status', '--porcelain=v2', '--branch'], { timeout: GIT_TIMEOUT, env: gitEnv(env) });
  return res.ok ? parseStatus(res.stdout) : null;
}

// The shell that runs sync.sh: sh on macOS/Linux, Git for Windows' sh.exe on Windows.
export function findShell(env = process.env, platform = process.platform, exists = fs.existsSync) {
  if (platform !== 'win32') return 'sh';
  const candidates = [path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'sh.exe')];
  for (const dir of (env.PATH || env.Path || '').split(';')) {
    // ...\Git\cmd\git.exe on PATH means ...\Git\bin\sh.exe next to it.
    if (/[\\/]git[\\/]cmd[\\/]?$/i.test(dir)) candidates.push(path.win32.join(dir, '..', 'bin', 'sh.exe'));
  }
  return candidates.find((c) => exists(c)) ?? null;
}

export async function runSync(root, env = process.env) {
  const sh = findShell(env);
  if (!sh) return { ok: false, output: 'Could not find sh (it comes with Git for Windows).' };
  const res = await run(sh, [path.join(root, 'sync.sh')], { cwd: root, timeout: SYNC_TIMEOUT, env: gitEnv(env) });
  const output = `${res.stdout}${res.stderr}`.trim();
  return { ok: res.ok, output: output || (res.ok ? 'Up to date.' : 'Sync failed.') };
}
