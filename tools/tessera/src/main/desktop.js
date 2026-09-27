// Launching Tessera like an app: a Start-menu / applications-menu entry, start
// at login, and rebuilding the page when running from source.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_ID = 'dev.tessera.app';

// Running from source, Electron is started as `electron <app folder>`; a
// packaged build is started on its own.
function launchArgs(app, root) {
  return app.isPackaged ? [] : [root];
}

// Create the menu entry. Returns a message for the terminal.
export function createShortcut(app, shell, root) {
  const icon = path.join(root, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  if (process.platform === 'win32') {
    const file = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Tessera.lnk');
    const ok = shell.writeShortcutLink(file, 'create', {
      target: process.execPath,
      args: launchArgs(app, root).map((a) => `"${a}"`).join(' '),
      cwd: root,
      icon,
      iconIndex: 0,
      appUserModelId: APP_ID, // lets notifications show as "Tessera"
      description: 'Claude Code sessions for one folder',
    });
    return ok ? `Added Tessera to the Start menu (${file}).` : 'Could not create the Start-menu shortcut.';
  }
  if (process.platform === 'linux') {
    const file = path.join(os.homedir(), '.local', 'share', 'applications', 'tessera.desktop');
    const exec = [process.execPath, ...launchArgs(app, root)].map((a) => `"${a}"`).join(' ');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Tessera\nExec=${exec}\nIcon=${icon}\nCategories=Development;\n`);
    return `Added Tessera to the applications menu (${file}).`;
  }
  return 'On macOS, build the app with `npm run dist` and drag it to Applications.';
}

// Start at login (Windows and macOS only).
export const loginSupported = () => process.platform === 'win32' || process.platform === 'darwin';

export function getStartAtLogin(app, root) {
  if (!loginSupported()) return null;
  return app.getLoginItemSettings({ path: process.execPath, args: launchArgs(app, root) }).openAtLogin;
}

export function setStartAtLogin(app, root, on) {
  if (!loginSupported()) return null;
  app.setLoginItemSettings({ openAtLogin: Boolean(on), path: process.execPath, args: launchArgs(app, root) });
  return getStartAtLogin(app, root);
}

// Running from source: rebuild the page if any renderer file is newer than
// the bundle, so a shortcut always opens the current code.
export function rebuildIfStale(root) {
  const bundle = path.join(root, 'dist', 'app', 'renderer.js');
  let built = 0;
  try {
    built = fs.statSync(bundle).mtimeMs;
  } catch {
    // Not built yet.
  }
  const newest = (dir) => {
    let latest = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      latest = Math.max(latest, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
    }
    return latest;
  };
  if (built && newest(path.join(root, 'src', 'renderer')) <= built) return false;
  execFileSync(process.execPath, [path.join(root, 'build.mjs')], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    windowsHide: true,
    timeout: 60000,
  });
  return true;
}
