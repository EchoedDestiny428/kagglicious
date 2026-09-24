import { h, iconButton } from './dom.js';

const api = window.tessera;

// Status strip for jobs on a remote machine (polled over ssh by the main
// process). Hidden until jobs.host and jobs.command are set in the config.
export class JobsStrip {
  constructor(el) {
    this.el = el;
    this.state = { configured: false };
    this.list = h('div', { class: 'jobs-list' });
    this.meta = h('span', { class: 'jobs-meta' });
    this.hostEl = h('span', { class: 'jobs-host-name' });
    this.refreshBtn = iconButton('refresh', 'Refresh', () => {
      this.refreshBtn.classList.add('spinning');
      api.jobs.refresh();
    });
    this.el.append(
      h('div', { class: 'jobs-host' }, h('span', { class: 'jobs-link' }), this.hostEl),
      this.list,
      this.meta,
      this.refreshBtn,
    );
    setInterval(() => this.renderMeta(), 10000);
  }

  update(state) {
    this.state = state ?? { configured: false };
    this.render();
  }

  render() {
    const s = this.state;
    this.el.hidden = !s.configured;
    if (!s.configured) return;
    this.el.classList.toggle('error', Boolean(s.error));
    this.el.classList.toggle('loading', Boolean(s.loading));
    if (!s.loading) this.refreshBtn.classList.remove('spinning');
    this.hostEl.textContent = s.host;

    const jobs = s.jobs ?? [];
    const children = [];
    if (s.error) children.push(h('span', { class: 'jobs-error', text: s.error, title: s.error }));
    for (const job of jobs) {
      const detail = job.detail || '';
      children.push(h('span', { class: `job ${job.state}${s.error ? ' stale' : ''}`, title: [job.name, job.state, detail].filter(Boolean).join(' · ') },
        h('span', { class: 'job-glyph' }),
        h('span', { class: 'job-name', text: job.name }),
        detail ? h('span', { class: 'job-detail', text: detail }) : null,
        Number.isFinite(job.progress)
          ? h('span', { class: 'job-progress' }, h('span', { style: { width: `${Math.round(job.progress * 100)}%` } }))
          : null));
    }
    if (!s.error && !jobs.length && !s.loading && s.updatedAt) children.push(h('span', { class: 'job-empty', text: 'No jobs' }));
    this.list.replaceChildren(...children);
    this.renderMeta();
  }

  renderMeta() {
    const s = this.state;
    if (!s.configured) return;
    const counts = {};
    for (const j of s.jobs ?? []) counts[j.state] = (counts[j.state] ?? 0) + 1;
    const parts = ['running', 'queued', 'failed', 'done'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`);
    if (s.updatedAt) parts.push(ago(s.updatedAt));
    else if (s.loading) parts.push('connecting…');
    this.meta.textContent = parts.join(' · ');
  }
}

function ago(t) {
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}
