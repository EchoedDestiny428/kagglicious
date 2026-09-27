import { h, icon, iconButton } from './dom.js';

const MODELS = [['', 'Default model'], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']];
const EFFORTS = [['', 'Default effort'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
const PERMISSIONS = [['', 'Default'], ['auto', 'Auto'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['manual', 'Ask every time']];
const INTERVALS = [[2, 'Every 2 min'], [5, 'Every 5 min'], [10, 'Every 10 min'], [15, 'Every 15 min']];

// Settings popover under the gear button.
//   values: { agent: { model, effort }, permissionMode, remoteControl,
//     checkInterval, notifications, startAtLogin, fontSize, boost, boostMinutes }
//   (startAtLogin is null where the system does not support it)
//   onChange(patch): a value changed
//   onOpenConfig(): open config.local.json
export function openSettings(anchor, values, { onChange, onOpenConfig }) {
  const existing = document.querySelector('.settings');
  if (existing) {
    existing.remove();
    return;
  }

  // change(value) gets the picked value; defaults to setting `key`.
  const select = (options, value, key, parse = String, change = (v) => onChange({ [key]: v })) => {
    // Keep a value set by hand in the config file selectable.
    const list = options.some(([v]) => v === value) ? options : [...options, [value, String(value)]];
    const el = h('select', { class: 'select-input' },
      ...list.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
    el.addEventListener('change', () => change(parse(el.value)));
    return h('div', { class: 'select' }, el, icon('chevron', 13));
  };

  // Model and effort for the agents, side by side.
  const roleSelects = (role) => {
    const current = { ...values[role] };
    const pick = (k) => (v) => {
      current[k] = v;
      onChange({ [role]: { [k]: v } });
    };
    return h('div', { class: 'select-pair' },
      select(MODELS, current.model, null, String, pick('model')),
      select(EFFORTS, current.effort, null, String, pick('effort')));
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

  // On/off switch; the label row itself toggles it.
  // (The state is read back from the switch, which the app may also change,
  // e.g. when Boost switches itself off.)
  const toggle = (value, key) => {
    const el = h('button', { class: 'switch-toggle bare', type: 'button', role: 'switch', 'aria-checked': String(Boolean(value)) },
      h('span', { class: 'switch' }, h('span', { class: 'switch-knob' })));
    el.addEventListener('click', () => {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(on));
      onChange({ [key]: on });
    });
    return el;
  };

  const row = (label, control, title, cls = '') => h('label', { class: `settings-row ${cls}`.trim(), title }, h('span', { text: label }), control);
  const panel = h('div', { class: 'settings', role: 'dialog', 'aria-label': 'Settings' },
    row('Agents', roleSelects('agent')),
    row('Boost', toggle(values.boost, 'boost'), `Orchestrator and agents think harder on every prompt for ${values.boostMinutes} min`, 'boost-row'),
    row('Permissions', select(PERMISSIONS, values.permissionMode, 'permissionMode')),
    row('Remote Control', toggle(values.remoteControl, 'remoteControl'), 'Continue sessions from the Claude app or claude.ai'),
    row('Check-ins', select(INTERVALS, values.checkInterval, 'checkInterval', Number)),
    row('Notifications', toggle(values.notifications, 'notifications')),
    values.startAtLogin === null ? null : row('Start at login', toggle(values.startAtLogin, 'startAtLogin')),
    row('Font size', h('div', { class: 'stepper' },
      iconButton('minus', 'Smaller', () => step(-1)),
      sizeText,
      iconButton('plus', 'Larger', () => step(1)))),
    h('p', { class: 'settings-note', text: 'Agent model and effort also switch open agents. Permissions and Remote Control apply to new sessions.' }),
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
