import { h, icon, iconButton } from './dom.js';

const MODELS = [['', 'Default'], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']];
const EFFORTS = [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
const PERMISSIONS = [['', 'Default'], ['auto', 'Auto'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['manual', 'Ask every time']];
const INTERVALS = [[2, 'Every 2 min'], [5, 'Every 5 min'], [10, 'Every 10 min'], [15, 'Every 15 min']];

// Settings popover under the gear button.
//   values: { model, effort, permissionMode, checkInterval, fontSize }
//   onChange(patch): a value changed
//   onOpenConfig(): open config.local.json
export function openSettings(anchor, values, { onChange, onOpenConfig }) {
  const existing = document.querySelector('.settings');
  if (existing) {
    existing.remove();
    return;
  }

  const select = (options, value, key, parse = String) => {
    // Keep a value set by hand in the config file selectable.
    const list = options.some(([v]) => v === value) ? options : [...options, [value, String(value)]];
    const el = h('select', { class: 'select-input' },
      ...list.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
    el.addEventListener('change', () => onChange({ [key]: parse(el.value) }));
    return h('div', { class: 'select' }, el, icon('chevron', 13));
  };

  let size = values.fontSize;
  const sizeText = h('span', { class: 'stepper-value', text: size });
  const step = (d) => {
    const next = Math.min(32, Math.max(8, size + d));
    if (next === size) return;
    size = next;
    sizeText.textContent = size;
    onChange({ fontSize: size });
  };

  const row = (label, control) => h('label', { class: 'settings-row' }, h('span', { text: label }), control);
  const panel = h('div', { class: 'settings', role: 'dialog', 'aria-label': 'Settings' },
    row('Model', select(MODELS, values.model, 'model')),
    row('Effort', select(EFFORTS, values.effort, 'effort')),
    row('Permissions', select(PERMISSIONS, values.permissionMode, 'permissionMode')),
    row('Check-ins', select(INTERVALS, values.checkInterval, 'checkInterval', Number)),
    row('Font size', h('div', { class: 'stepper' },
      iconButton('minus', 'Smaller', () => step(-1)),
      sizeText,
      iconButton('plus', 'Larger', () => step(1)))),
    h('p', { class: 'settings-note', text: 'Model, effort and permissions apply to sessions started from now on.' }),
    h('button', { class: 'settings-link', type: 'button', onClick: () => onOpenConfig() }, 'Edit config file', icon('chevronRight', 13)));

  const close = () => {
    panel.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (e) => {
    if (!panel.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const a = anchor.getBoundingClientRect();
  Object.assign(panel.style, { top: `${a.bottom + 8}px`, right: `${Math.max(8, window.innerWidth - a.right)}px` });
  document.body.append(panel);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
}
