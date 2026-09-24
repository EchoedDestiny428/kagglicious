// Checks whether Claude Code saved a conversation, so a restored pane can
// resume it. Claude keeps transcripts at
//   <config dir>/projects/<folder name>/<session id>.jsonl
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UUID_RE } from './launch.js';

export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// True if any project folder holds a transcript for this session id. Session
// ids are unique, so this does not depend on how Claude names the folders.
export function hasTranscript(sessionId, root = claudeDir()) {
  if (!UUID_RE.test(sessionId)) return false;
  const projects = path.join(root, 'projects');
  let dirs;
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return false;
  }
  return dirs.some((d) => d.isDirectory() && fs.existsSync(path.join(projects, d.name, `${sessionId}.jsonl`)));
}
