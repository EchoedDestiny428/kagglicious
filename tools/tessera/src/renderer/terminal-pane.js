import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { h, icon } from './dom.js';
import { MONO_STACK, TERMINAL_THEMES } from './themes.js';

const api = window.tessera;
const IS_MAC = api.platform === 'darwin';
const BUSY_MS = 1500;
const RESIZE_DEBOUNCE_MS = 60;

// A terminal bound to a process in the main process.
//   role: 'orchestrator' | 'agent' run claude, 'shell' runs the user's shell
//   mode: 'new' starts a conversation, 'restore' reopens sessionId
//
// `view` is the whole terminal (with its exit overlay). Containers move it
// around (a tile, the zoomed view, the sidebar); it refits itself whenever
// its box changes size. Containers show the pane's state through bindHeader().
export class TerminalPane {
  constructor({ id, cwd, role = 'agent', mode = 'new', sessionId = null, label, settings, fontSize, events = {} }) {
    this.id = id;
    this.cwd = cwd;
    this.role = role;
    this.mode = mode;
    this.sessionId = sessionId;
    this.label = label;
    this.settings = settings; // { theme, fontSize, fontFamily, scrollback, windowsBuild }
    this.fontSize = fontSize ?? settings.fontSize;
    this.events = events; // { onFocus, onMenu, onSessionChange, onExit }
    this.ptyId = null;
    this.status = 'idle';
    this.title = '';
    this.busy = false;
    this.attention = false;
    this.focused = false;
    this.disposed = false;
    this.opened = false;
    this.headers = new Set();
    this.busyTimer = null;
    this.resizeTimer = null;
    this.fitFrame = 0;
    this.startedAt = 0;
    this.lastOutputAt = 0;

    this.body = h('div', { class: 'term-body' });
    this.overlay = h('div', { class: 'term-overlay', hidden: true });
    this.view = h('div', { class: 'term' }, this.body, this.overlay);
    this.view.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.term-overlay')) return;
      e.preventDefault();
      this.events.onMenu?.(this);
    });
    this.body.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.body.addEventListener('drop', (e) => this.dropFiles(e));
    new ResizeObserver(() => this.scheduleFit()).observe(this.view);
    this.createTerminal();
  }

  get isClaude() {
    return this.role !== 'shell';
  }

  createTerminal() {
    const s = this.settings;
    this.term = new Terminal({
      fontFamily: s.fontFamily || MONO_STACK,
      fontSize: this.fontSize,
      lineHeight: 1.2,
      fontWeight: 400,
      fontWeightBold: 600,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: s.scrollback,
      allowProposedApi: true,
      macOptionIsMeta: true,
      rescaleOverlappingGlyphs: true,
      minimumContrastRatio: s.theme === 'light' ? 3 : 1,
      theme: TERMINAL_THEMES[s.theme],
      windowsPty: api.platform === 'win32' ? { backend: 'conpty', buildNumber: s.windowsBuild } : undefined,
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = '11';
    this.term.loadAddon(new WebLinksAddon((event, uri) => {
      event.preventDefault();
      api.openExternal(uri);
    }));
    this.term.attachCustomKeyEventHandler((e) => this.onKey(e));
    this.term.onData((data) => this.onInput(data));
    this.term.onTitleChange((title) => {
      this.title = cleanTitle(title);
      this.updateHeaders();
    });
    this.term.onBell(() => {
      if (!this.focused) {
        this.attention = true;
        this.updateHeaders();
      }
    });
  }

  // Put the terminal into a container. The first mount opens xterm, which
  // needs to be in the page to measure the font.
  mount(container) {
    container.append(this.view);
    if (!this.opened) {
      this.opened = true;
      this.term.open(this.body);
      this.loadWebgl();
      this.term.textarea?.addEventListener('focus', () => {
        this.setFocused(true);
        this.events.onFocus?.(this);
      });
      this.term.textarea?.addEventListener('blur', () => this.setFocused(false));
    }
    this.scheduleFit();
  }

  // GPU rendering is much faster with many terminals; fall back to the DOM
  // renderer if WebGL is unavailable or the browser drops the context (it
  // caps how many a page may hold).
  loadWebgl() {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      this.term.loadAddon(webgl);
    } catch {
      // DOM renderer it is.
    }
  }

  // Show state in a header: root gets status/busy/attention classes, title gets the text.
  bindHeader(parts) {
    this.headers.add(parts);
    this.updateHeaders();
    return () => this.headers.delete(parts);
  }

  updateHeaders() {
    for (const { root, title } of this.headers) {
      root.dataset.status = this.status;
      root.classList.toggle('busy', this.busy);
      root.classList.toggle('attention', this.attention);
      if (title) title.textContent = this.title;
    }
  }

  onKey(e) {
    if (e.type !== 'keydown') return true;
    const key = e.key.toLowerCase();
    const ctrlOnly = e.ctrlKey && !e.altKey && !e.metaKey;
    if (!IS_MAC && ctrlOnly && key === 'c') {
      // Ctrl+C copies when there is a selection (and always with Shift);
      // otherwise it is an interrupt for the process.
      if (this.term.hasSelection()) {
        api.clipboard.write(this.term.getSelection());
        this.term.clearSelection();
        e.preventDefault();
        return false;
      }
      if (e.shiftKey) {
        e.preventDefault();
        return false;
      }
      return true;
    }
    if (!IS_MAC && ctrlOnly && key === 'v') {
      e.preventDefault();
      api.clipboard.read().then((text) => {
        if (text) this.term.paste(text);
        // No text (e.g. an image): pass the key through so claude can read the clipboard itself.
        else if (!e.shiftKey) this.onInput('\x16');
      });
      return false;
    }
    // Shift+Enter inserts a newline in claude's prompt (sent as Meta+Enter).
    if (this.isClaude && key === 'enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      this.onInput('\x1b\r');
      return false;
    }
    return true;
  }

  onInput(data) {
    if (this.status === 'running') {
      api.pty.write(this.ptyId, data);
      return;
    }
    if ((this.status === 'exited' || this.status === 'error') && data === '\r') this.restart();
  }

  dropFiles(e) {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const paths = files.map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length && this.status === 'running') {
      this.term.paste(paths.map(quotePath).join(' '));
      this.focus();
    }
  }

  // Start (or restart) the process at the terminal's current size.
  async start() {
    if (this.disposed) return;
    this.setStatus('starting');
    this.hideOverlay();
    this.fit();
    this.startedAt = Date.now();
    const res = await api.pty.spawn({
      paneId: /^\d+$/.test(this.id) ? this.id : null,
      role: this.role,
      cwd: this.cwd,
      mode: this.mode,
      sessionId: this.sessionId,
      cols: this.term.cols,
      rows: this.term.rows,
    });
    if (this.disposed) {
      if (res?.id) api.pty.kill(res.id);
      return;
    }
    if (!res || res.error) {
      this.setStatus('error');
      this.showOverlay(res?.error ?? 'Could not start the process.', 'Retry');
      return;
    }
    this.ptyId = res.id;
    if (res.sessionId && res.sessionId !== this.sessionId) {
      this.sessionId = res.sessionId;
      this.events.onSessionChange?.(this);
    }
    this.mode = 'restore'; // a restart reopens the same conversation
    this.setStatus('running');
    this.fit(true);
  }

  restart() {
    if (this.status === 'running' || this.status === 'starting') return;
    this.term.reset();
    this.start();
  }

  handleData(data) {
    const ptyId = this.ptyId;
    this.term.write(data, () => api.pty.ack(ptyId, data.length));
    this.lastOutputAt = Date.now();
    if (!this.busy) {
      this.busy = true;
      this.updateHeaders();
    }
    clearTimeout(this.busyTimer);
    this.busyTimer = setTimeout(() => {
      this.busy = false;
      this.updateHeaders();
    }, BUSY_MS);
  }

  handleExit(code) {
    this.ptyId = null;
    clearTimeout(this.busyTimer);
    this.busy = false;
    this.setStatus('exited');
    const quick = Date.now() - this.startedAt < 3000;
    const text = code ? `Exited with code ${code}` : 'Process exited';
    this.showOverlay(quick && code ? `${text} right after starting.` : text, 'Restart');
    this.events.onExit?.(this);
  }

  showOverlay(message, actionLabel) {
    this.overlay.replaceChildren(
      h('div', { class: 'overlay-card' },
        h('p', { class: 'overlay-text', text: message }),
        h('button', { class: 'btn primary', type: 'button', onClick: () => this.restart() }, icon('restart', 14), actionLabel)),
    );
    this.overlay.hidden = false;
  }

  hideOverlay() {
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  setStatus(status) {
    this.status = status;
    this.updateHeaders();
  }

  get running() {
    return this.status === 'running' || this.status === 'starting';
  }

  setFocused(focused) {
    this.focused = focused;
    if (focused && this.attention) {
      this.attention = false;
      this.updateHeaders();
    }
  }

  focus() {
    this.term.focus();
  }

  scheduleFit() {
    if (this.fitFrame) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0;
      this.fit();
    });
  }

  // Resize the terminal to its box; the process follows after a short pause
  // so continuous resizing does not make it redraw on every frame.
  fit(immediate = false) {
    if (this.disposed || !this.opened || !this.view.isConnected) return;
    const dims = this.fitAddon.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 2 || dims.rows < 1) return;
    const cols = Math.max(dims.cols, 20);
    const rows = Math.max(dims.rows, 4);
    if (cols !== this.term.cols || rows !== this.term.rows) this.term.resize(cols, rows);
    clearTimeout(this.resizeTimer);
    const push = () => {
      if (this.ptyId !== null) api.pty.resize(this.ptyId, this.term.cols, this.term.rows);
    };
    if (immediate) push();
    else this.resizeTimer = setTimeout(push, RESIZE_DEBOUNCE_MS);
  }

  setFontSize(size) {
    if (size === this.fontSize) return;
    this.fontSize = size;
    this.term.options.fontSize = size;
    this.scheduleFit();
  }

  applySettings(settings, fontSize = settings.fontSize) {
    const themeChanged = settings.theme !== this.settings.theme;
    this.settings = settings;
    const o = this.term.options;
    if (themeChanged) {
      o.theme = TERMINAL_THEMES[settings.theme];
      o.minimumContrastRatio = settings.theme === 'light' ? 3 : 1;
    }
    const family = settings.fontFamily || MONO_STACK;
    if (o.fontFamily !== family) o.fontFamily = family;
    this.setFontSize(fontSize);
    this.scheduleFit();
  }

  clear() {
    this.term.clear();
  }

  selectAll() {
    this.term.selectAll();
  }

  copySelection() {
    if (this.term.hasSelection()) api.clipboard.write(this.term.getSelection());
  }

  async paste(text) {
    const value = text ?? (await api.clipboard.read());
    if (value && this.status === 'running') this.term.paste(value);
  }

  // --- used by the `tessera` command -------------------------------------

  // 'working' while output is still arriving, 'idle' once it has stopped.
  get controlState() {
    if (this.status !== 'running') return this.status;
    return Date.now() - this.lastOutputAt < BUSY_MS ? 'working' : 'idle';
  }

  get idleSeconds() {
    return Math.max(0, (Date.now() - Math.max(this.lastOutputAt, this.startedAt)) / 1000);
  }

  // Type text as a paste (so multi-line text stays one message), then Enter.
  async sendText(text) {
    if (this.status !== 'running') throw new Error(`Pane ${this.id} is not running.`);
    this.lastOutputAt = Date.now(); // counts as activity, so an immediate "wait" does not return early
    this.term.paste(text);
    await new Promise((r) => setTimeout(r, 150));
    this.onInput('\r');
  }

  // The last `lines` non-blank lines, newest at the bottom. Runs of blank
  // lines are squeezed to one: full-screen apps like claude leave most of
  // the screen empty between the conversation and the input box.
  readText(lines) {
    const buf = this.term.buffer.active;
    const out = [];
    let kept = 0;
    for (let i = buf.length - 1; i >= 0 && kept < lines; i--) {
      const line = (buf.getLine(i)?.translateToString(true) ?? '').replace(/\s+$/, '');
      if (line) kept++;
      else if (!out.length || !out[out.length - 1]) continue;
      out.push(line);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out.reverse().join('\n');
  }

  payload() {
    return { cwd: this.cwd, ...(this.sessionId ? { sessionId: this.sessionId } : {}) };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.busyTimer);
    clearTimeout(this.resizeTimer);
    cancelAnimationFrame(this.fitFrame);
    if (this.ptyId !== null) api.pty.kill(this.ptyId);
    this.ptyId = null;
    this.headers.clear();
    try {
      this.term.dispose();
    } catch {
      // A lost WebGL context can make dispose throw; the element goes anyway.
    }
    this.view.remove();
  }
}

function cleanTitle(title) {
  const t = String(title ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200);
  // Windows shells set the title to their own executable path; not useful.
  return /\.exe$/i.test(t) ? '' : t;
}

function quotePath(p) {
  if (!/[\s"'`$&|;<>()*?!#~]/.test(p)) return p;
  return api.platform === 'win32' ? `"${p}"` : `'${p.replace(/'/g, `'\\''`)}'`;
}
