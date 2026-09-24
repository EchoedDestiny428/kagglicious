// The only bridge between the page and the main process. The page can start
// claude in a folder, never an arbitrary command.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const arg = (name) => {
  const prefix = `--tessera-${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};

const listen = (channel) => (cb) => {
  const fn = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('tessera', {
  initialTheme: arg('theme') === 'light' ? 'light' : 'dark',
  platform: arg('platform'),

  init: () => ipcRenderer.invoke('app:init'),
  onConfigChanged: listen('config:changed'),
  onToast: listen('app:toast'),
  onFocus: listen('app:focus'),

  pty: {
    spawn: (req) => ipcRenderer.invoke('pty:spawn', req),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    ack: (id, chars) => ipcRenderer.send('pty:ack', id, chars),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: listen('pty:data'),
    onExit: listen('pty:exit'),
  },

  folder: {
    pick: () => ipcRenderer.invoke('folder:pick'),
    open: (folder) => ipcRenderer.invoke('folder:open', folder),
    subfolders: (folder) => ipcRenderer.invoke('folder:subfolders', folder),
    recent: () => ipcRenderer.invoke('folder:recent'),
  },
  saveSession: (folder, tree) => ipcRenderer.send('session:save', folder, tree),

  fs: {
    list: (dir) => ipcRenderer.invoke('fs:list', dir),
    open: (file) => ipcRenderer.invoke('fs:open', file),
    watch: (dir) => ipcRenderer.send('fs:watch', dir),
    unwatch: () => ipcRenderer.send('fs:unwatch'),
    onChanged: listen('fs:changed'),
  },

  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  menu: (items) => ipcRenderer.invoke('menu:popup', items),
  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),

  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.send('clipboard:write', text),
  },
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },

  jobs: {
    refresh: () => ipcRenderer.send('jobs:refresh'),
    onUpdate: listen('jobs:update'),
  },

  control: {
    onRequest: listen('control:request'),
    reply: (id, error, result) => ipcRenderer.send('control:reply', id, error, result),
  },
});
