// Folder listings: the subfolders "Open all" starts agents in, and one level
// at a time for the file tree in the zoomed view.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_SUBFOLDERS = 64;
export const MAX_ENTRIES = 2000;

// Hidden folders (.git, .venv, ...) and generated ones are never projects.
const SKIP_SUBFOLDERS = new Set(['node_modules', '__pycache__']);
// Never useful in the file tree.
const SKIP_ENTRIES = new Set(['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function isDirEntry(dir, e) {
  if (e.isDirectory()) return true;
  if (!e.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(dir, e.name)).isDirectory();
  } catch {
    return false; // broken link
  }
}

export function listSubfolders(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_SUBFOLDERS.has(e.name)) continue;
    if (isDirEntry(dir, e)) out.push(path.join(dir, e.name));
  }
  out.sort((a, b) => collator.compare(path.basename(a), path.basename(b)));
  return out.slice(0, MAX_SUBFOLDERS);
}

// One level of a folder: folders first, then files, in natural order.
export function listDir(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(e.name)) continue;
    out.push({ name: e.name, dir: isDirEntry(dir, e) });
  }
  out.sort((a, b) => (a.dir === b.dir ? collator.compare(a.name, b.name) : a.dir ? -1 : 1));
  return { entries: out.slice(0, MAX_ENTRIES), truncated: out.length > MAX_ENTRIES };
}

// True if `child` is `parent` or somewhere below it.
export function isInside(child, parent, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}
