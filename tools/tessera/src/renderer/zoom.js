import { h, iconButton } from './dom.js';
import { Explorer } from './explorer.js';
import { TerminalPane } from './terminal-pane.js';

const api = window.tessera;
const DURATION = 280;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const SHELL_OPEN_DELAY = 160; // ms the pointer rests on the edge before the terminal slides in
const SHELL_HIDE_DELAY = 350;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// One agent up close: file tree | claude | a terminal in the same folder that
// slides in from the right edge. The terminal starts when the view opens and
// stays loaded until it closes, so hovering in and out is instant.
export class ZoomView {
  // getSettings(): current terminal settings; onClose(pane): the agent's terminal
  // must go back to its tile.
  constructor(host, { getSettings, onClose }) {
    this.host = host;
    this.getSettings = getSettings;
    this.onClose = onClose;
    this.pane = null;
    this.shell = null;
    this.animating = false;
  }

  get isOpen() {
    return this.pane !== null;
  }

  open(pane, tile) {
    if (this.pane || this.animating) return;
    this.pane = pane;
    this.tile = tile;
    const settings = this.getSettings();

    const title = h('span', { class: 'zoom-title' });
    this.header = h('header', { class: 'zoom-head' },
      h('span', { class: 'dot' }),
      h('span', { class: 'zoom-name', text: pane.label }),
      title,
      iconButton('x', 'Close', () => this.close(), 'zoom-close'));
    this.unbindHeader = pane.bindHeader({ root: this.header, title });

    this.explorer = new Explorer(pane.cwd, {
      onPick: (rel) => {
        pane.paste(`@${rel.replace(/\\/g, '/')} `);
        pane.focus();
      },
      onOpen: (file) => api.fs.open(file),
    });
    this.cli = h('div', { class: 'zoom-cli' });
    this.shellPanel = h('div', { class: 'shell-panel' });
    this.edge = h('div', { class: 'shell-edge' }, h('span', { class: 'shell-grip' }));
    this.card = h('section', { class: 'zoom-card' },
      this.header,
      h('div', { class: 'zoom-body' }, this.explorer.el, this.cli, this.shellPanel, this.edge));
    this.backdrop = h('div', { class: 'zoom-backdrop', onClick: () => this.close() });
    this.root = h('div', { class: 'zoom' }, this.backdrop, this.card);
    this.host.append(this.root);

    pane.mount(this.cli);
    pane.setFontSize(settings.fontSize);
    pane.focus();

    this.shell = new TerminalPane({ id: `shell${pane.id}`, cwd: pane.cwd, role: 'shell', label: 'terminal', settings });
    this.shell.mount(this.shellPanel);
    this.shell.start();
    this.setupShellHover();

    this.explorer.load();
    api.fs.watch(pane.cwd);
    this.offChanged = api.fs.onChanged((dir) => {
      if (dir === pane.cwd) this.explorer.refresh();
    });

    this.animate(true);
  }

  // Grow from the tile (or shrink back into it): a FLIP transform on the card
  // while the blurred backdrop fades.
  async animate(opening) {
    const duration = reducedMotion() || !this.tile.isConnected ? 0 : DURATION;
    const from = this.tile.getBoundingClientRect();
    const to = this.card.getBoundingClientRect();
    const start = {
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
      opacity: 0.4,
    };
    const end = { transform: 'none', opacity: 1 };
    this.animating = true;
    const card = this.card.animate(opening ? [start, end] : [end, start], { duration, easing: EASE, fill: 'forwards' });
    this.backdrop.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration, easing: EASE, fill: 'forwards' });
    try {
      await card.finished;
    } catch {
      // Cancelled because the view was removed.
    }
    this.animating = false;
  }

  setupShellHover() {
    let openTimer = null;
    let hideTimer = null;
    const hide = () => {
      if (!this.shellPanel.contains(document.activeElement)) this.card.classList.remove('shell-open');
    };
    this.edge.addEventListener('pointerenter', () => {
      openTimer = setTimeout(() => this.showShell(false), SHELL_OPEN_DELAY);
    });
    this.edge.addEventListener('pointerleave', () => clearTimeout(openTimer));
    this.shellPanel.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    this.shellPanel.addEventListener('pointerleave', () => {
      hideTimer = setTimeout(hide, SHELL_HIDE_DELAY);
    });
    // Clicking back into claude puts the terminal away.
    this.shellPanel.addEventListener('focusout', () => {
      setTimeout(() => {
        if (this.shellPanel && !this.shellPanel.matches(':hover')) hide();
      }, 0);
    });
  }

  showShell(focus) {
    if (!this.shell) return;
    this.card.classList.add('shell-open');
    if (focus) this.shell.focus();
  }

  toggleShell() {
    if (!this.shell) return;
    if (this.card.classList.contains('shell-open')) {
      this.card.classList.remove('shell-open');
      this.pane.focus();
    } else {
      this.showShell(true);
    }
  }

  // Close the view. The terminal and file tree are unloaded; the agent's
  // terminal goes back to its tile.
  async close({ animate = true } = {}) {
    if (!this.pane || (this.animating && animate)) return;
    const pane = this.pane;
    this.shell.dispose();
    this.shell = null;
    this.explorer.dispose();
    this.offChanged();
    this.unbindHeader();
    api.fs.unwatch();
    if (animate) await this.animate(false);
    this.root.remove();
    this.pane = null;
    this.tile = null;
    this.onClose(pane);
  }

  applySettings(settings) {
    this.shell?.applySettings(settings);
  }
}
