// ==============================================================================
// Camera QR scanner overlay (used for config and schedule codes on the iPad,
// and for checking scout codes in lead tools). Uses the vendored jsQR library
// (global `jsQR`). The camera needs HTTPS or localhost.
//
// scanQR({ title, hint, onCode }) — onCode(text) is called for each code seen
// and returns (or resolves to) { ok, message, done, value }. When done is true
// the overlay closes and scanQR resolves with value. Closing early resolves null.
// ==============================================================================

import { h } from './dom.js';

export function scanQR({ title, hint = 'Point the camera at the QR code', onCode }) {
  return new Promise(resolve => {
    let stream = null, timer = null, closed = false, busy = false;
    let lastText = '', lastTime = 0;

    const video = h('video', { playsinline: true, autoplay: true });
    video.muted = true;
    video.setAttribute('playsinline', ''); // required on iOS or the video goes fullscreen

    const status = h('div', { class: 'scan-status' }, hint);
    const manual = h('textarea', { class: 'scan-manual', rows: 3, placeholder: 'Paste the code text here' });

    const close = (value = null) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      overlay.remove();
      resolve(value);
    };

    const handle = async (text) => {
      if (busy || closed) return;
      if (text === lastText && Date.now() - lastTime < 2500) return; // same code still in view
      lastText = text; lastTime = Date.now();
      busy = true;
      try {
        const res = await onCode(text);
        status.textContent = res.message || '';
        status.className = `scan-status ${res.ok === false ? 'bad' : 'good'}`;
        if (res.done) setTimeout(() => close(res.value), 700);
      } finally {
        busy = false;
      }
    };

    const overlay = h('div', { class: 'scan-overlay' },
      h('div', { class: 'scan-head' },
        h('h2', null, title),
        h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Close')),
      h('div', { class: 'scan-view' }, video, h('div', { class: 'scan-frame' })),
      status,
      h('details', { class: 'scan-alt' },
        h('summary', null, 'No camera? Type or paste the code'),
        manual,
        h('button', { class: 'btn', onclick: () => { lastText = ''; handle(manual.value.trim()); } }, 'Use this code')));
    document.body.append(overlay);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (closed) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const scale = Math.min(1, 720 / video.videoWidth); // smaller frames decode faster
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = globalThis.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) handle(code.data);
      }
      timer = setTimeout(tick, 120);
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = 'Camera not available here (needs HTTPS). Use the text box below.';
      status.className = 'scan-status bad';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(s => {
        if (closed) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {});
        tick();
      })
      .catch(err => {
        status.textContent = `Camera unavailable (${err.name}). Allow camera access, or use the text box below.`;
        status.className = 'scan-status bad';
      });
  });
}
