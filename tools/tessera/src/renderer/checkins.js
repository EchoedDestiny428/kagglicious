// Agent status, check-ins and rule updates. Pure logic, no DOM, so it is unit-tested.
//
// Claude Code reports to Tessera through hooks (see launch.js): it needs
// permission or input (Notification), it finished a turn (Stop), or it got a
// new prompt (UserPromptSubmit). When hooks are missing, going quiet after
// working counts as stopped.

export const DONE_AFTER_IDLE_MS = 5000; // quiet this long after working = stopped

// What a hook event means for the pane: 'needs-input' | 'stopped' | 'prompt' | null.
export function hookState({ event, type = '', message = '' }) {
  if (event === 'Stop') return 'stopped';
  if (event === 'UserPromptSubmit') return 'prompt';
  if (event !== 'Notification') return null;
  // "idle_prompt" is Claude waiting after it already finished: Stop covered that.
  if (type === 'idle_prompt' || /waiting for your input/i.test(message)) return null;
  if (type === 'auth_success') return null;
  return 'needs-input';
}

// Tasks are kept per agent id: { startedAt, lastNotifiedAt, askedReported }.
export class TaskWatch {
  constructor() {
    this.tasks = new Map();
  }

  // The orchestrator sent the agent something to do.
  started(id, now) {
    this.tasks.set(id, { startedAt: now, lastNotifiedAt: now, askedReported: false });
  }

  // The orchestrator looked at the agent itself: no need to tell it about
  // a stop it has seen, and the progress clock restarts.
  looked(id, agentIdle, now) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (agentIdle) this.tasks.delete(id);
    else task.lastNotifiedAt = now;
  }

  // agents: [{ id, name, state, idleMs, lastOutputAt, stoppedAt, needsInput, message, report, background }]
  //   report: the start of its last reply; background: backgroundWork() of its screen
  //   state: 'working' | 'idle' | 'needs-input' | 'starting' | 'exited' | 'error'
  //   stoppedAt: when its last turn ended (Stop hook), or 0
  // Returns [{ id, name, kind: 'stopped' | 'needs-input' | 'exited' | 'working', minutes, message? }].
  check(agents, now, intervalMs) {
    const events = [];
    const present = new Set(agents.map((a) => a.id));
    for (const id of this.tasks.keys()) if (!present.has(id)) this.tasks.delete(id);
    for (const a of agents) {
      const task = this.tasks.get(a.id);
      if (!task) continue;
      const minutes = Math.max(1, Math.round((now - task.startedAt) / 60000));
      const base = { id: a.id, name: a.name, minutes };
      if (a.state === 'exited' || a.state === 'error') {
        events.push({ ...base, kind: 'exited' });
        this.tasks.delete(a.id);
      } else if (a.state === 'needs-input') {
        // Once per wait; the task goes on after the question is answered.
        if (!task.askedReported) events.push({ ...base, kind: 'needs-input', message: a.message || '' });
        task.askedReported = true;
      } else if ((a.stoppedAt ?? 0) > task.startedAt ||
        (a.state === 'idle' && !a.stoppedAt && a.lastOutputAt > task.startedAt && a.idleMs >= DONE_AFTER_IDLE_MS)) {
        events.push({ ...base, kind: 'stopped', report: a.report || '', background: a.background || '' });
        this.tasks.delete(a.id);
      } else {
        task.askedReported = false;
        if (intervalMs > 0 && now - task.lastNotifiedAt >= intervalMs) {
          events.push({ ...base, kind: 'working' });
          task.lastNotifiedAt = now;
        }
      }
    }
    return events;
  }

  get size() {
    return this.tasks.size;
  }
}

// One line (so Claude does not fold it into a pasted-text block). A finished
// agent's event carries the start of its last reply (report) and any
// background work still running.
export function checkInMessage(events) {
  const parts = events.map((e) => {
    const who = `${e.name} (pane ${e.id})`;
    if (e.kind === 'exited') return `${who} has exited`;
    if (e.kind === 'stopped') {
      const running = e.background ? ` (${e.background} still running, it will wake up when that finishes)` : '';
      return `${who} has finished its turn${running}${e.report ? `, saying: "${e.report}"` : ''}`;
    }
    if (e.kind === 'needs-input') return `${who} is waiting for an answer${e.message ? ` ("${e.message}")` : ''}`;
    return `${who} is still working (${e.minutes} min)`;
  });
  const news = events.some((e) => e.kind !== 'working');
  const ask = news
    ? 'Read their full replies with `tessera last`, answer or follow up with `tessera send` if needed, and tell the user when everything is done.'
    : 'Glance at their progress with `tessera read` and step in only if something is stuck or going wrong.';
  return `[tessera] Check-in: ${parts.join('; ')}. ${ask}`;
}

// The start of a reply, on one line.
export function excerpt(text, max = 200) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// Background work Claude Code shows in its footer, under the input box's
// bottom border ("manual mode on · 1 shell · ↓ to manage"): "1 shell",
// "2 monitors", joined by ", ", or '' for none. Only the footer is read, so a
// reply that mentions shells does not count. `lines`: the last screen lines,
// oldest first.
export function backgroundWork(lines) {
  let footer = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*─{4,}/.test(lines[i] ?? '')) {
      footer = i + 1;
      break;
    }
  }
  if (footer < 0) return '';
  const found = [];
  for (const line of lines.slice(footer)) {
    for (const m of String(line).matchAll(/(?:^|[\s·,])(\d+) (shells?|monitors?)(?=[\s·,]|$)/g)) found.push(`${m[1]} ${m[2]}`);
  }
  return found.join(', ');
}

// One desktop notification for several events that arrive together.
//   items: [{ name, kind: 'needs-input' | 'stopped', message }]
export function notificationText(items) {
  const asking = items.filter((i) => i.kind === 'needs-input');
  const lead = asking.length ? asking : items;
  if (items.length === 1) {
    const [i] = items;
    return {
      title: i.kind === 'needs-input' ? `${i.name} needs you` : `${i.name} finished`,
      body: i.message || (i.kind === 'needs-input' ? 'Waiting for your input' : ''),
    };
  }
  const names = lead.map((i) => i.name).join(', ');
  return {
    title: asking.length ? `${asking.length} session${asking.length === 1 ? '' : 's'} need you` : `${items.length} sessions finished`,
    body: asking.length && asking.length < items.length ? `${names}; ${items.length - asking.length} more finished` : names,
  };
}

// Message sent to a session whose conversation has not seen the current rules.
// One line: it is typed, so Claude takes it as the user's own words.
export function rulesUpdateMessage(rules) {
  const body = (rules ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#+\s/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ');
  return body
    ? `[tessera] My rules for this workspace (RULES.md) are now: ${body} Follow them from now on, and reply with one short line.`
    : '[tessera] I removed the workspace rules (RULES.md). Go back to your defaults, and reply with one short line.';
}

// Short fingerprint of a rules text, to remember which rules a conversation got.
export function rulesHash(rules) {
  let h = 0x811c9dc5; // FNV-1a
  for (const ch of (rules ?? '').trim()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// Slash commands that switch an open session to new Settings, as [key, command]
// pairs. An empty value goes back to Claude Code's default.
export function settingCommands({ model, effort } = {}) {
  const out = [];
  if (model !== undefined) out.push(['model', `/model ${model || 'default'}`]);
  if (effort !== undefined) out.push(['effort', `/effort ${effort || 'auto'}`]);
  return out;
}
