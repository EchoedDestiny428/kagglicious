import { basename, h, icon } from './dom.js';

const api = window.tessera;
const SEP = api.platform === 'win32' ? '\\' : '/';
const join = (dir, name) => (dir.endsWith(SEP) ? dir + name : dir + SEP + name);

// A folder tree like VS Code's explorer. Folders load one level at a time
// when expanded and reload when files change on disk.
//   onPick(relativePath): a file was clicked
//   onOpen(absolutePath): "Open" was chosen from a file's right-click menu
export class Explorer {
  constructor(root, { onPick, onOpen }) {
    this.root = root;
    this.onPick = onPick;
    this.onOpen = onOpen;
    this.expanded = new Set([root]);
    this.children = new Map(); // dir -> [{ name, dir }]
    this.selected = null;
    this.disposed = false;
    this.list = h('div', { class: 'tree', role: 'tree' });
    this.el = h('nav', { class: 'explorer' },
      h('div', { class: 'explorer-head', title: root }, basename(root)),
      this.list);
  }

  async load() {
    await this.fetch(this.root);
    this.render();
  }

  async fetch(dir) {
    const res = await api.fs.list(dir);
    if (this.disposed) return;
    if (!res || res.error) {
      this.children.delete(dir);
      this.expanded.delete(dir);
      return;
    }
    this.children.set(dir, res.entries);
  }

  // Re-read every open folder, e.g. after files changed on disk.
  async refresh() {
    await Promise.all([...this.expanded].map((dir) => this.fetch(dir)));
    if (this.disposed) return;
    this.expanded.add(this.root);
    this.render();
  }

  async toggle(dir) {
    if (this.expanded.has(dir)) {
      this.expanded.delete(dir);
    } else {
      this.expanded.add(dir);
      await this.fetch(dir);
    }
    this.render();
  }

  render() {
    const rows = [];
    const walk = (dir, depth) => {
      for (const entry of this.children.get(dir) ?? []) {
        const full = join(dir, entry.name);
        const open = entry.dir && this.expanded.has(full);
        rows.push(this.row(entry, full, depth, open));
        if (open) walk(full, depth + 1);
      }
    };
    walk(this.root, 0);
    this.list.replaceChildren(...rows);
  }

  row(entry, full, depth, open) {
    const row = h('div', {
      class: `tree-row${entry.dir ? ' dir' : ''}${open ? ' open' : ''}${entry.name.startsWith('.') ? ' hidden-file' : ''}${full === this.selected ? ' selected' : ''}`,
      role: 'treeitem',
      title: full.slice(this.root.length + 1),
      style: { paddingLeft: `${10 + depth * 12}px` },
    },
    entry.dir ? icon('chevronRight', 13) : icon('file', 13),
    h('span', { class: 'tree-name', text: entry.name }));
    row.addEventListener('click', () => {
      this.selected = full;
      if (entry.dir) this.toggle(full);
      else {
        this.render();
        this.onPick(full.slice(this.root.length + 1));
      }
    });
    if (!entry.dir) {
      row.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        if ((await api.menu([{ id: 'open', label: 'Open' }])) === 'open') this.onOpen(full);
      });
    }
    return row;
  }

  dispose() {
    this.disposed = true;
    this.el.remove();
  }
}
