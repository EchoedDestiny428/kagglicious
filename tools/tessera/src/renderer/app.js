import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { checkInMessage, hookState, notificationText, rulesHash, rulesUpdateMessage, settingCommands, TaskWatch } from './checkins.js';
import { basename, h, icon, iconButton, pathKey, switchToggle } from './dom.js';
import { JobsStrip } from './jobs-strip.js';
import { RulesEditor } from './rules-editor.js';
import { openSettings } from './settings.js';
import { TerminalPane } from './terminal-pane.js';
import { agentStateText, gridLayout, readSaved } from './tiles.js';
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
  sync: { enabled: false }, // open folder's repo vs GitHub (repos with sync.sh only)
  orchestrator: null, // TerminalPane running claude in the folder itself
  agents: [], // [{ pane, tile, slot }] in the order they were opened
  ui: {},
  terminal: { fontSize: 13, scrollback: 10000, fontFamily: '' },
  claude: { agent: { model: '', effort: '' }, permissionMode: '', remoteControl: false },
  boost: false, // see BOOST_MINUTES
  startAtLogin: null, // null where the system has no login items
  rules: null, // RULES.md of the open folder, or null
  orchestratorPrefs: { checkIns: false, checkInterval: 5 },
  theme: api.initialTheme,
  windowsBuild: 0,
  configError: null,
};
let nextId = 1;
let saveTimer = null;
// sessionId -> rulesHash of the rules that conversation has been given, for
// the open folder. A resumed conversation keeps the system prompt it started
// with, so rules it has not seen are sent to it as a message.
let rulesSeen = {};

const key = (p) => pathKey(p, api.platform);

// Boost (in Settings): for a few minutes, every prompt the orchestrator or an
// agent gets asks it to think harder, through the prompt hook (like Claude
// Code's "ultrathink"). It is not saved; it switches itself off.
const BOOST_MINUTES = 10;
const BOOST_CONTEXT = 'The user switched on Boost in Tessera, requesting deeper reasoning on this turn. ' +
  'Reason as thoroughly as the task warrants.';
let boostTimer = null;

// ---------------------------------------------------------------------------
// Window chrome

const els = {
  app: document.getElementById('app'),
  topbar: document.getElementById('topbar'),
  main: document.getElementById('main'),
  agents: document.getElementById('agents'),
  rail: document.getElementById('rail'),
  side: document.getElementById('orchestrator'),
  jobs: document.getElementById('jobs'),
  toasts: document.getElementById('toasts'),
};

const folderName = h('span', { class: 'folder-name' });
const syncDot = h('span', { class: 'sync-dot', hidden: true });
const folderBtn = h('button', { class: 'folder-btn', type: 'button', onClick: () => folderMenu() },
  icon('folder', 15), folderName, syncDot, icon('chevron', 14));
const themeToggle = h('button', { class: 'theme-toggle', type: 'button', role: 'switch', onClick: () => toggleTheme() },
  h('span', { class: 'theme-knob' }), withClass(icon('sun', 13), 'sun'), withClass(icon('moon', 13), 'moon'));
// Agents as terminal tiles or as a list; same knob-switch shape as the theme toggle.
const viewToggle = h('button', { class: 'theme-toggle view-toggle', type: 'button', role: 'switch', onClick: () => setAgentView(listView() ? 'grid' : 'list') },
  h('span', { class: 'theme-knob' }), withClass(icon('grid', 13), 'grid-icon'), withClass(icon('list', 13), 'list-icon'));
const settingsBtn = iconButton('settings', 'Settings', (e) => showSettings(e.currentTarget), 'topbar-btn');
els.topbar.append(folderBtn, viewToggle, h('div', { class: 'spacer' }), settingsBtn, themeToggle);

// Start panel: open one subfolder, or all of them. Sits after the tiles.
const pickBtn = h('button', { class: 'btn primary start-btn', type: 'button', onClick: (e) => subfolderPicker(e.currentTarget) },
  icon('folder', 15), h('span', { text: 'Open subfolder' }), icon('chevron', 14));
const allBtn = h('button', { class: 'btn start-btn', type: 'button', onClick: () => openAllSubfolders() },
  icon('folders', 15), h('span', { text: 'Open all subfolders' }));
const start = h('div', { class: 'start' }, pickBtn, allBtn);

// Left rail: add a subagent (pick a subfolder, or create one).
const addBtn = h('button', { class: 'add-agent', type: 'button', title: 'Add subagent', 'aria-label': 'Add subagent', onClick: (e) => subfolderPicker(e.currentTarget, { side: 'right' }) },
  icon('plus', 18));
els.rail.append(addBtn);
const noFolder = h('button', { class: 'btn primary start-btn', type: 'button', onClick: () => folderMenu() }, icon('folder', 15), 'Open folder');
els.agents.append(start);
els.main.append(noFolder);
new ResizeObserver(() => layoutGrid()).observe(els.agents);

// Orchestrator sidebar.
const orchTitle = h('span', { class: 'side-title' });
const checkInsBtn = switchToggle('Check-ins', 'Tell the orchestrator how the agents it gave tasks to are doing', () => setCheckIns(!state.orchestratorPrefs.checkIns));
const rulesBtn = h('button', { class: 'text-btn rules-btn', type: 'button', title: 'Rules for every session (RULES.md)', onClick: () => toggleRules() },
  icon('book', 14), h('span', { text: 'Rules' }));
const orchHead = h('header', { class: 'side-head' }, icon('network', 15), h('span', { class: 'side-name', text: 'Orchestrator' }), orchTitle, rulesBtn, checkInsBtn);
const orchSlot = h('div', { class: 'side-slot' });
const resizer = h('div', { class: 'side-resizer' });
const sideCard = h('div', { class: 'side-card' }, orchHead, orchSlot);
const rulesEditor = new RulesEditor(sideCard, {
  onClose: (text) => {
    rulesBtn.classList.remove('active');
    rulesChanged(text);
  },
  onError: (msg) => toast(msg, { sticky: true }),
});
els.side.append(resizer, sideCard);
setupSidebarResize();

const zoom = new ZoomView(els.main, {
  getSettings: () => settings(),
  onRelease: (pane) => {
    const agent = state.agents.find((a) => a.pane === pane);
    if (agent) {
      pane.mount(agent.slot);
      pane.setFontSize(tileFont());
    }
  },
  onClosed: () => els.main.classList.remove('zoomed'),
});

// While zoomed: show agent n (1-based), or step through the agents in order.
function showAgent(n) {
  const agent = state.agents[n - 1];
  if (!agent) return false;
  if (zoom.isOpen) zoom.switchTo(agent.pane, zoomOrigin(agent));
  else zoomIn(agent.pane);
  return true;
}

function stepAgent(step) {
  const n = state.agents.length;
  if (!zoom.isOpen || n < 2) return;
  const at = state.agents.findIndex((a) => a.pane === zoom.pane);
  showAgent(((at + step + n) % n) + 1);
}

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
  renderView();
  const termChanged = s.terminal && JSON.stringify(s.terminal) !== JSON.stringify(state.terminal);
  if (s.terminal) state.terminal = s.terminal;
  if (s.theme && s.theme !== state.theme) setTheme(s.theme, false);
  else if (termChanged) applySettingsToAll();
  if ('configError' in s && s.configError !== state.configError) {
    state.configError = s.configError;
    if (s.configError) toast(s.configError, { sticky: true });
  }
  if (s.jobs) jobs.update(s.jobs);
  if (s.claude) state.claude = s.claude;
  if ('startAtLogin' in s) state.startAtLogin = s.startAtLogin;
  if ('rules' in s) state.rules = s.rules;
  if (s.orchestrator) state.orchestratorPrefs = s.orchestrator;
  renderCheckIns();
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
  const unsynced = state.sync.enabled && state.sync.unsynced;
  syncDot.hidden = !unsynced;
  folderBtn.title = state.folder ? `${state.folder}${unsynced ? '\nNot synced with GitHub' : ''}` : '';
  folderBtn.hidden = !hasFolder;
  noFolder.hidden = hasFolder;
  els.agents.hidden = !hasFolder;
  els.side.hidden = !hasFolder;
  els.rail.hidden = !hasFolder;
  // The start panel only while no agent is open; after that, the + in the rail.
  start.hidden = !hasFolder || state.agents.length > 0;
  allBtn.hidden = unopenedSubfolders().length < 2;
  start.classList.toggle('alone', state.agents.length === 0);
  renderView();
}

// ---------------------------------------------------------------------------
// Agent view: tiles (terminals in a grid) or a list (one row per agent)

const listView = () => state.ui.agentView === 'list';

function setAgentView(view) {
  state.ui = { ...state.ui, agentView: view };
  renderView();
  api.setPrefs({ agentView: view });
}

function renderView() {
  const has = state.agents.length > 0;
  viewToggle.hidden = !state.folder || !has;
  viewToggle.setAttribute('aria-checked', String(listView()));
  viewToggle.title = listView() ? 'Show as tiles' : 'Show as list';
  els.agents.classList.toggle('list', listView() && has);
  renderRows();
  layoutGrid();
}

// Each row's state text (the dot, title and needs-you ring follow the pane by themselves).
function renderRows() {
  if (!listView()) return;
  for (const { pane, rowState } of state.agents) rowState.textContent = agentStateText(pane.controlState, pane.idleSeconds);
}

// Where the zoomed view grows from: the agent's tile, or its row in the list.
const zoomOrigin = (agent) => (listView() ? agent.row : agent.tile);

// Tiles have a minimum size; when they do not all fit, the grid scrolls.
const MIN_TILE = { minW: 300, minH: 200, gap: 8 };

function layoutGrid() {
  if (els.agents.classList.contains('list')) return;
  const count = state.agents.length + (start.hidden ? 0 : 1);
  const { cols, rows, scroll } = gridLayout(count, els.agents.clientWidth, els.agents.clientHeight, MIN_TILE);
  els.agents.style.setProperty('--cols', cols);
  els.agents.style.setProperty('--rows', rows);
  els.agents.style.setProperty('--row-h', scroll ? `${MIN_TILE.minH}px` : 'minmax(0, 1fr)');
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
    ...(others.length ? [{ type: 'separator' }] : []),
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
  const busy = allPanes().map(busyReason).filter(Boolean);
  if (busy.length) {
    const { confirmed } = await api.confirm({
      message: `Open ${basename(folder)}?`,
      detail: `${busy.join(' ')} Sessions in ${basename(state.folder)} close and resume when you open it again.`,
      confirm: 'Open',
    });
    if (!confirmed) return;
  }
  await rulesEditor.close(); // saves pending edits while they still go to this folder
  const res = await api.folder.open(folder);
  if (!res || res.error) {
    toast(res?.error ?? 'Could not open the folder.');
    return;
  }
  if (saveTimer) saveNow();
  await closeAll();
  state.recent = res.recent;
  state.rules = res.rules; // before any session starts, so each one records the right rules
  showFolder(res.folder, res.session);
}

function showFolder(folder, session) {
  state.folder = folder;
  state.subfolders = [];
  if (folder) {
    const saved = readSaved(session);
    rulesSeen = saved.rulesSeen;
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
// Subfolders without an agent, then "New subfolder…", which asks for a name.
//   side: 'below' the anchor (start panel) or to its 'right' (the + in the rail)
function subfolderPicker(anchor, { side = 'below' } = {}) {
  const existing = document.querySelector('.picker');
  existing?.close();
  if (existing?.anchor === anchor) return; // a second click closes it
  const options = unopenedSubfolders();
  const close = () => {
    picker.remove();
    anchor.classList.remove('open');
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
  // The name form that replaces the list.
  const askName = () => {
    const input = h('input', { class: 'picker-input', type: 'text', placeholder: 'Folder name', spellcheck: 'false', maxlength: '100' });
    const error = h('div', { class: 'picker-error', hidden: true });
    const create = async () => {
      const res = await api.folder.create(input.value);
      if (!res || res.error) {
        error.textContent = res?.error ?? 'Could not create the folder.';
        error.hidden = false;
        input.focus();
        return;
      }
      close();
      openAgent(res.folder);
      refreshSubfolders();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        create();
      }
    });
    input.addEventListener('input', () => {
      error.hidden = true;
    });
    picker.replaceChildren(input, error);
    input.focus();
  };
  const item = (iconName, label, onClick) =>
    h('button', { class: 'picker-item', type: 'button', role: 'menuitem', onClick }, icon(iconName, 14), h('span', { text: label }));
  const picker = h('div', { class: 'picker', role: 'menu' },
    ...options.map((dir) => item('folder', labelFor(dir), () => {
      close();
      openAgent(dir);
    })),
    options.length ? h('div', { class: 'picker-sep' }) : null,
    item('plus', 'New subfolder…', askName));
  picker.anchor = anchor;
  picker.close = close;
  const a = anchor.getBoundingClientRect();
  Object.assign(picker.style, side === 'right'
    ? { left: `${a.right + 8}px`, top: `${a.top}px` }
    : { left: `${a.left}px`, top: `${a.bottom + 6}px`, minWidth: `${a.width}px` });
  document.body.append(picker);
  anchor.classList.add('open');
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
    onStarted: (pane) => rulesStarted(pane),
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
  pane.bindHeader({ root: sideCard, title: orchTitle });
  pane.mount(orchSlot);
  queueStart(pane);
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
  // Its row in the list view.
  const rowTitle = h('span', { class: 'row-title' });
  const rowState = h('span', { class: 'row-state' });
  const row = h('div', { class: 'agent-row', tabindex: 0, role: 'button' },
    h('span', { class: 'dot' }),
    h('span', { class: 'row-name', text: pane.label, title: cwd }),
    rowTitle,
    rowState,
    iconButton('x', 'Close', (e) => {
      e.stopPropagation();
      closeAgent(pane);
    }, 'tile-close'));
  pane.bindHeader({ root: row, title: rowTitle });
  row.addEventListener('click', (e) => {
    if (!e.target.closest('button')) zoomIn(pane);
  });
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === row) zoomIn(pane);
  });
  els.agents.insertBefore(tile, start);
  els.agents.insertBefore(row, start);
  state.agents.push({ pane, tile, slot, row, rowState });
  render();
  pane.mount(slot);
  queueStart(pane);
  if (save) saveSoon();
  return pane;
}

// Why closing this session now would interrupt something, or null if it is
// safe (closing asks Claude to quit cleanly, and the conversation resumes later).
function busyReason(pane) {
  const name = pane.role === 'orchestrator' ? 'The orchestrator' : pane.label;
  if (pane.status !== 'running') return null;
  if (pane.controlState === 'needs-input') return `${name} is waiting for your answer.`;
  if (pane.controlState === 'working') return `${name} is working.`;
  if (pane.userTyping) return `${name} has a message you haven't sent.`;
  return null;
}

async function closeAgent(pane) {
  const reason = busyReason(pane);
  if (reason && state.ui.confirmClose !== false) {
    const { confirmed, checked } = await api.confirm({
      message: `Close ${pane.label}?`,
      detail: reason,
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
  agent.row.remove();
  render();
  saveSoon();
}

function zoomIn(pane) {
  const agent = state.agents.find((a) => a.pane === pane);
  if (!agent || zoom.isOpen) return;
  document.querySelector('.picker')?.close();
  els.main.classList.add('zoomed');
  zoom.open(pane, zoomOrigin(agent));
}

// End everything without touching the folder's saved state.
async function closeAll() {
  await rulesEditor.close();
  if (zoom.isOpen) await zoom.close({ animate: false });
  for (const { pane, tile, row } of state.agents) {
    pane.dispose();
    tile.remove();
    row.remove();
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
    rulesSeen: Object.fromEntries(allPanes()
      .filter((p) => p.sessionId && rulesSeen[p.sessionId])
      .map((p) => [p.sessionId, rulesSeen[p.sessionId]])),
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

const DEFAULT_SIDE_W = 460;

function setupSidebarResize() {
  resizer.title = 'Drag to resize, double-click to reset';
  resizer.addEventListener('dblclick', () => {
    els.app.style.setProperty('--side-w', `${DEFAULT_SIDE_W}px`);
    state.ui.orchestratorWidth = DEFAULT_SIDE_W;
    api.setPrefs({ orchestratorWidth: DEFAULT_SIDE_W });
  });
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
// Settings

function showSettings(anchor) {
  openSettings(anchor, {
    ...state.claude,
    checkInterval: state.orchestratorPrefs.checkInterval,
    notifications: state.ui.notifications !== false,
    startAtLogin: state.startAtLogin,
    fontSize: state.terminal.fontSize,
    boost: state.boost,
    boostMinutes: BOOST_MINUTES,
  }, {
    onChange: async (patch) => {
      if ('fontSize' in patch) {
        changeFontSize(patch.fontSize - state.terminal.fontSize);
        return;
      }
      if ('startAtLogin' in patch) {
        state.startAtLogin = await api.setStartAtLogin(patch.startAtLogin);
        return;
      }
      if ('boost' in patch) {
        setBoost(patch.boost);
        return;
      }
      applyState(await api.setPrefs(patch));
      if (patch.agent) queueAgentSettings(Object.keys(patch.agent));
    },
    onOpenConfig: async () => {
      const err = await api.openConfig();
      if (err) toast(err);
    },
  });
}

// Open agents switch to new Settings by typing /model or /effort into them,
// one command at a time, once each is idle and nothing is half-typed.
// (Claude Code also keeps what they set as its default for new sessions.)
function queueAgentSettings(keys) {
  const values = {};
  for (const k of keys) if (k in state.claude.agent) values[k] = state.claude.agent[k];
  const commands = settingCommands(values);
  for (const { pane } of state.agents) {
    if (pane.status !== 'running' && pane.status !== 'starting') continue;
    pane.pendingCommands ??= new Map();
    for (const [k, cmd] of commands) pane.pendingCommands.set(k, cmd); // the newest value wins
  }
}

function tickAgentSettings() {
  for (const { pane: p } of state.agents) {
    if (!p.pendingCommands?.size || p.status !== 'running') continue;
    if (p.controlState !== 'idle' || p.idleSeconds < 3 || p.userTyping) continue;
    const [k, cmd] = p.pendingCommands.entries().next().value;
    p.pendingCommands.delete(k);
    p.sendText(cmd, { typed: true }).catch(() => {});
  }
}

function setBoost(on) {
  state.boost = Boolean(on);
  clearTimeout(boostTimer);
  if (state.boost) boostTimer = setTimeout(() => setBoost(false), BOOST_MINUTES * 60000);
  // The gear shows a dot while Boost is on.
  settingsBtn.classList.toggle('boosted', state.boost);
  settingsBtn.title = state.boost ? 'Settings (Boost on)' : 'Settings';
  document.querySelector('.settings .boost-row .switch-toggle')?.setAttribute('aria-checked', String(state.boost));
}

// ---------------------------------------------------------------------------
// Check-ins: Tessera tells the orchestrator how the tasks it handed out are going

const watch = new TaskWatch();
const pendingCheckIns = new Map(); // agent id -> latest event
const fromOrchestrator = (from) => Boolean(from) && state.orchestrator?.id === String(from);

async function setCheckIns(on) {
  state.orchestratorPrefs = { ...state.orchestratorPrefs, checkIns: on };
  renderCheckIns();
  applyState(await api.setPrefs({ checkIns: on }));
}

function renderCheckIns() {
  const on = state.orchestratorPrefs.checkIns;
  checkInsBtn.setAttribute('aria-checked', String(on));
  checkInsBtn.title = on
    ? `Tessera reports to the orchestrator when an agent stops, and every ${state.orchestratorPrefs.checkInterval} min while one works`
    : 'Have Tessera report agent progress to the orchestrator';
}

function tickCheckIns() {
  const now = Date.now();
  const agents = state.agents.map(({ pane }) => ({
    id: pane.id,
    name: pane.label,
    state: pane.controlState,
    idleMs: pane.idleSeconds * 1000,
    lastOutputAt: pane.lastOutputAt,
    stoppedAt: pane.stoppedAt,
    message: pane.needsInput ?? '',
  }));
  const events = watch.check(agents, now, state.orchestratorPrefs.checkInterval * 60000);
  if (!state.orchestratorPrefs.checkIns) {
    pendingCheckIns.clear();
    return;
  }
  for (const e of events) pendingCheckIns.set(e.id, e);
  const orch = state.orchestrator;
  // Only when the orchestrator is free and the user is not typing to it.
  if (!pendingCheckIns.size || !orch || orch.status !== 'running') return;
  if (orch.controlState !== 'idle' || orch.idleSeconds < 3 || orch.userTyping) return;
  const batch = [...pendingCheckIns.values()];
  pendingCheckIns.clear();
  // A progress-only check-in is routine: don't notify when the orchestrator answers it.
  orch.routineTurn = batch.every((e) => e.kind === 'working');
  orch.sendText(checkInMessage(batch), { typed: true }).catch(() => {});
}

setInterval(() => {
  tickCheckIns();
  tickRules();
  tickAgentSettings();
  renderRows();
}, 2000);

// ---------------------------------------------------------------------------
// Rulebook (RULES.md): new sessions get it in their system prompt; running
// ones are sent the new text once they are free.

async function toggleRules() {
  if (rulesEditor.isOpen) {
    await rulesEditor.close();
  } else if (state.folder) {
    rulesBtn.classList.add('active');
    await rulesEditor.open();
  }
}

function rulesChanged(text) {
  state.rules = text;
}

// A new conversation got the current rules in its system prompt; a resumed
// one only has what it was given before.
function rulesStarted(pane) {
  if (!pane.sessionId) return;
  if (!pane.resumed) rulesSeen[pane.sessionId] = rulesHash(state.rules);
  else rulesSeen[pane.sessionId] ??= rulesHash(null); // saved before rules existed
  saveSoon();
}

// Send the current rules to sessions that have not seen them, once each is free.
function tickRules() {
  const current = rulesHash(state.rules);
  for (const p of allPanes()) {
    if (p.status !== 'running' || !p.sessionId) continue;
    if (!rulesSeen[p.sessionId] || rulesSeen[p.sessionId] === current) continue;
    if (p.controlState !== 'idle' || p.idleSeconds < 3 || p.userTyping) continue;
    rulesSeen[p.sessionId] = current;
    saveSoon();
    p.routineTurn = true; // no "finished" notification for the acknowledgement
    p.sendText(rulesUpdateMessage(state.rules), { typed: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Notifications: events that arrive together become one notification. The
// main process only shows it while the window is not in front.

const NOTIFY_GATHER_MS = 1500;
let notifyItems = [];
let notifyTimer = null;

function queueNotification(pane, kind, message) {
  const name = pane.role === 'orchestrator' ? 'Orchestrator' : pane.label;
  notifyItems = notifyItems.filter((i) => i.paneId !== pane.id);
  notifyItems.push({ paneId: pane.id, name, kind, message });
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    const items = notifyItems;
    notifyItems = [];
    if (!items.length) return;
    const { title, body } = notificationText(items);
    const first = items.find((i) => i.kind === 'needs-input') ?? items[0];
    api.notify({ title, body, paneId: first.paneId });
  }, NOTIFY_GATHER_MS);
}

// ---------------------------------------------------------------------------
// Starting sessions one at a time, so opening many does not spike the CPU.

const START_GAP_MS = 300;
const startQueue = [];
let starting = false;

function queueStart(pane) {
  startQueue.push(pane);
  if (!starting) runStartQueue();
}

// Always waits after a start, so panes queued meanwhile (one per call) are spaced too.
async function runStartQueue() {
  starting = true;
  while (startQueue.length) {
    const pane = startQueue.shift();
    if (pane.disposed) continue;
    pane.start();
    await new Promise((r) => setTimeout(r, START_GAP_MS));
  }
  starting = false;
}

// ---------------------------------------------------------------------------
// Keyboard

window.addEventListener('keydown', (e) => {
  // Ctrl+Tab on every platform (Cmd+Tab belongs to macOS).
  if (e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey && zoom.isOpen) {
    e.preventDefault();
    e.stopPropagation();
    stepAgent(e.shiftKey ? -1 : 1);
    return;
  }
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  let handled = true;
  if (e.shiftKey && !e.altKey) {
    switch (k) {
      case 'o': folderMenu(); break;
      case 'l': toggleTheme(); break;
      case 'w': if (zoom.isOpen) zoom.close(); else handled = false; break;
      case 'f': if (zoom.isOpen) zoom.openSearch(); else handled = false; break;
      default: handled = false;
    }
  } else if (!e.altKey && !e.shiftKey && k === '`' && zoom.isOpen) {
    zoom.toggleShell();
  } else if (!e.altKey && !e.shiftKey && (k === '=' || k === '+' || k === '-' || k === '0')) {
    changeFontSize(k === '0' ? 0 : k === '-' ? -1 : 1);
  } else if (!e.altKey && !e.shiftKey && /^[1-9]$/.test(k)) {
    handled = showAgent(Number(k));
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
  // For the quit prompt (asked by the main process, not the CLI).
  busy: () => allPanes().map(busyReason).filter(Boolean),
  // Before quitting: save the rules being edited and the folder's sessions.
  flush: async () => {
    await rulesEditor.close();
    if (saveTimer) saveNow();
    return true;
  },
  list: () => ({
    panes: allPanes().map((p) => ({
      id: p.id, name: p.role === 'orchestrator' ? basename(p.cwd) : p.label, role: p.role, cwd: p.cwd,
      state: p.controlState, idle: p.idleSeconds, title: p.title,
    })),
    checkIns: state.orchestratorPrefs.checkIns ? state.orchestratorPrefs.checkInterval : 0,
  }),
  send: async ({ id, text }, from) => {
    const pane = controlPane(id);
    await pane.sendText(String(text));
    if (fromOrchestrator(from) && pane.role === 'agent') {
      watch.started(pane.id, Date.now());
      pendingCheckIns.delete(pane.id);
    }
    return true;
  },
  read: ({ id, lines }, from) => {
    const pane = controlPane(id);
    if (fromOrchestrator(from)) {
      watch.looked(pane.id, pane.controlState !== 'working', Date.now());
      pendingCheckIns.delete(pane.id);
    }
    return pane.readText(Math.min(2000, Math.max(1, Number(lines) || 60)));
  },
  // From the Claude Code hooks Tessera installs (via `tessera hook` in the pane).
  hook: ({ event, type, message, sessionId }, from) => {
    const pane = allPanes().find((p) => p.id === String(from));
    if (!pane) return false;
    if (sessionId && sessionId !== pane.sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
      // /clear or /resume moved the pane to another conversation: resume that one next time.
      pane.sessionId = sessionId;
      saveSoon();
    }
    const what = hookState({ event, type, message });
    if (what === 'needs-input') {
      pane.setNeedsInput(message);
      queueNotification(pane, 'needs-input', message);
    } else if (what === 'stopped') {
      pane.markStopped();
      const routine = pane.routineTurn;
      pane.routineTurn = false;
      if (!routine) queueNotification(pane, 'stopped', message);
    } else if (what === 'prompt') {
      pane.clearNeedsInput();
      // Not for Tessera's own messages (rules, check-ins).
      if (state.boost && !pane.routineTurn) return { context: BOOST_CONTEXT };
    }
    return true;
  },
  open: ({ cwd }) => {
    if (!state.folder) throw new Error('No folder is open.');
    const existing = state.agents.find((a) => key(a.pane.cwd) === key(cwd));
    return { id: (existing?.pane ?? openAgent(cwd)).id };
  },
};

api.control.onRequest(async (reqId, cmd, args, from) => {
  try {
    if (!Object.hasOwn(control, cmd)) throw new Error(`Unknown command "${cmd}".`);
    api.control.reply(reqId, null, await control[cmd](args ?? {}, from));
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
api.onToast((msg, opts) => toast(msg, { sticky: opts?.sticky === true }));
api.onFocus(() => refreshSubfolders());
api.rules.onChanged((text) => {
  if (rulesEditor.isOpen) rulesEditor.external(text);
  else rulesChanged(text);
});
api.sync.onState((s) => {
  state.sync = s ?? { enabled: false };
  render();
});
api.onNotifyClick((paneId) => {
  const pane = allPanes().find((p) => p.id === paneId);
  if (!pane) return;
  if (pane.role === 'orchestrator') {
    if (zoom.isOpen) zoom.close({ animate: false });
    pane.focus();
  } else if (zoom.pane !== pane) {
    if (zoom.isOpen) zoom.close({ animate: false }).then(() => zoomIn(pane));
    else zoomIn(pane);
  }
});
api.jobs.onUpdate((s) => jobs.update(s));
window.addEventListener('beforeunload', () => {
  rulesEditor.saveSync();
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
