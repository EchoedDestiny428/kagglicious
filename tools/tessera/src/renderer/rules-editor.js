import { h, iconButton } from './dom.js';

const api = window.tessera;
const SAVE_DELAY_MS = 500;

// Editor for RULES.md, laid over the orchestrator panel. Saves as you type.
// With no RULES.md yet it starts from the template, which is only written
// once edited. onClose(text) gets what is on disk now (null: no file).
export class RulesEditor {
  constructor(host, { onClose, onError }) {
    this.host = host;
    this.onClose = onClose;
    this.onError = onError;
    this.el = null;
  }

  get isOpen() {
    return this.el !== null;
  }

  async open() {
    if (this.el) return;
    const { text, template } = await api.rules.get();
    this.saved = text; // what is on disk
    this.input = h('textarea', { class: 'rules-input', spellcheck: 'false' });
    this.input.value = text ?? template;
    this.input.addEventListener('input', () => this.scheduleSave());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.el = h('div', { class: 'rules' },
      h('header', { class: 'rules-head' },
        h('span', { class: 'rules-name', text: 'RULES.md' }),
        iconButton('x', 'Close', () => this.close())),
      this.input);
    this.host.append(this.el);
    this.input.focus();
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  async save() {
    clearTimeout(this.timer);
    this.timer = null;
    const text = this.input.value;
    if (text === this.saved) return;
    const res = await api.rules.save(text);
    if (res?.ok) this.saved = text.endsWith('\n') ? text : `${text}\n`;
    else this.onError(res?.error ?? 'Could not save the rules.');
  }

  // Someone else changed RULES.md: show it unless there are unsaved edits here.
  external(text) {
    if (!this.el || this.timer) return;
    this.saved = text;
    if (text !== null && text !== this.input.value) this.input.value = text;
  }

  async close() {
    if (!this.el) return;
    if (this.timer) await this.save();
    this.el.remove();
    this.el = null;
    this.onClose(this.saved);
  }
}
