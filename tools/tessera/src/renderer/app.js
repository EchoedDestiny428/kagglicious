import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { basename, h, icon, iconButton, pathKey } from './dom.js';
import { JobsStrip } from './jobs-strip.js';
import { TerminalPane } from './terminal-pane.js';
import { gridShape, readSaved } from './tiles.js';
import { ZoomView } from './zoom.js';

const api = window.tessera;
const IS_MAC = api.platform === 'darwin';
const MANY = 6; // ask before "Open all subfolders" starts more agents than this
const root = document.documentElement;
root.dataset.theme = api.initialTheme;
root.dataset.platform = api.platform;

const state = {
  folder: null, // the open folder
  recent: [], // [{ path, exists }], newest first
  subfolders: [], // subfolders of the open folder
  orchestrator: null, // TerminalPane running claude in the folder itself
  agents: [], // [{ pane, tile, slot }] in the order they were opened
  ui: {},
  terminal: { fontSize: 13, scrollback: 10000, fontFamily: '' },
  theme: api.initialTheme,
  windowsBuild: 0,
  configError: null,
};
let nextId = 1;
let saveTimer = null;

const key = (p) => pathKey(p, api.platform);

// ---------------------------------------------------------------------------
// Window chrome

const els = {
  app: document.getElementById('app'),
  topbar: document.getElementById('topbar'),
  main: document.getElementById('main'),
  agents: document.getElementById('agents'),
  side: document.getElementById('orchestrator'),
  jobs: document.getElementById('jobs'),
  toasts: document.getElementById('toasts'),
};

const folderName = h('span', { class: 'folder-name' });
const folderBtn = h('button', { class: 'folder-btn', type: 'button', onClick: () => folderMenu() },
  icon('folder', 15), folderName, icon('chevron', 14));
const themeToggle = h('button', { class: 'theme-toggle', type: 'button', role: 'switch', onClick: () => toggleTheme() },
  h('span', { class: 'theme-knob' }), withClass(icon('sun', 13), 'sun'), withClass(icon('moon', 13), 'moon'));
els.topbar.append(folderBtn, h('div', { class: 'spacer' }), themeToggle);

// Start panel: open one subfolder, or all of them. Sits after the tiles.
const pickBtn = h('button', { class: 'btn primary start-btn', type: 'button', onClick: (e) => subfolderPicker(e.currentTarget) },
  icon('folder', 15), h('span', { text: 'Open subfolder' }), icon('chevron', 14));
const allBtn = h('button', { class: 'btn start-btn', type: 'button', onClick: () => openAllSubfolders() },
  icon('folders', 15), h('span', { text: 'Open all subfolders' }));
const start = h('div', { class: 'start' }, pickBtn, allBtn);
const noFolder = h('button', { class: 'btn primary start-btn', type: 'button', onClick: () => folderMenu() }, icon('folder', 15), 'Open folder');
els.agents.append(start);
els.main.append(noFolder);
new ResizeObserver(() => layoutGrid()).observe(els.agents);

// Orchestrator sidebar.
const orchTitle = h('span', { class: 'side-title' });
const orchHead = h('header', { class: 'side-head' }, icon('network', 15), h('span', { class: 'side-name', text: 'Orchestrator' }), orchTitle);
const orchSlot = h('div', { class: 'side-slot' });
const resizer = h('div', { class: 'side-resizer' });
els.side.append(resizer, h('div', { class: 'side-card' }, orchHead, orchSlot));
setupSidebarResize();

const zoom = new ZoomView(els.main, {
  getSettings: () => settings(),
  onClose: (pane) => {
    const agent = state.agents.find((a) => a.pane === pane);
    if (agent) {
      pane.mount(agent.slot);
      pane.setFontSize(tileFont());
    }
    els.main.classList.remove('zoomed');
  },
});

const jobs = new JobsStrip(els.jobs);

function withClass(el, cls) {
  el.classList.add(cls);
  return el;
}

// ---------------------------------------------------------------------------
// State from the main process

function applyState(s) {
  if (!s) return;
  state.recent = s.recent ?? state.recent;
  state.ui = s.ui ?? state.ui;
  state.windowsBuild = s.windowsBuild ?? state.windowsBuild;
  if (state.ui.orchestratorWidth) els.app.style.setProperty('--side-w', `${state.ui.orchestratorWidth}px`);
  const termChanged = s.terminal && JSON.stringify(s.terminal) !== JSON.stringify(state.terminal);
  if (s.terminal) state.terminal = s.terminal;
  if (s.theme && s.theme !== state.theme) setTheme(s.theme, false);
  else if (termChanged) applySettingsToAll();
  if ('configError' in s && s.configError !== state.configError) {
    state.configError = s.configError;
    if (s.configError) toast(s.configError, { sticky: true });
  }
  if (s.jobs) jobs.update(s.jobs);
}

function settings() {
  return {
    theme: state.theme,
    fontSize: state.terminal.fontSize,
    fontFamily: state.terminal.fontFamily,
    scrollback: state.terminal.scrollback,
    windowsBuild: state.windowsBuild,
  };
}

// Tiles are previews, so their text is a little smaller.
const tileFont = () => Math.max(9, state.terminal.fontSize - 2);

function applySettingsToAll() {
  const s = settings();
  state.orchestrator?.applySettings(s);
  for (const { pane } of state.agents) pane.applySettings(s, zoom.pane === pane ? s.fontSize : tileFont());
  zoom.applySettings(s);
}

// A pane's name: its path inside the open folder, or the folder's own name.
function labelFor(cwd) {
  if (state.folder) {
    const rootKey = key(state.folder);
    const k = key(cwd);
    if (k === rootKey) return basename(state.folder);
    const sep = api.platform === 'win32' ? '\\' : '/';
    if (k.startsWith(rootKey + sep)) return cwd.slice(rootKey.length + 1).replace(/[\\/]+$/, '').replace(/\\/g, '/');
  }
  return basename(cwd);
}

// Show only what can be used right now.
function render() {
  const hasFolder = Boolean(state.folder);
  folderName.textContent = hasFolder ? basename(state.folder) : '';
  folderBtn.title = state.folder ?? '';
  folderBtn.hidden = !hasFolder;
  noFolder.hidden = hasFolder;
  els.agents.hidden = !hasFolder;
  els.side.hidden = !hasFolder;
  const unopened = unopenedSubfolders();
  start.hidden = !hasFolder || unopened.length === 0;
  allBtn.hidden = unopened.length < 2;
  start.classList.toggle('alone', state.agents.length === 0);
  layoutGrid();
}

function layoutGrid() {
  const count = state.agents.length + (start.hidden ? 0 : 1);
  const box = els.agents.getBoundingClientRect();
  const { cols, rows } = gridShape(count, box.width / Math.max(1, box.height));
  els.agents.style.setProperty('--cols', cols);
  els.agents.style.setProperty('--rows', rows);
}

// ---------------------------------------------------------------------------
// Folder

async function folderMenu() {
  state.recent = (await api.folder.recent()) ?? state.recent;
  const others = state.recent.filter((r) => !state.folder || key(r.path) !== key(state.folder));
  if (!others.length) {
    pickFolder();
    return;
  }
  const choice = await api.menu([
    ...others.map((r, i) => ({ id: String(i), label: r.path, enabled: r.exists })),
    { type: 'separator' },
    { id: 'pick', label: 'Open folder…' },
  ]);
  if (choice === 'pick') pickFolder();
  else if (choice !== null) openFolder(others[Number(choice)].path);
}

async function pickFolder() {
  const folder = await api.folder.pick();
  if (folder) openFolder(folder);
}

function allPanes() {
  return [state.orchestrator, ...state.agents.map((a) => a.pane)].filter(Boolean);
}

// Switch folders: this folder's sessions are saved and closed, and the other
// folder's come back (resuming their conversations).
async function openFolder(folder) {
  if (state.folder && key(folder) === key(state.folder)) return;
  const running = allPanes().filter((p) => p.running).length;
  if (running) {
    const { confirmed } = await api.confirm({
      message: `Open ${basename(folder)}?`,
      detail: `${running} running session${running === 1 ? '' : 's'} in ${basename(state.folder)} will close. They resume when you open it again.`,
      confirm: 'Open',
    });
    if (!confirmed) return;
  }
  const res = await api.folder.open(folder);
  if (!res || res.error) {
    toast(res?.error ?? 'Could not open the folder.');
    return;
  }
  if (saveTimer) saveNow();
  await closeAll();
  state.recent = res.recent;
  showFolder(res.folder, res.session);
}

function showFolder(folder, session) {
  state.folder = folder;
  state.subfolders = [];
  if (folder) {
    const saved = readSaved(session);
    openOrchestrator(saved.orchestrator);
    for (const a of saved.agents) openAgent(a.cwd, { mode: 'restore', sessionId: a.sessionId, save: false });
    els.side.classList.add('enter');
    refreshSubfolders();
  }
  render();
}

async function refreshSubfolders() {
  const folder = state.folder;
  if (!folder) return;
  const res = await api.folder.subfolders(folder);
  if (state.folder !== folder) return; // switched meanwhile
  state.subfolders = res?.folders ?? [];
  render();
}

function unopenedSubfolders() {
  const open = new Set(state.agents.map((a) => key(a.pane.cwd)));
  return state.subfolders.filter((d) => !open.has(key(d)));
}

// A small list of subfolders under the button.
function subfolderPicker(anchor) {
  document.querySelector('.picker')?.remove();
  const options = unopenedSubfolders();
  if (!options.length) return;
  const close = () => {
    picker.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (e) => {
    if (!picker.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const picker = h('div', { class: 'picker', role: 'menu' },
    ...options.map((dir) => h('button', {
      class: 'picker-item',
      type: 'button',
      role: 'menuitem',
      onClick: () => {
        close();
        openAgent(dir);
      },
    }, icon('folder', 14), h('span', { text: labelFor(dir) }))));
  const a = anchor.getBoundingClientRect();
  const m = els.main.getBoundingClientRect();
  Object.assign(picker.style, { left: `${a.left - m.left}px`, top: `${a.bottom - m.top + 6}px`, minWidth: `${a.width}px` });
  els.main.append(picker);
  picker.querySelector('button')?.focus();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
}

async function openAllSubfolders() {
  await refreshSubfolders();
  const todo = unopenedSubfolders();
  if (!todo.length) return;
  if (todo.length > MANY) {
    const { confirmed } = await api.confirm({ message: `Open ${todo.length} agents?`, detail: `One in each subfolder of ${basename(state.folder)}.`, confirm: 'Open' });
    if (!confirmed) return;
  }
  for (const dir of todo) openAgent(dir, { save: false });
  saveSoon();
}

// ---------------------------------------------------------------------------
// Orchestrator and agents

function paneEvents() {
  return {
    onMenu: (pane) => paneMenu(pane),
    onSessionChange: () => saveSoon(),
  };
}

function openOrchestrator(sessionId) {
  const pane = new TerminalPane({
    id: String(nextId++),
    cwd: state.folder,
    role: 'orchestrator',
    mode: sessionId ? 'restore' : 'new',
    sessionId,
    label: 'orchestrator',
    settings: settings(),
    events: paneEvents(),
  });
  state.orchestrator = pane;
  pane.bindHeader({ root: orchHead, title: orchTitle });
  pane.mount(orchSlot);
  pane.start();
  pane.focus();
}

function openAgent(cwd, { mode = 'new', sessionId = null, save = true } = {}) {
  const pane = new TerminalPane({
    id: String(nextId++),
    cwd,
    role: 'agent',
    mode,
    sessionId,
    label: labelFor(cwd),
    settings: settings(),
    fontSize: tileFont(),
    events: paneEvents(),
  });
  const title = h('span', { class: 'tile-title' });
  const slot = h('div', { class: 'tile-slot' });
  const head = h('header', { class: 'tile-head' },
    h('span', { class: 'dot' }),
    h('span', { class: 'tile-name', text: pane.label, title: cwd }),
    title,
    iconButton('x', 'Close', (e) => {
      e.stopPropagation();
      closeAgent(pane);
    }, 'tile-close'));
  const tile = h('article', { class: 'tile', tabindex: 0 }, head, slot);
  pane.bindHeader({ root: tile, title });
  tile.addEventListener('click', (e) => {
    if (!e.target.closest('button')) zoomIn(pane);
  });
  tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === tile) zoomIn(pane);
  });
  els.agents.insertBefore(tile, start);
  state.agents.push({ pane, tile, slot });
  render();
  pane.mount(slot);
  pane.start();
  if (save) saveSoon();
  return pane;
}

async function closeAgent(pane) {
  if (pane.running && state.ui.confirmClose !== false) {
    const { confirmed, checked } = await api.confirm({
      message: `Close ${pane.label}?`,
      detail: 'Claude is still running in this folder.',
      confirm: 'Close',
      checkbox: "Don't ask again",
    });
    if (!confirmed) return;
    if (checked) {
      state.ui.confirmClose = false;
      api.setPrefs({ confirmClose: false });
    }
  }
  const i = state.agents.findIndex((a) => a.pane === pane);
  if (i < 0) return;
  if (zoom.pane === pane) await zoom.close({ animate: false });
  const [agent] = state.agents.splice(i, 1);
  pane.dispose();
  agent.tile.remove();
  render();
  saveSoon();
}

function zoomIn(pane) {
  const agent = state.agents.find((a) => a.pane === pane);
  if (!agent || zoom.isOpen) return;
  document.querySelector('.picker')?.remove();
  els.main.classList.add('zoomed');
  zoom.open(pane, agent.tile);
}

// End everything without touching the folder's saved state.
async function closeAll() {
  if (zoom.isOpen) await zoom.close({ animate: false });
  for (const { pane, tile } of state.agents) {
    pane.dispose();
    tile.remove();
  }
  state.agents = [];
  state.orchestrator?.dispose();
  state.orchestrator = null;
  els.side.classList.remove('enter');
}

// ---------------------------------------------------------------------------
// Saved state, one per folder: the orchestrator's conversation and the agents

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state.folder) return;
  api.saveSession(state.folder, {
    orchestrator: state.orchestrator?.sessionId ?? null,
    agents: state.agents.map((a) => a.pane.payload()),
  });
}

// ---------------------------------------------------------------------------
// Terminal menu: only entries that can act right now

async function paneMenu(pane) {
  const items = [
    pane.term.hasSelection() && { id: 'copy', label: 'Copy' },
    pane.status === 'running' && { id: 'paste', label: 'Paste' },
    { id: 'select', label: 'Select all' },
    { id: 'clear', label: 'Clear' },
    !pane.running && { id: 'restart', label: 'Restart' },
  ].filter(Boolean);
  const choice = await api.menu(items);
  const actions = {
    copy: () => pane.copySelection(),
    paste: () => pane.paste(),
    select: () => pane.selectAll(),
    clear: () => pane.clear(),
    restart: () => pane.restart(),
  };
  actions[choice]?.();
  if (choice && !pane.disposed) pane.focus();
}

// ---------------------------------------------------------------------------
// Appearance

function setTheme(theme, persist = true) {
  state.theme = theme;
  root.dataset.theme = theme;
  themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
  themeToggle.title = theme === 'dark' ? 'Switch to light' : 'Switch to dark';
  applySettingsToAll();
  if (persist) api.setTheme(theme);
}

function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function changeFontSize(step) {
  const next = step === 0 ? 13 : Math.min(32, Math.max(8, state.terminal.fontSize + step));
  if (next === state.terminal.fontSize) return;
  state.terminal = { ...state.terminal, fontSize: next };
  applySettingsToAll();
  api.setPrefs({ fontSize: next });
}

function setupSidebarResize() {
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const startX = e.clientX;
    const startW = els.side.getBoundingClientRect().width;
    const max = () => Math.max(320, window.innerWidth - 360);
    let width = startW;
    const move = (ev) => {
      width = Math.round(Math.min(max(), Math.max(280, startW - (ev.clientX - startX))));
      els.app.style.setProperty('--side-w', `${width}px`);
    };
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      resizer.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      state.ui.orchestratorWidth = width;
      api.setPrefs({ orchestratorWidth: width });
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
    resizer.addEventListener('pointercancel', up);
  });
}

// ---------------------------------------------------------------------------
// Toasts

function toast(message, { sticky = false } = {}) {
  const el = h('div', { class: 'toast', role: 'status' }, h('span', { class: 'toast-text', text: message }));
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 160);
  };
  el.append(iconButton('x', 'Dismiss', close, 'toast-close'));
  els.toasts.append(el);
  while (els.toasts.children.length > 4) els.toasts.firstElementChild.remove();
  if (!sticky) setTimeout(close, 4500);
}

// ---------------------------------------------------------------------------
// Keyboard

window.addEventListener('keydown', (e) => {
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  let handled = true;
  if (e.shiftKey && !e.altKey) {
    switch (k) {
      case 'o': folderMenu(); break;
      case 'l': toggleTheme(); break;
      case 'w': if (zoom.isOpen) zoom.close(); else handled = false; break;
      default: handled = false;
    }
  } else if (!e.altKey && !e.shiftKey && k === '`' && zoom.isOpen) {
    zoom.toggleShell();
  } else if (!e.altKey && !e.shiftKey && (k === '=' || k === '+' || k === '-' || k === '0')) {
    changeFontSize(k === '0' ? 0 : k === '-' ? -1 : 1);
  } else if (!e.altKey && !e.shiftKey && /^[1-9]$/.test(k)) {
    const agent = state.agents[Number(k) - 1];
    if (agent && !zoom.isOpen) zoomIn(agent.pane);
    else handled = false;
  } else {
    handled = false;
  }
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// Dropping a file outside a terminal must not navigate the window to it.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Requests from the `tessera` command in a pane

function controlPane(id) {
  const pane = allPanes().find((p) => p.id === String(id));
  if (!pane) throw new Error(`There is no pane ${id}. Run "tessera list".`);
  return pane;
}

const control = {
  list: () => allPanes().map((p) => ({
    id: p.id, name: p.role === 'orchestrator' ? basename(p.cwd) : p.label, role: p.role, cwd: p.cwd,
    state: p.controlState, idle: p.idleSeconds, title: p.title,
  })),
  send: async ({ id, text }) => {
    await controlPane(id).sendText(String(text));
    return true;
  },
  read: ({ id, lines }) => controlPane(id).readText(Math.min(2000, Math.max(1, Number(lines) || 60))),
  open: ({ cwd }) => {
    if (!state.folder) throw new Error('No folder is open.');
    const existing = state.agents.find((a) => key(a.pane.cwd) === key(cwd));
    return { id: (existing?.pane ?? openAgent(cwd)).id };
  },
};

api.control.onRequest(async (reqId, cmd, args) => {
  try {
    if (!Object.hasOwn(control, cmd)) throw new Error(`Unknown command "${cmd}".`);
    api.control.reply(reqId, null, await control[cmd](args ?? {}));
  } catch (err) {
    api.control.reply(reqId, err.message, null);
  }
});

// ---------------------------------------------------------------------------
// Wiring

function paneForPty(ptyId) {
  for (const p of allPanes()) if (p.ptyId === ptyId) return p;
  return zoom.shell?.ptyId === ptyId ? zoom.shell : null;
}

api.pty.onData((ptyId, data) => {
  const pane = paneForPty(ptyId);
  if (pane) pane.handleData(data);
  else api.pty.ack(ptyId, data.length);
});
api.pty.onExit((ptyId, code) => paneForPty(ptyId)?.handleExit(code));
api.onConfigChanged((s) => applyState(s));
api.onToast((msg) => toast(msg));
api.onFocus(() => refreshSubfolders());
api.jobs.onUpdate((s) => jobs.update(s));
window.addEventListener('beforeunload', () => {
  if (saveTimer) saveNow();
});

async function boot() {
  // xterm measures the font when a terminal opens, so load it first.
  await Promise.allSettled([
    document.fonts.load('13px "Geist Mono Variable"'),
    document.fonts.load('600 13px "Geist Mono Variable"'),
    document.fonts.load('13px "Geist Variable"'),
  ]);
  const s = await api.init();
  setTheme(s.theme, false);
  applyState(s);
  showFolder(s.folder, s.session);
  els.app.classList.add('ready');
}

boot();
