import { h, icon, iconButton } from './dom.js';
import { Explorer } from './explorer.js';
import { TerminalPane } from './terminal-pane.js';

const api = window.tessera;
const DURATION = 280;
const SWITCH_MS = 150;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const SHELL_OPEN_DELAY = 160; // ms the pointer rests on the edge before the terminal slides in
const SHELL_HIDE_DELAY = 350;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Search highlights, in the black-and-white palette.
const SEARCH_COLORS = {
  dark: { matchBackground: '#3a3a3a', matchOverviewRuler: '#6b6b6b', activeMatchBackground: '#5c5c5c', activeMatchBorder: '#ffffff', activeMatchColorOverviewRuler: '#ffffff' },
  light: { matchBackground: '#e2e2e2', matchOverviewRuler: '#8f8f8f', activeMatchBackground: '#c4c4c4', activeMatchBorder: '#000000', activeMatchColorOverviewRuler: '#000000' },
};

// One agent up close: file tree | claude | a terminal in the same folder that
// slides in from the right edge. The terminal starts when the agent is shown
// and stays loaded until the view closes or switches to another agent.
export class ZoomView {
  // getSettings(): current terminal settings
  // onRelease(pane): the agent's terminal must go back to its tile
  // onClosed(): the view is gone
  constructor(host, { getSettings, onRelease, onClosed }) {
    this.host = host;
    this.getSettings = getSettings;
    this.onRelease = onRelease;
    this.onClosed = onClosed;
    this.cur = null; // { pane, tile, card, shell, explorer, ... } of the agent shown
    this.root = null;
    this.animating = false;
  }

  get pane() {
    return this.cur?.pane ?? null;
  }

  get shell() {
    return this.cur?.shell ?? null;
  }

  get isOpen() {
    return this.cur !== null;
  }

  open(pane, tile) {
    if (this.cur || this.animating) return;
    this.backdrop = h('div', { class: 'zoom-backdrop', onClick: () => this.close() });
    this.root = h('div', { class: 'zoom' }, this.backdrop);
    this.host.append(this.root);
    this.cur = this.buildCard(pane, tile);
    this.animate(true);
  }

  // Show another agent without closing: the cards cross-fade over the same backdrop.
  async switchTo(pane, tile) {
    if (!this.cur || this.animating || this.cur.pane === pane) return;
    const old = this.cur;
    this.cur = this.buildCard(pane, tile);
    const duration = reducedMotion() ? 0 : SWITCH_MS;
    this.animating = true;
    old.card.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' });
    const fadeIn = this.cur.card.animate([{ opacity: 0, transform: 'scale(0.99)' }, { opacity: 1, transform: 'none' }], { duration, easing: 'ease-out' });
    try {
      await fadeIn.finished;
    } catch {
      // Cancelled because the view was removed.
    }
    this.animating = false;
    this.teardown(old);
  }

  buildCard(pane, tile) {
    const settings = this.getSettings();
    const c = { pane, tile };
    const title = h('span', { class: 'zoom-title' });
    const header = h('header', { class: 'zoom-head' },
      h('span', { class: 'dot' }),
      h('span', { class: 'zoom-name', text: pane.label }),
      title,
      iconButton('x', 'Close', () => this.close(), 'zoom-close'));
    c.unbindHeader = pane.bindHeader({ root: header, title });

    c.explorer = new Explorer(pane.cwd, {
      onPick: (rel) => {
        pane.paste(`@${rel.replace(/\\/g, '/')} `);
        pane.focus();
      },
      onOpen: (file) => api.fs.open(file),
    });
    c.cli = h('div', { class: 'zoom-cli' });
    c.shellPanel = h('div', { class: 'shell-panel' });
    c.edge = h('div', { class: 'shell-edge' }, h('span', { class: 'shell-grip' }));
    c.card = h('section', { class: 'zoom-card' },
      header,
      h('div', { class: 'zoom-body' }, c.explorer.el, c.cli, c.shellPanel, c.edge));
    this.root.append(c.card);

    pane.mount(c.cli);
    pane.setFontSize(settings.fontSize);
    pane.focus();

    c.shell = new TerminalPane({ id: `shell${pane.id}`, cwd: pane.cwd, role: 'shell', label: 'terminal', settings });
    c.shell.mount(c.shellPanel);
    c.shell.start();
    this.setupShellHover(c);

    c.explorer.load();
    api.fs.watch(pane.cwd);
    c.offChanged = api.fs.onChanged((dir) => {
      if (dir === pane.cwd) c.explorer.refresh();
    });
    return c;
  }

  // Unload what the card started, and give the agent's terminal back to its tile.
  teardown(c) {
    this.closeSearch(c, false);
    c.shell.dispose();
    c.explorer.dispose();
    c.offChanged();
    c.unbindHeader();
    c.card.remove();
    this.onRelease(c.pane);
  }

  // Grow from the tile or list row (or shrink back into it): a FLIP transform
  // on the card while the blurred backdrop fades.
  async animate(opening) {
    const { card, tile } = this.cur;
    const from = tile.getBoundingClientRect();
    const duration = reducedMotion() || !tile.isConnected || !from.width || !from.height ? 0 : DURATION;
    const to = card.getBoundingClientRect();
    const start = {
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
      opacity: 0.4,
    };
    const end = { transform: 'none', opacity: 1 };
    this.animating = true;
    const run = card.animate(opening ? [start, end] : [end, start], { duration, easing: EASE, fill: 'forwards' });
    this.backdrop.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration, easing: EASE, fill: 'forwards' });
    try {
      await run.finished;
    } catch {
      // Cancelled because the view was removed.
    }
    this.animating = false;
  }

  setupShellHover(c) {
    let openTimer = null;
    let hideTimer = null;
    const hide = () => {
      if (!c.shellPanel.contains(document.activeElement)) c.card.classList.remove('shell-open');
    };
    c.edge.addEventListener('pointerenter', () => {
      openTimer = setTimeout(() => this.showShell(false), SHELL_OPEN_DELAY);
    });
    c.edge.addEventListener('pointerleave', () => clearTimeout(openTimer));
    c.shellPanel.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    c.shellPanel.addEventListener('pointerleave', () => {
      hideTimer = setTimeout(hide, SHELL_HIDE_DELAY);
    });
    // Clicking back into claude puts the terminal away.
    c.shellPanel.addEventListener('focusout', () => {
      setTimeout(() => {
        if (c.shellPanel.isConnected && !c.shellPanel.matches(':hover')) hide();
      }, 0);
    });
  }

  showShell(focus) {
    if (!this.cur) return;
    this.cur.card.classList.add('shell-open');
    if (focus) this.cur.shell.focus();
  }

  toggleShell() {
    if (!this.cur) return;
    if (this.cur.card.classList.contains('shell-open')) {
      this.cur.card.classList.remove('shell-open');
      this.cur.pane.focus();
    } else {
      this.showShell(true);
    }
  }

  // Search the agent's terminal: Enter next, Shift+Enter previous, Esc close.
  openSearch() {
    const c = this.cur;
    if (!c) return;
    if (c.searchBox) {
      c.searchInput.select();
      c.searchInput.focus();
      return;
    }
    const pane = c.pane;
    const count = h('span', { class: 'search-count' });
    const input = h('input', { class: 'search-input', type: 'text', placeholder: 'Find', spellcheck: 'false' });
    const opts = () => ({ decorations: SEARCH_COLORS[this.getSettings().theme] ?? SEARCH_COLORS.dark });
    const find = (back = false) => {
      const term = input.value;
      if (!term) {
        pane.search.clearDecorations();
        count.textContent = '';
        return;
      }
      if (back) pane.search.findPrevious(term, opts());
      else pane.search.findNext(term, { ...opts(), incremental: true });
    };
    c.offResults = pane.search.onDidChangeResults(({ resultIndex, resultCount }) => {
      count.textContent = !input.value ? '' : resultCount ? `${resultIndex + 1}/${resultCount}` : 'No results';
    }).dispose;
    input.addEventListener('input', () => find());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!e.shiftKey && input.value) pane.search.findNext(input.value, opts());
        else find(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSearch(c);
      }
    });
    c.searchInput = input;
    c.searchBox = h('div', { class: 'search-box' }, icon('search', 14), input, count,
      iconButton('x', 'Close', () => this.closeSearch(c), 'search-close'));
    c.cli.append(c.searchBox);
    input.focus();
  }

  closeSearch(c = this.cur, refocus = true) {
    if (!c?.searchBox) return;
    c.offResults?.();
    c.pane.search.clearDecorations();
    c.searchBox.remove();
    c.searchBox = null;
    if (refocus) c.pane.focus();
  }

  // Close the view. The terminal and file tree are unloaded; the agent's
  // terminal goes back to its tile.
  async close({ animate = true } = {}) {
    if (!this.cur || (this.animating && animate)) return;
    const c = this.cur;
    api.fs.unwatch();
    if (animate) await this.animate(false);
    this.cur = null;
    this.teardown(c);
    this.root.remove();
    this.root = null;
    this.onClosed();
  }

  applySettings(settings) {
    this.cur?.shell.applySettings(settings);
  }
}
