import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, describeSshError, JobsPoller, normalizeState, parseJobs, sshArgs } from '../src/main/jobs.js';

test('parseJobs reads JSON lines and tab-separated lines', () => {
  const { jobs, skipped } = parseJobs([
    '# comment',
    '{"name": "train-v4", "state": "Running", "detail": "epoch 12/40", "progress": 0.3}',
    'sweep\tpending\tqueue position 2',
    '{"name": "eval", "state": "succeeded", "progress": "75%"}',
    '{"state": "running"}',
    '{not json',
    '',
    'bare-name',
  ].join('\r\n'));
  assert.deepEqual(jobs, [
    { name: 'train-v4', state: 'running', detail: 'epoch 12/40', progress: 0.3 },
    { name: 'sweep', state: 'queued', detail: 'queue position 2' },
    { name: 'eval', state: 'done', detail: '', progress: 0.75 },
    { name: 'bare-name', state: 'unknown', detail: '' },
  ]);
  assert.equal(skipped, 2);
});

test('parseJobs caps the list and strips escapes', () => {
  const many = Array.from({ length: 80 }, (_, i) => `job${i}\trunning`).join('\n');
  assert.equal(parseJobs(many).jobs.length, 50);
  const [job] = parseJobs('\x1b[31mred\x1b[0m\tfailed\t\x1b]0;title\x07detail\x00').jobs;
  assert.deepEqual(job, { name: 'red', state: 'failed', detail: 'detail' });
  assert.equal(cleanText('x'.repeat(500)).length, 160);
  assert.deepEqual(parseJobs(undefined), { jobs: [], skipped: 0 });
});

test('normalizeState aliases', () => {
  assert.equal(normalizeState('In Progress'), 'running');
  assert.equal(normalizeState('CANCELLED'), 'failed');
  assert.equal(normalizeState('waiting'), 'queued');
  assert.equal(normalizeState('weird'), 'unknown');
  assert.equal(normalizeState(null), 'unknown');
});

test('ssh arguments: batch mode, then user args, then -- before the host', () => {
  const args = sshArgs({ host: 'gpu', command: 'jobs', sshArgs: ['-p', '2222'] });
  assert.deepEqual(args.slice(0, 2), ['-o', 'BatchMode=yes']);
  assert.deepEqual(args.slice(-5), ['-p', '2222', '--', 'gpu', 'jobs']);
});

test('describeSshError picks the useful line', () => {
  assert.equal(describeSshError({ code: 255 }, 'Warning: Permanently added x\r\nuser@gpu: Permission denied (publickey).\r\n'), 'user@gpu: Permission denied (publickey).');
  assert.match(describeSshError({ code: 'ENOENT' }, ''), /ssh was not found/);
  assert.match(describeSshError({ killed: true }, ''), /Timed out/);
  assert.equal(describeSshError({ code: 3 }, ''), 'Remote command exited with code 3.');
});

function fakeRun(results) {
  const calls = [];
  const run = (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    const r = results.shift() ?? { stdout: '' };
    const child = { killed: false, kill() { this.killed = true; } };
    setImmediate(() => cb(r.err ?? null, r.stdout ?? '', r.stderr ?? ''));
    return child;
  };
  return { run, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

test('JobsPoller: unconfigured stays quiet', () => {
  const updates = [];
  const { run, calls } = fakeRun([]);
  const p = new JobsPoller({ getConfig: () => ({ jobs: { host: '', command: '' } }), onUpdate: (s) => updates.push(s), run });
  p.reset();
  assert.equal(calls.length, 0);
  assert.deepEqual(updates.at(-1), { configured: false });
});

test('JobsPoller: polls, reports errors, backs off, and never overlaps', async () => {
  const updates = [];
  const { run, calls } = fakeRun([
    { stdout: 'a\trunning\n' },
    { err: { code: 255 }, stderr: 'Connection refused' },
  ]);
  const jobs = { host: 'gpu', command: 'list', intervalSeconds: 30, sshCommand: 'ssh', sshArgs: [] };
  const p = new JobsPoller({ getConfig: () => ({ jobs }), onUpdate: (s) => updates.push(s), run });
  p.reset();
  p.refresh(); // already in flight: ignored
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.windowsHide, true);
  await tick();
  assert.deepEqual(updates.at(-1).jobs, [{ name: 'a', state: 'running', detail: '' }]);
  assert.equal(updates.at(-1).error, null);

  p.refresh();
  await tick();
  const failed = updates.at(-1);
  assert.equal(failed.error, 'Connection refused');
  assert.deepEqual(failed.jobs, [{ name: 'a', state: 'running', detail: '' }], 'last good list kept');
  assert.equal(p.failures, 1);

  p.setPaused(true);
  assert.equal(p.timer, null);
  p.stop();
});

test('JobsPoller: a result that arrives after stop() is ignored', async () => {
  const updates = [];
  const { run } = fakeRun([{ stdout: 'late\tdone' }]);
  const p = new JobsPoller({ getConfig: () => ({ jobs: { host: 'gpu', command: 'x', intervalSeconds: 30, sshCommand: 'ssh', sshArgs: [] } }), onUpdate: (s) => updates.push(s), run });
  p.reset();
  p.stop();
  const count = updates.length;
  await tick();
  assert.equal(updates.length, count);
});

test('JobsPoller: a synchronous spawn failure is reported, not thrown', () => {
  const updates = [];
  const run = () => {
    throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
  };
  const p = new JobsPoller({ getConfig: () => ({ jobs: { host: 'gpu', command: 'x', intervalSeconds: 30, sshCommand: 'ssh', sshArgs: [] } }), onUpdate: (s) => updates.push(s), run });
  p.reset();
  assert.equal(updates.at(-1).error, 'spawn EINVAL');
  p.stop();
});
