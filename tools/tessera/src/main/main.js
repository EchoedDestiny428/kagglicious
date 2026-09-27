import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, screen, session, shell } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, folderKey } from './config.js';
import { ControlServer } from './control.js';
import { APP_ID, createShortcut, getStartAtLogin, rebuildIfStale, setStartAtLogin } from './desktop.js';
import { isInside, listDir, listSubfolders } from './folders.js';
import { runSync, syncRoot, syncStatus, unsynced } from './gitsync.js';
import { MAX_RULES, promptText, readRules, RULES_FILE, TEMPLATE, writeRules } from './rules.js';
import { jobsConfigured, JobsPoller } from './jobs.js';
import { AGENT_HINT, buildCommand, childEnv, getEnv, hookSettings, ORCHESTRATION_HINT, UUID_RE } from './launch.js';
import { PtyManager } from './ptys.js';
import { hasTranscript } from './sessions.js';

const ROOT = app.getAppPath();
const PLATFORM = process.platform;
const THEMES = {
  dark: { bg: '#000000', fg: '#ededed' },
  light: { bg: '#f2f2f2', fg: '#0a0a0a' },
};
const TITLEBAR_HEIGHT = 40;
// Files a pane's processes run directly must live outside the asar archive.
const unpacked = (p) => p.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
const BIN_DIR = unpacked(path.join(ROOT, 'bin'));
const CLI_PATH = unpacked(path.join(ROOT, 'src', 'cli', 'tessera.mjs'));

let win = null;
let quitting = false;
let store;
let ptys;
let poller;
let control = null;
let watcher = null; // file-tree watch for the zoomed agent
let hooksFile = null; // --settings file that makes claude report to Tessera
let rulesWatcher = null; // RULES.md of the open folder
const sync = { folder: null, root: null, lastFetch: 0, running: false }; // sync reminder state

// ---------------------------------------------------------------------------
// Startup

if (process.argv.includes('--create-shortcut')) {
  // `npm run shortcut`: add the menu entry and exit.
  app.whenReady().then(() => {
    console.log(createShortcut(app, shell, ROOT));
    app.exit(0);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  if (PLATFORM === 'win32') app.setAppUserModelId(APP_ID);
  app.whenReady().then(start);
}

function configPath() {
  if (process.env.TESSERA_CONFIG) return path.resolve(process.env.TESSERA_CONFIG);
  // Running from source: next to package.json (ignored by git). Packaged: the
  // per-user data folder, since the app folder is read-only.
  return app.isPackaged ? path.join(app.getPath('userData'), 'config.local.json') : path.join(ROOT, 'config.local.json');
}

async function start() {
  if (PLATFORM === 'darwin' && app.isPackaged) await adoptLoginShellPath();
  if (!app.isPackaged) {
    try {
      rebuildIfStale(ROOT);
    } catch (err) {
      dialog.showErrorBox('Tessera', `Could not build the page: ${err.message}\nRun: npm run build`);
    }
  }

  store = new ConfigStore(configPath());
  store.load();
  store.watch();
  store.on('change', onConfigChanged);
  store.on('write-error', (err) => send('app:toast', `Could not save settings: ${err.code || err.message}`));

  ptys = new PtyManager({
    onData: (id, data) => send('pty:data', id, data),
    onExit: (id, code, signal) => send('pty:exit', id, code ?? null, signal ?? null),
  });

  poller = new JobsPoller({ getConfig: () => store.config, onUpdate: (state) => send('jobs:update', state) });

  hooksFile = writeHooksFile();
  control = new ControlServer({ handle: handleControl });
  try {
    await control.start();
  } catch (err) {
    console.error('tessera: control channel unavailable:', err.message);
    control = null;
  }

  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  nativeTheme.themeSource = currentTheme();
  buildMenu();
  registerIpc();
  createWindow();

  powerMonitor.on('resume', () => poller.refresh());
}

// Apps launched from Finder get a minimal PATH; take the user's login-shell PATH
// so `claude` resolves the same way it does in their terminal.
function adoptLoginShellPath() {
  return new Promise((resolve) => {
    const sh = process.env.SHELL || '/bin/zsh';
    execFile(sh, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { timeout: 4000 }, (err, stdout) => {
      const m = /__PATH__(.*)__PATH__/.exec(stdout || '');
      if (!err && m && m[1]) process.env.PATH = m[1];
      resolve();
    });
  });
}

function currentTheme() {
  return store.config.ui.theme ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
}

function buildMenu() {
  if (PLATFORM !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs menu roles for Cmd+C/V/Q and window management to work.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  );
}

// ---------------------------------------------------------------------------
// Window

function windowBounds() {
  const saved = store.config.window;
  const area = screen.getPrimaryDisplay().workArea;
  const fallback = { width: Math.min(1440, area.width), height: Math.min(900, area.height) };
  if (!saved) return fallback;
  const width = Math.min(saved.width, area.width);
  const height = Math.min(saved.height, area.height);
  if (saved.x === null || saved.y === null) return { width, height };
  // Only reuse the position if the title bar would land on a connected display.
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x + saved.width - 120 > a.x && saved.x + 120 < a.x + a.width && saved.y >= a.y - 8 && saved.y + 40 < a.y + a.height);
  return onScreen ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width, height };
}

function createWindow() {
  const theme = currentTheme();
  const colors = THEMES[theme];
  win = new BrowserWindow({
    ...windowBounds(),
    minWidth: 720,
    minHeight: 460,
    show: false,
    title: 'Tessera',
    // A packaged build carries its icon; from source, use the one in build/.
    ...(!app.isPackaged && PLATFORM !== 'darwin' ? { icon: path.join(ROOT, 'build', 'icon.png') } : {}),
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    ...(PLATFORM === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: TITLEBAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: [`--tessera-theme=${theme}`, `--tessera-platform=${PLATFORM}`],
    },
  });

  if (store.config.window?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'dist', 'app', 'index.html'));

  const wc = win.webContents;
  wc.setVisualZoomLevelLimits(1, 1);
  // Only our own page may load here (a reload is fine); links open in the browser.
  wc.on('will-navigate', (e, legacyUrl) => {
    if ((e.url ?? legacyUrl) !== wc.getURL()) e.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  // A crash loses every terminal handle in the page; end the processes
  // rather than leaving them running unseen. (A reload is handled in app:init.)
  wc.on('render-process-gone', (_e, details) => {
    ptys.killAll();
    if (details.reason !== 'clean-exit' && !quitting) setTimeout(() => win && !win.isDestroyed() && win.reload(), 500);
  });
  wc.on('before-input-event', (e, input) => {
    if (app.isPackaged || input.type !== 'keyDown') return;
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (devtools) {
      wc.toggleDevTools();
      e.preventDefault();
    }
  });

  win.on('minimize', () => poller.setPaused(true));
  win.on('hide', () => poller.setPaused(true));
  win.on('restore', () => poller.setPaused(false));
  win.on('show', () => poller.setPaused(false));
  win.on('focus', () => {
    win.flashFrame(false);
    send('app:focus');
    refreshSync({ fetch: true });
  });
  const syncTimer = setInterval(() => refreshSync(), 60000);
  win.on('closed', () => clearInterval(syncTimer));

  let confirming = false;
  const saveWindowState = () =>
    store.update((c) => {
      c.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    });
  win.on('close', (e) => {
    if (quitting) return;
    // Ask first; the window closes again once the user confirms.
    e.preventDefault();
    if (confirming) return;
    confirming = true;
    confirmQuit()
      .catch(() => true)
      .then((ok) => {
        confirming = false;
        if (!ok || !win) return;
        quitting = true;
        saveWindowState();
        // Let every session exit cleanly out of sight, then close.
        win.hide();
        ptys.stopAll().then(() => win?.close());
      });
  });
  win.on('closed', () => {
    win = null;
  });
}

// Before quitting: offer to sync unsynced work, else confirm running sessions.
async function confirmQuit() {
  const n = ptys.size;
  const running = n ? ` ${n} session${n === 1 ? '' : 's'} will close.` : '';
  if (sync.root) {
    const status = await syncStatus(sync.root);
    if (unsynced(status)) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Sync and quit', 'Quit', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: 'Sync before closing?',
        detail: `${path.basename(sync.root)} has changes that are not on GitHub.${running}`,
      });
      if (response === 2) return false;
      if (response === 1) return true;
      send('app:toast', 'Syncing…');
      const res = await runSync(sync.root, childEnv(process.env));
      if (res.ok) return true;
      await dialog.showMessageBox(win, { type: 'warning', buttons: ['OK'], message: 'Sync failed', detail: res.output });
      refreshSync();
      return false;
    }
  }
  if (n === 0 || store.config.ui.confirmQuit === false) return true;
  // Sessions close cleanly, so only ask when one is in the middle of something.
  const busy = await askPage('busy', {}).catch(() => null);
  if (busy && !busy.length) return true;
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Quit Tessera?',
    detail: busy ? busy.join('\n') : `${n} session${n === 1 ? ' is' : 's are'} running.`,
    checkboxLabel: "Don't ask again",
  });
  if (response !== 0) return false;
  if (checkboxChecked) store.update((c) => { c.ui.confirmQuit = false; });
  return true;
}

// Check whether the open folder's repo has anything not on GitHub and tell
// the page. fetch: also look for new commits on GitHub (at most every 5 min).
async function refreshSync({ fetch = false } = {}) {
  const folder = store.config.folder;
  if (!folder) {
    send('sync:state', { enabled: false });
    return;
  }
  if (sync.folder !== folder) {
    sync.folder = folder;
    sync.root = await syncRoot(folder, childEnv(process.env));
    sync.lastFetch = 0;
  }
  if (!sync.root || store.config.folder !== folder) {
    send('sync:state', { enabled: false });
    return;
  }
  const doFetch = fetch && Date.now() - sync.lastFetch > 5 * 60000;
  if (doFetch) sync.lastFetch = Date.now();
  const status = await syncStatus(sync.root, { fetch: doFetch, env: childEnv(process.env) });
  if (store.config.folder !== folder) return; // switched meanwhile
  send('sync:state', status ? { enabled: true, running: sync.running, unsynced: unsynced(status), ...status } : { enabled: false });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  stopWatch();
  rulesWatcher?.close();
  control?.stop();
  poller?.stop();
  ptys?.killAll();
  store?.flush();
  store?.unwatch();
});
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

function send(channel, ...args) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args);
}

function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') shell.openExternal(url);
  } catch {
    // Not a URL.
  }
}

// ---------------------------------------------------------------------------
// State shared with the page

function publicState() {
  const c = store.config;
  return {
    platform: PLATFORM,
    windowsBuild: PLATFORM === 'win32' ? Number(os.release().split('.')[2]) || 0 : 0,
    configError: store.error,
    theme: currentTheme(),
    recent: c.recent.map((p) => ({ path: p, exists: isDir(p) })),
    terminal: c.terminal,
    ui: c.ui,
    claude: { model: c.claude.model, effort: c.claude.effort, permissionMode: c.claude.permissionMode, remoteControl: c.claude.remoteControl },
    startAtLogin: getStartAtLogin(app, ROOT),
    rules: c.folder ? readRules(c.folder) : null,
    orchestrator: c.orchestrator,
    jobs: poller.state,
  };
}

// A folder to show, with its saved panes and rules.
function openFolderState(folder) {
  if (!folder || !isDir(folder)) return { folder: null, session: null, rules: null };
  return { folder, session: store.config.sessions[folderKey(folder)] ?? null, rules: readRules(folder) };
}

function onConfigChanged() {
  nativeTheme.themeSource = currentTheme();
  applyTitleBar();
  poller.reset();
  send('config:changed', publicState());
}

function applyTitleBar() {
  if (!win) return;
  const colors = THEMES[currentTheme()];
  win.setBackgroundColor(colors.bg);
  if (PLATFORM !== 'darwin') {
    try {
      win.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.fg, height: TITLEBAR_HEIGHT });
    } catch {
      // Not supported on this window manager.
    }
  }
}

function stopWatch() {
  watcher?.close();
  watcher = null;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// IPC. Every handler checks that the call comes from our own window and
// treats its arguments as untrusted.

function registerIpc() {
  const fromUs = (e) => win && e.sender === win.webContents;
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!fromUs(e)) throw new Error('Unexpected sender');
      return fn(...args);
    });
  const on = (channel, fn) =>
    ipcMain.on(channel, (e, ...args) => {
      if (fromUs(e)) fn(...args);
    });

  handle('app:init', () => {
    // A page starting up owns no terminals yet; anything still running
    // belonged to the page it replaced (a reload) and can no longer be seen.
    ptys.killAll();
    stopWatch();
    poller.reset();
    refreshSync({ fetch: true });
    watchRules();
    return { ...publicState(), ...openFolderState(store.config.folder) };
  });

  handle('pty:spawn', (req) => spawnPane(req));
  on('pty:write', (id, data) => {
    if (typeof data === 'string' && data.length <= 1 << 20) ptys.write(id, data);
  });
  on('pty:resize', (id, cols, rows) => ptys.resize(id, cols, rows));
  on('pty:ack', (id, chars) => ptys.ack(id, chars));
  on('pty:kill', (id) => ptys.stop(id));

  handle('folder:pick', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  // Make a folder the open one: it moves to the top of the recent list.
  handle('folder:open', (folder) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || !isDir(folder)) return { error: `Folder not found: ${folder}` };
    const resolved = path.resolve(folder);
    stopWatch();
    store.update((c) => {
      c.folder = resolved;
      c.recent = [resolved, ...c.recent];
    });
    refreshSync({ fetch: true });
    watchRules();
    return { ...openFolderState(resolved), recent: publicState().recent };
  });
  handle('folder:subfolders', (folder) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) return { error: 'No folder is open.' };
    try {
      return { folders: listSubfolders(folder) };
    } catch (err) {
      return { error: `Could not read ${path.basename(folder)}: ${err.code || err.message}` };
    }
  });
  handle('folder:recent', () => publicState().recent);

  // File tree. Only paths inside the open folder can be listed or opened.
  const inOpenFolder = (p) => typeof p === 'string' && path.isAbsolute(p) && store.config.folder && isInside(p, store.config.folder);
  handle('fs:list', (dir) => {
    if (!inOpenFolder(dir)) return { error: 'Outside the open folder.' };
    try {
      return listDir(dir);
    } catch (err) {
      return { error: err.code || err.message };
    }
  });
  handle('fs:open', async (file) => {
    if (!inOpenFolder(file)) return 'Outside the open folder.';
    return (await shell.openPath(file)) || null;
  });
  on('fs:watch', (dir) => {
    stopWatch();
    if (!inOpenFolder(dir) || !isDir(dir)) return;
    let timer = null;
    try {
      // Recursive, so edits anywhere in the tree refresh the open folders.
      watcher = fs.watch(dir, { recursive: true }, (_event, name) => {
        if (name && /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(name)) return;
        clearTimeout(timer);
        timer = setTimeout(() => send('fs:changed', dir), 250);
      });
      watcher.on('error', stopWatch);
    } catch {
      watcher = null; // recursive watching is not available everywhere
    }
  });
  on('fs:unwatch', () => stopWatch());
  on('sync:refresh', () => refreshSync());
  handle('sync:run', async () => {
    if (!sync.root) return { ok: false, output: 'This folder is not in a repo with sync.sh.' };
    if (sync.running) return { ok: false, output: 'A sync is already running.' };
    sync.running = true;
    await refreshSync();
    try {
      return await runSync(sync.root, childEnv(process.env));
    } finally {
      sync.running = false;
      refreshSync();
    }
  });
  on('session:save', (folder, tree) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) return;
    if (tree !== null && (typeof tree !== 'object' || JSON.stringify(tree).length > 200000)) return;
    const key = folderKey(folder);
    store.update((c) => {
      if (tree) c.sessions[key] = tree;
      else delete c.sessions[key];
    });
  });

  handle('prefs:set', (patch) => {
    if (!patch || typeof patch !== 'object') return;
    store.update((c) => {
      if ('confirmClose' in patch) c.ui.confirmClose = patch.confirmClose;
      if ('notifications' in patch) c.ui.notifications = patch.notifications;
      if ('orchestratorWidth' in patch) c.ui.orchestratorWidth = patch.orchestratorWidth;
      if ('fontSize' in patch) c.terminal.fontSize = patch.fontSize;
      for (const k of ['model', 'effort', 'permissionMode', 'remoteControl']) if (k in patch) c.claude[k] = patch[k];
      if ('checkIns' in patch) c.orchestrator.checkIns = patch.checkIns;
      if ('checkInterval' in patch) c.orchestrator.checkInterval = patch.checkInterval;
    });
    return publicState();
  });
  handle('login:set', (on) => setStartAtLogin(app, ROOT, on === true));
  handle('rules:get', () => ({ text: store.config.folder ? readRules(store.config.folder) : null, template: TEMPLATE }));
  handle('rules:save', (text) => {
    const folder = store.config.folder;
    if (!folder || typeof text !== 'string' || text.length > MAX_RULES) return { error: 'Could not save the rules.' };
    try {
      writeRules(folder, text);
      return { ok: true };
    } catch (err) {
      return { error: `Could not save ${RULES_FILE}: ${err.code || err.message}` };
    }
  });
  handle('config:open', async () => {
    if (!fs.existsSync(store.file)) store.flush();
    return (await shell.openPath(store.file)) || null;
  });
  handle('theme:set', (theme) => {
    if (theme !== 'dark' && theme !== 'light') return currentTheme();
    store.update((c) => {
      c.ui.theme = theme;
    });
    nativeTheme.themeSource = theme;
    applyTitleBar();
    return theme;
  });

  handle('menu:popup', (items) => popupMenu(items));
  handle('dialog:confirm', async (opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      message: String(o.message ?? ''),
      detail: o.detail ? String(o.detail) : undefined,
      buttons: [String(o.confirm ?? 'OK'), 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: o.checkbox ? String(o.checkbox) : undefined,
    });
    return { confirmed: response === 0, checked: checkboxChecked };
  });

  handle('clipboard:read', () => clipboard.readText());
  on('clipboard:write', (text) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
  on('shell:open', (url) => typeof url === 'string' && openExternal(url));

  on('jobs:refresh', () => poller.refresh());
  on('notify', (msg) => {
    if (msg && typeof msg === 'object' && typeof msg.title === 'string' && store.config.ui.notifications !== false) notify(msg);
  });
}

// Build and show a native context menu; resolves with the chosen item id or null.
function popupMenu(items) {
  if (!Array.isArray(items) || !win) return null;
  return new Promise((resolve) => {
    let chosen = null;
    const template = items.slice(0, 30).map((it) =>
      it?.type === 'separator'
        ? { type: 'separator' }
        : { label: String(it?.label ?? ''), enabled: it?.enabled !== false, click: () => { chosen = String(it.id); } });
    // 'menu-will-close' fires before the click handler runs, so wait a tick.
    Menu.buildFromTemplate(template).popup({ window: win, callback: () => setTimeout(() => resolve(chosen), 0) });
  });
}

// Start the process for a pane.
//   req.role: 'orchestrator' | 'agent' (claude) or 'shell'
//   req.mode 'restore' reopens req.sessionId (resuming it if Claude saved it);
//   anything else starts a new conversation.
function spawnPane(req) {
  if (!req || typeof req !== 'object') return { error: 'Bad request' };
  const role = ['orchestrator', 'agent', 'shell'].includes(req.role) ? req.role : 'agent';
  const cwd = typeof req.cwd === 'string' ? req.cwd : '';
  if (!cwd || !path.isAbsolute(cwd) || !isDir(cwd)) return { error: `Folder not found: ${cwd || '(none)'}` };

  let sess = null;
  if (role !== 'shell') {
    const alreadyOpen = (id) => ptys.find((m) => m.sessionId === id) !== null;
    const restore = req.mode === 'restore' && store.config.claude.resumeOnRestore
      && UUID_RE.test(req.sessionId ?? '') && !alreadyOpen(req.sessionId);
    sess = restore
      ? { id: req.sessionId, resume: hasTranscript(req.sessionId) }
      : { id: crypto.randomUUID(), resume: false };
  }

  const env = paneEnv(req.paneId);
  let launch;
  try {
    const remoteName = role === 'orchestrator' ? `${path.basename(cwd)}-orchestrator` : path.basename(cwd);
    const promptFile = role === 'shell' ? null : writePromptFile(role);
    launch = buildCommand({ role, session: sess, hooksFile: control ? hooksFile : null, remoteName, promptFile }, store.config, env);
  } catch (err) {
    return { error: err.message };
  }
  try {
    // Claude quits on a second Ctrl+C; stopping a pane presses it rather than killing.
    const meta = { sessionId: sess?.id ?? null, exitKeys: role === 'shell' ? null : '\x03' };
    const { id, pid } = ptys.spawn({ ...launch, cwd, env, cols: req.cols, rows: req.rows, meta });
    return { id, pid, sessionId: sess?.id ?? null, resumed: Boolean(sess?.resume) };
  } catch (err) {
    return { error: `Could not start ${path.basename(launch.file)}: ${err.message}` };
  }
}

// Environment for a pane: the cleaned parent environment plus what the
// `tessera` command needs to reach this window.
function paneEnv(paneId) {
  const env = childEnv(process.env);
  if (!control) return env;
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const sep = PLATFORM === 'win32' ? ';' : ':';
  const current = getEnv(env, 'PATH') ?? '';
  env[pathKey] = current ? `${BIN_DIR}${sep}${current}` : BIN_DIR;
  Object.assign(env, {
    TESSERA_SOCKET: control.address,
    TESSERA_TOKEN: control.token,
    TESSERA_NODE: process.execPath,
    TESSERA_CLI: CLI_PATH,
  });
  if (typeof paneId === 'string' && /^\d{1,6}$/.test(paneId)) env.TESSERA_PANE = paneId;
  return env;
}

// ---------------------------------------------------------------------------
// Requests from the `tessera` command. The page owns the panes, so most are
// answered there.

const CONTROL_COMMANDS = new Set(['list', 'send', 'read', 'open', 'hook']);
const controlWaiting = new Map();
let controlSeq = 0;

ipcMain.on('control:reply', (e, id, error, result) => {
  if (!win || e.sender !== win.webContents) return;
  const waiting = controlWaiting.get(id);
  if (!waiting) return;
  controlWaiting.delete(id);
  clearTimeout(waiting.timer);
  if (error) waiting.reject(new Error(String(error)));
  else waiting.resolve(result);
});

function handleControl(cmd, args, from) {
  if (!CONTROL_COMMANDS.has(cmd)) throw new Error(`Unknown command "${cmd}".`);
  if (!args || typeof args !== 'object') throw new Error('Bad arguments.');
  if (cmd === 'open') {
    const cwd = typeof args.cwd === 'string' ? args.cwd : '';
    if (!path.isAbsolute(cwd) || !isDir(cwd)) throw new Error(`Folder not found: ${cwd}`);
  }
  if (cmd === 'send' && (typeof args.text !== 'string' || args.text.length > 100000)) throw new Error('Text is missing or too long.');
  if (cmd === 'hook' && typeof args.event !== 'string') throw new Error('Bad hook event.');
  return askPage(cmd, args, from);
}

// Ask the page (which owns the panes) and wait for its answer.
function askPage(cmd, args, from = null) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed()) return reject(new Error('The Tessera window is closed.'));
    const id = ++controlSeq;
    const timer = setTimeout(() => {
      controlWaiting.delete(id);
      reject(new Error('The Tessera window did not answer.'));
    }, 10000);
    controlWaiting.set(id, { resolve, reject, timer });
    // Which pane asked, so the page can tell the orchestrator's requests apart.
    send('control:request', id, cmd, args, typeof from === 'string' && /^\d{1,6}$/.test(from) ? from : null);
  });
}

// The hooks file lives with the app's per-user data (never in the repo).
function writeHooksFile() {
  try {
    const file = path.join(app.getPath('userData'), 'claude-hooks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(hookSettings(), null, 2));
    return file;
  } catch (err) {
    console.error('tessera: could not write the hooks file:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Desktop notifications, only while the window is not in front.

function notify({ title, body, paneId }) {
  if (!win || win.isDestroyed() || win.isFocused() || !Notification.isSupported()) return;
  const n = new Notification({ title: String(title).slice(0, 120), body: String(body ?? '').slice(0, 300), silent: false });
  n.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (paneId) send('notify:click', String(paneId));
  });
  n.show();
  win.flashFrame(true);
}

// ---------------------------------------------------------------------------
// Rulebook: the text appended to a session's system prompt is written to a
// file per role (hint and rules for the orchestrator, rules for agents).

function writePromptFile(role) {
  const folder = store.config.folder;
  const rules = folder ? readRules(folder) : null;
  const text = promptText(role, rules, {
    orchestrator: store.config.claude.orchestration ? ORCHESTRATION_HINT : '',
    agent: AGENT_HINT,
  });
  if (!text) return null;
  try {
    const file = path.join(app.getPath('userData'), 'prompts', `${role}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  } catch (err) {
    console.error('tessera: could not write the prompt file:', err.message);
    return null;
  }
}

// Tell the page when RULES.md changes, including edits made in other editors.
function watchRules() {
  rulesWatcher?.close();
  rulesWatcher = null;
  const folder = store.config.folder;
  if (!folder || !isDir(folder)) return;
  let timer = null;
  try {
    rulesWatcher = fs.watch(folder, (_event, name) => {
      if (name && name !== RULES_FILE) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (store.config.folder === folder) send('rules:changed', readRules(folder));
      }, 300);
    });
    rulesWatcher.on('error', () => {
      rulesWatcher?.close();
      rulesWatcher = null;
    });
  } catch {
    rulesWatcher = null;
  }
}
