// Pure helpers for the agent grid; no DOM, so they are unit-tested.

const MAX_AGENTS = 64;

// Columns and rows for `count` tiles in a box of the given aspect ratio
// (width / height), keeping tiles roughly square.
export function gridShape(count, aspect) {
  if (count <= 1) return { cols: 1, rows: 1 };
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5;
  const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * a))));
  return { cols, rows: Math.ceil(count / cols) };
}

// The grid for `count` tiles in a width x height box. Tiles never get smaller
// than minW x minH: columns are capped by the width, and when the rows do not
// fit the height they get a fixed height and the box scrolls.
export function gridLayout(count, width, height, { minW = 300, minH = 200, gap = 8 } = {}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const most = Math.max(1, Math.floor((w + gap) / (minW + gap)));
  const cols = Math.min(gridShape(count, w / h).cols, most);
  const rows = Math.max(1, Math.ceil(count / cols));
  const scroll = (h - gap * (rows - 1)) / rows < minH;
  return { cols, rows, scroll };
}

// Short state for an agent's row in the list view.
export function agentStateText(state, idleSeconds = 0) {
  if (state === 'working') return 'Working';
  if (state === 'needs-input') return 'Needs you';
  if (state === 'idle') {
    const min = Math.floor(idleSeconds / 60);
    if (min < 1) return 'Idle';
    return min < 60 ? `Idle ${min}m` : `Idle ${Math.floor(min / 60)}h`;
  }
  if (state === 'exited') return 'Exited';
  if (state === 'error') return 'Error';
  return 'Starting';
}

// A folder's saved state, from whatever the config file holds:
//   { orchestrator: sessionId | null, agents: [{ cwd, sessionId }] }
//   rulesSeen: { sessionId: hash of the rules that conversation last got }
export function readSaved(data) {
  const out = { orchestrator: null, agents: [], rulesSeen: {} };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  if (typeof data.orchestrator === 'string') out.orchestrator = data.orchestrator;
  if (data.rulesSeen && typeof data.rulesSeen === 'object' && !Array.isArray(data.rulesSeen)) {
    for (const [id, hash] of Object.entries(data.rulesSeen).slice(0, MAX_AGENTS + 1)) {
      if (typeof hash === 'string' && hash.length <= 16) out.rulesSeen[id] = hash;
    }
  }
  if (Array.isArray(data.agents)) {
    for (const a of data.agents.slice(0, MAX_AGENTS)) {
      if (!a || typeof a.cwd !== 'string' || !a.cwd || a.cwd.length > 4096) continue;
      out.agents.push({ cwd: a.cwd, sessionId: typeof a.sessionId === 'string' ? a.sessionId : null });
    }
  }
  return out;
}
