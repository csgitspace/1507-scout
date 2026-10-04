// ==============================================================================
// Builds one on-screen control per field in shared/fields.js. You shouldn't
// need to touch this to add or change a field. Edit fields.js instead. Only
// edit this file to add a brand-new field TYPE.
//
// renderField(field, getValue, setValue) -> { el, update() }
//   update() redraws the control from the current value (used when another
//   field changes this one, e.g. climb level -> attempted climb).
// ==============================================================================

import { h } from './dom.js';

const RENDERERS = { bool, counter, enum: enumField, multi, rating, text };

export function renderField(f, get, set) {
  const control = RENDERERS[f.type](f, get, set);
  const wrap = h('div', { class: `field field-${f.type}`, 'data-key': f.key }, control.el);
  return { el: wrap, update: control.update };
}

function header(f, extra) {
  return h('div', { class: 'field-head' },
    h('span', { class: 'field-label' }, f.label),
    f.requiredUnless ? h('span', { class: 'req' }, 'required') : null,
    extra || null,
    f.help ? h('div', { class: 'field-help' }, f.help) : null);
}

function bool(f, get, set) {
  const btn = h('button', { class: 'toggle', type: 'button', onclick: () => set(!get()) },
    h('span', { class: 'toggle-box' }), h('span', { class: 'toggle-text' }, f.label),
    f.help ? h('span', { class: 'toggle-help' }, f.help) : null);
  const update = () => {
    btn.classList.toggle('on', !!get());
    btn.setAttribute('aria-pressed', String(!!get()));
  };
  update();
  return { el: btn, update };
}

function counter(f, get, set) {
  const value = h('span', { class: `count-value ${f.tone || ''}` }, '0');
  const bump = (n) => set(Math.max(0, Math.min(9999, (get() || 0) + n)));
  const steps = f.steps || [1, 5, 10];
  const el = h('div', null,
    h('div', { class: 'count-row' }, h('span', { class: 'field-label' }, f.label), value),
    h('div', { class: 'stepper' },
      ...steps.map(n => h('button', { class: `step ${f.tone || ''}`, type: 'button', onclick: () => bump(n) }, `+${n}`)),
      h('button', { class: 'step minus', type: 'button', onclick: () => bump(-1) }, '−1')));
  const update = () => { value.textContent = String(get() || 0); };
  update();
  return { el, update };
}

function enumField(f, get, set) {
  const buttons = f.options.map((label, i) =>
    h('button', { class: 'seg', type: 'button', onclick: () => set(get() === i ? null : i) }, label));
  const el = h('div', null, header(f), h('div', { class: 'segments' }, buttons));
  const update = () => buttons.forEach((b, i) => b.classList.toggle('on', get() === i));
  update();
  return { el, update };
}

function multi(f, get, set) {
  const buttons = f.options.map((label, i) =>
    h('button', { class: 'chip', type: 'button', onclick: () => set((get() || 0) ^ (1 << i)) }, label));
  const el = h('div', null, header(f, h('span', { class: 'field-hint' }, 'pick all that apply')),
    h('div', { class: 'segments' }, buttons));
  const update = () => buttons.forEach((b, i) => b.classList.toggle('on', ((get() || 0) & (1 << i)) !== 0));
  update();
  return { el, update };
}

function rating(f, get, set) {
  const buttons = [];
  for (let i = 1; i <= f.max; i++) {
    buttons.push(h('button', { class: 'seg rate', type: 'button', onclick: () => set(get() === i ? null : i) }, String(i)));
  }
  const el = h('div', null, header(f),
    h('div', { class: 'segments rating' }, buttons),
    h('div', { class: 'rate-ends' }, h('span', null, `1 = ${f.lowLabel}`), h('span', null, `${f.max} = ${f.highLabel}`)));
  const update = () => buttons.forEach((b, i) => b.classList.toggle('on', get() === i + 1));
  update();
  return { el, update };
}

function text(f, get, set) {
  const count = h('span', { class: 'field-hint' }, '');
  const area = h('textarea', { class: 'notes', rows: 4, maxlength: String(f.maxLength), placeholder: 'Optional' });
  area.addEventListener('input', () => { set(area.value); count.textContent = `${area.value.length}/${f.maxLength}`; });
  const el = h('div', null, header(f, count), area);
  const update = () => {
    if (area.value !== (get() || '')) area.value = get() || '';
    count.textContent = `${area.value.length}/${f.maxLength}`;
  };
  update();
  return { el, update };
}
