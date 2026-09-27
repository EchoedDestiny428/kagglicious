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
