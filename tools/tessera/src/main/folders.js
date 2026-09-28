// Folder listings: the subfolders "Open all" starts agents in, and one level
// at a time for the file tree in the zoomed view.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_SUBFOLDERS = 64;
export const MAX_ENTRIES = 2000;

// Hidden folders (.git, .venv), folders starting with "_" (templates, scratch)
// and generated ones are never projects.
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
    if (e.name.startsWith('.') || e.name.startsWith('_') || SKIP_SUBFOLDERS.has(e.name)) continue;
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

// Why `name` cannot be the name of a new subfolder, or null if it can.
export function folderNameError(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'Type a name.';
  if (n.length > 100) return 'That name is too long.';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(n)) return 'A name cannot contain < > : " / \\ | ? *';
  if (/[. ]$/.test(n)) return 'A name cannot end with a dot or a space.';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) return `"${n}" is a reserved name on Windows.`;
  return null;
}

// Folder copied into every new subfolder, if the parent has one (kaggle-lab's
// competition template).
export const TEMPLATE_DIR = '_template';

// Create subfolder `name` of `parent`, as a copy of parent/_template when that
// exists. Returns its path; throws with a message fit for the user.
export function createSubfolder(parent, name) {
  const problem = folderNameError(name);
  if (problem) throw new Error(problem);
  const clean = String(name).trim();
  const dest = path.join(parent, clean);
  if (fs.existsSync(dest)) throw new Error(`${clean} already exists.`);
  const template = path.join(parent, TEMPLATE_DIR);
  try {
    if (fs.statSync(template, { throwIfNoEntry: false })?.isDirectory()) {
      fs.cpSync(template, dest, { recursive: true, errorOnExist: true, force: false });
    } else {
      fs.mkdirSync(dest);
    }
  } catch (err) {
    throw new Error(`Could not create ${clean}: ${err.code || err.message}`);
  }
  return dest;
}

// True if `child` is `parent` or somewhere below it.
export function isInside(child, parent, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}
