// Check-ins: Tessera keeps an eye on tasks the orchestrator gave to agents
// and tells the orchestrator when an agent stops, or how long it has been
// working. Pure logic, no DOM, so it is unit-tested.

export const DONE_AFTER_IDLE_MS = 5000; // quiet this long after working = stopped

// Tasks are kept per agent id: { startedAt, lastNotifiedAt }.
export class TaskWatch {
  constructor() {
    this.tasks = new Map();
  }

  // The orchestrator sent the agent something to do.
  started(id, now) {
    this.tasks.set(id, { startedAt: now, lastNotifiedAt: now });
  }

  // The orchestrator looked at the agent itself: no need to tell it about
  // a stop it has seen, and the progress clock restarts.
  looked(id, agentIdle, now) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (agentIdle) this.tasks.delete(id);
    else task.lastNotifiedAt = now;
  }

  // agents: [{ id, name, state, idleMs, lastOutputAt }] with state one of
  // 'working' | 'idle' | 'starting' | 'exited' | 'error'.
  // Returns [{ id, name, kind: 'stopped' | 'exited' | 'working', minutes }].
  check(agents, now, intervalMs) {
    const events = [];
    const present = new Set(agents.map((a) => a.id));
    for (const id of this.tasks.keys()) if (!present.has(id)) this.tasks.delete(id);
    for (const a of agents) {
      const task = this.tasks.get(a.id);
      if (!task) continue;
      const minutes = Math.max(1, Math.round((now - task.startedAt) / 60000));
      if (a.state === 'exited' || a.state === 'error') {
        events.push({ id: a.id, name: a.name, kind: 'exited', minutes });
        this.tasks.delete(a.id);
      } else if (a.state === 'idle' && a.lastOutputAt > task.startedAt && a.idleMs >= DONE_AFTER_IDLE_MS) {
        events.push({ id: a.id, name: a.name, kind: 'stopped', minutes });
        this.tasks.delete(a.id);
      } else if (intervalMs > 0 && now - task.lastNotifiedAt >= intervalMs) {
        events.push({ id: a.id, name: a.name, kind: 'working', minutes });
        task.lastNotifiedAt = now;
      }
    }
    return events;
  }

  get size() {
    return this.tasks.size;
  }
}

// One line (so Claude does not fold it into a pasted-text block).
export function checkInMessage(events) {
  const parts = events.map((e) => {
    const who = `${e.name} (pane ${e.id})`;
    if (e.kind === 'exited') return `${who} has exited`;
    if (e.kind === 'stopped') return `${who} has stopped: finished, or waiting for input`;
    return `${who} is still working (${e.minutes} min)`;
  });
  const anyStopped = events.some((e) => e.kind !== 'working');
  const ask = anyStopped
    ? 'Review their work with `tessera read`, follow up with `tessera send` if needed, and tell the user when everything is done.'
    : 'Glance at their progress with `tessera read` and step in only if something is stuck or going wrong.';
  return `[tessera] Check-in: ${parts.join('; ')}. ${ask}`;
}
