import { h, iconButton } from './dom.js';

const api = window.tessera;
const SAVE_DELAY_MS = 500;

// Editor for RULES.md, laid over the orchestrator panel. Saves as you type
// and when closed, so what it shows is what the sessions get. With no
// RULES.md yet it starts from the template. onClose(text) gets what is on disk.
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

  // One save at a time, in order. Resolves to false if saving failed.
  save() {
    clearTimeout(this.timer);
    this.timer = null;
    const run = async () => {
      const text = this.input.value;
      if (text === this.saved) return true;
      const res = await api.rules.save(text).catch(() => null);
      if (res?.ok) {
        this.saved = text.endsWith('\n') ? text : `${text}\n`;
        return true;
      }
      this.onError(res?.error ?? 'Could not save the rules.');
      return false;
    };
    this.saving = (this.saving ?? Promise.resolve(true)).then(run);
    return this.saving;
  }

  // Someone else changed RULES.md: show it unless there are unsaved edits here.
  external(text) {
    if (!this.el || this.timer) return;
    this.saved = text;
    if (text !== null && text !== this.input.value) this.input.value = text;
  }

  // For a page that is unloading: save what is shown, without waiting.
  saveSync() {
    if (!this.el || this.input.value === this.saved) return;
    clearTimeout(this.timer);
    this.timer = null;
    const text = this.input.value;
    if (api.rules.saveSync(text)?.ok) this.saved = text.endsWith('\n') ? text : `${text}\n`;
  }

  // Saves first; stays open if that fails, so nothing typed is lost.
  close() {
    if (!this.el) return Promise.resolve();
    this.closing ??= this.save().then((ok) => {
      this.closing = null;
      if (!ok || !this.el) return;
      this.el.remove();
      this.el = null;
      this.onClose(this.saved);
    });
    return this.closing;
  }
}
