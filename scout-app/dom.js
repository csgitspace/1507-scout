// Tiny DOM helpers shared by the scout app and lead tools. No framework on purpose.

/**
 * h('button', { class: 'btn', onclick: fn }, 'Label') -> <button class="btn">Label</button>
 * Children can be strings, nodes, arrays, or null/false (skipped). Strings are
 * always inserted as text, never HTML, so scout-entered text can't inject markup.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only used for SVG we generate ourselves
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

let toastTimer;
/** Brief message at the bottom of the screen. kind: 'info' | 'good' | 'bad' */
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'bad' ? 4500 : 2500);
}

/** Full-screen modal. build(close) returns the modal's content. Resolves with whatever close() is given. */
export function modal(build) {
  return new Promise(resolve => {
    const close = (value) => { overlay.remove(); resolve(value); };
    const overlay = h('div', { class: 'modal-overlay' }, h('div', { class: 'modal-card' }, build(close)));
    document.body.append(overlay);
  });
}

/** Yes/no question with big buttons. Resolves true/false. */
export function confirmDialog(message, { ok = 'Yes', cancel = 'Cancel', danger = false } = {}) {
  return modal(close => [
    h('p', { class: 'modal-msg' }, message),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: () => close(false) }, cancel),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, ok)),
  ]);
}

/** On-screen number pad. Resolves with the digits entered, or null if cancelled. */
export function numberPad(title, { maxLength = 8, mask = false } = {}) {
  return modal(close => {
    let digits = '';
    const display = h('div', { class: 'pad-display' }, '');
    const render = () => { display.textContent = mask ? '•'.repeat(digits.length) : digits || ' '; };
    const key = (label, fn, cls = '') => h('button', { class: `pad-key ${cls}`, onclick: fn }, label);
    const pad = h('div', { class: 'pad' },
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d =>
        key(d, () => { if (digits.length < maxLength) { digits += d; render(); } })),
      key('⌫', () => { digits = digits.slice(0, -1); render(); }, 'muted'),
      key('0', () => { if (digits.length < maxLength) { digits += '0'; render(); } }),
      key('OK', () => close(digits || null), 'ok'));
    render();
    return [h('h2', { class: 'modal-title' }, title), display, pad,
      h('button', { class: 'btn ghost wide', onclick: () => close(null) }, 'Cancel')];
  });
}
