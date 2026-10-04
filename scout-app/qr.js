// Renders text as a QR code (SVG). Uses the vendored qrcode-generator library,
// loaded as a classic <script> that defines a global `qrcode`.

import { h } from './dom.js';

/** SVG markup for a QR code. ecc 'M' tolerates some screen glare without getting too dense. */
export function qrSvg(text, ecc = 'M') {
  const qrcode = globalThis.qrcode;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; // notes may contain emoji/accents
  const qr = qrcode(0, ecc);
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4; // white border the scanner needs
  const size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export function qrElement(text, className = 'qr') {
  return h('div', { class: className, html: qrSvg(text) });
}
