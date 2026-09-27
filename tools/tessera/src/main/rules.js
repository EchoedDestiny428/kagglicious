// The rulebook: RULES.md at the root of the open folder, written by the user.
// Every session gets it in its system prompt; the orchestrator is also asked to
// hold the agents to it.
import fs from 'node:fs';
import path from 'node:path';

export const RULES_FILE = 'RULES.md';
export const MAX_RULES = 20000;

// Starter rules, shown the first time the rulebook is opened (saved only if edited).
export const TEMPLATE = `# Rules

Tessera gives these to the orchestrator and every agent in this folder.

- Never submit to Kaggle yourself. Prepare the submission file, then ask me.
- Start anything that runs longer than a few minutes in the background (tmux on the server), write the command in WORKLOG.md, and check back later instead of waiting.
- Keep replies short, and don't re-read large files you have already read.
- Log results in WORKLOG.md (newest first) and commit when something runs end to end.
`;

export const rulesPath = (folder) => path.join(folder, RULES_FILE);

// The rules text, or null when there is no RULES.md.
export function readRules(folder) {
  try {
    return fs.readFileSync(rulesPath(folder), 'utf8').replace(/\r\n/g, '\n').slice(0, MAX_RULES);
  } catch {
    return null;
  }
}

export function writeRules(folder, text) {
  const file = rulesPath(folder);
  const clean = String(text).replace(/\r\n/g, '\n').slice(0, MAX_RULES);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, clean.endsWith('\n') ? clean : `${clean}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

// What a session gets appended to its system prompt ('' for nothing).
//   role: 'orchestrator' | 'agent'
//   hints: { orchestrator, agent }: what each role is told about Tessera ('' for nothing)
export function promptText(role, rules, hints = {}) {
  const parts = [];
  const hint = role === 'orchestrator' ? hints.orchestrator : hints.agent;
  if (hint) parts.push(hint);
  const body = (rules ?? '').trim();
  if (body) {
    const lead = role === 'orchestrator'
      ? "The user's rules for this workspace (RULES.md) follow. They override your defaults, and Tessera gives them to every agent; when you delegate or review work, hold the agents to them."
      : "The user's rules for this workspace (RULES.md) follow. They override your defaults.";
    parts.push(`${lead}\n\n${body}`);
  }
  return parts.join('\n\n');
}
