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

// The transcript for this session id, in whichever project folder holds it
// (session ids are unique, so this does not depend on how Claude names the
// folders), or null.
export function transcriptPath(sessionId, root = claudeDir()) {
  if (!UUID_RE.test(String(sessionId))) return null;
  const projects = path.join(root, 'projects');
  let dirs;
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    const file = path.join(projects, d.name, `${sessionId}.jsonl`);
    if (d.isDirectory() && fs.existsSync(file)) return file;
  }
  return null;
}

export const hasTranscript = (sessionId, root = claudeDir()) => transcriptPath(sessionId, root) !== null;

// The last reply Claude wrote in a session: the text of its latest assistant
// message (one message can be saved as several lines, one per block). Reads
// only the end of the file. Null if there is none.
export function lastReply(sessionId, root = claudeDir(), maxBytes = 4 * 1024 * 1024) {
  const file = transcriptPath(sessionId, root);
  if (!file) return null;
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - maxBytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1); // drop the cut-off first line
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const parts = [];
  let messageId = null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry?.type !== 'assistant' || entry.isSidechain) {
      if (messageId && entry?.type === 'user') break; // the reply started after this prompt
      continue;
    }
    const content = entry.message?.content;
    const blocks = Array.isArray(content) ? content.filter((b) => b?.type === 'text' && b.text) : [];
    if (!blocks.length) continue;
    const id = entry.message?.id ?? null;
    if (messageId && id !== messageId) break;
    messageId = id ?? '';
    parts.unshift(blocks.map((b) => b.text).join('\n\n'));
  }
  return parts.length ? parts.join('\n\n').trim() : null;
}
