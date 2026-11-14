// Smooth playback for films that cannot be drawn live at full speed. A heavy film (3D, post effects) can need 100 ms or more for
// one frame, so the live preview crawls however fast the computer is. Because window.renderOut(t) is a pure function of t, every
// frame can be drawn once, in the background while you are not watching, kept as a small JPEG, and then played back from those
// pictures at the screen's full speed (live.js asks paint(t) first and only draws the film itself for frames not saved yet).
//
//   - a quick check first (24 frames spread over the film): films that draw fast everywhere are left alone ("light": nothing is saved);
//     a film that turns out slow while playing anyway (a few heavy shots the check missed) is saved after all
//   - frames are drawn from the playhead forward, one at a time, only while the preview is paused and you are not touching it
//   - a code change (the preview reloads) throws the pictures away; the memory used is capped (about 450 MB)
//   - paused, scrubbing, notes and captures always show the film's own exact frame, never a saved picture
const MAX_BYTES = 450 * 1024 * 1024, LONG_SIDE = 1280, QUALITY = 0.84, HEAVY_MS = 14, AHEAD = 24, KEEP_BEHIND = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextTask = () => new Promise(r => setTimeout(r, 0));
const toBlob = (c, type, q) => new Promise(res => c.toBlob(b => res(b), type, q));

export function createFrameCache({ onChange } = {}) {
  let api = null, runId = 0, state = 'idle', done = 0, total = 0, bytes = 0, mode = true;
  try { mode = localStorage.getItem('vh-smooth') !== '0'; } catch { }
  const blobs = new Map(), bitmaps = new Map(), pending = new Set();
  let ov = null, g = null, shown = false, lastF = -1, lastInput = 0, playing = false, slow = 0;
  const emit = () => { try { onChange?.(info()); } catch { } };
  const info = () => ({ state, done, total, bytes, mode, pct: total ? Math.round(100 * done / total) : 0 });
  if (typeof document !== 'undefined') for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) document.addEventListener(ev, () => { lastInput = performance.now(); }, { capture: true, passive: true });

  function overlay() {
    if (ov) return ov;
    ov = document.createElement('canvas'); ov.className = 'live-cache'; ov.hidden = true;
    ov.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;background:#000;';
    g = ov.getContext('2d'); return ov;
  }
  function place() {   // same box and scale as the film's iframe
    const o = overlay(), f = api.iframe();
    if (!f) return;
    if (o.parentNode !== api.box) api.box.append(o);
    o.style.width = api.info.w + 'px'; o.style.height = api.info.h + 'px'; o.style.transform = f.style.transform || 'none';
    const k = Math.min(1, LONG_SIDE / Math.max(api.info.w, api.info.h)), W = Math.round(api.info.w * k), H = Math.round(api.info.h * k);
    if (o.width !== W || o.height !== H) { o.width = W; o.height = H; }
  }
  function clear() {
    runId++; blobs.clear(); for (const b of bitmaps.values()) try { b.close(); } catch { } bitmaps.clear(); pending.clear();
    bytes = 0; done = 0; total = 0; lastF = -1; hide(); state = 'idle';
  }
  function hide() { if (shown && ov) ov.hidden = true; shown = false; }

  // the frame to show for film time t, or false when the film itself has to draw it
  function paint(t) {
    if (!api || !mode || !blobs.size) return false;
    const fps = api.info.fps || 30, f = Math.min(Math.max(0, Math.round(t * fps)), Math.ceil(api.info.dur * fps) - 1);
    prefetch(f);
    if (!blobs.has(f)) { return false; }
    const bmp = bitmaps.get(f);
    if (bmp) {
      if (f !== lastF || !shown) { place(); g.drawImage(bmp, 0, 0, ov.width, ov.height); lastF = f; }
      if (!shown) { ov.hidden = false; shown = true; }
      return true;
    }
    return shown;   // saved but not decoded yet: keep the picture on screen for a moment instead of a slow live draw
  }
  function prefetch(f) {
    for (let k = f; k < f + AHEAD; k++) {
      if (bitmaps.has(k) || pending.has(k) || !blobs.has(k)) continue;
      pending.add(k);
      createImageBitmap(blobs.get(k)).then(b => { pending.delete(k); if (blobs.has(k)) bitmaps.set(k, b); else b.close(); }).catch(() => pending.delete(k));
    }
    for (const [k, b] of bitmaps) if (k < f - KEEP_BEHIND || k > f + AHEAD * 2) { bitmaps.delete(k); try { b.close(); } catch { } }
  }

  // idle for a moment, paused, and nobody is using the preview
  const quiet = () => api && !playing && !api.busy() && performance.now() - lastInput > 1200;

  // 24 frames spread over the film (golden-ratio steps: never in step with a film's own rhythm): slow when the average is high
  // or one frame in four is far over budget
  async function benchmark(id) {
    const { dur, fps } = api.info, n = 24, ms = [];
    for (let i = 0; i < n; i++) {
      while (!quiet()) { await sleep(250); if (id !== runId) return null; }
      const t = dur * (0.02 + 0.96 * ((i * 0.618034) % 1)), a = performance.now();
      api.grab(Math.round(t * fps) / fps, 160); ms.push(performance.now() - a);
      await nextTask(); if (id !== runId) return null;
    }
    api.restore();
    const sorted = [...ms].sort((a, b) => a - b), mean = ms.reduce((s, x) => s + x, 0) / ms.length;
    return mean >= HEAVY_MS || sorted[Math.floor(n * 0.75)] > 30 ? 'heavy' : 'light';
  }
  async function build(force = false) {
    const id = ++runId;
    if (!api || !mode) return;
    state = 'checking'; emit();
    if (!force) {
      await sleep(900); if (id !== runId) return;
      const verdict = await benchmark(id); if (verdict == null || id !== runId) return;
      if (verdict === 'light') { state = 'light'; emit(); return; }
    }
    const { dur, fps } = api.info, N = Math.max(1, Math.ceil(dur * fps)), W = Math.round(api.info.w * Math.min(1, LONG_SIDE / Math.max(api.info.w, api.info.h)));
    total = N; state = 'building'; emit();
    const start = Math.min(N - 1, Math.max(0, Math.round(api.now() * fps)));
    let lastEmit = 0;
    for (let k = 0; k < N; k++) {
      const f = (start + k) % N;
      if (blobs.has(f)) { done++; continue; }
      while (!quiet()) { await sleep(300); if (id !== runId) return; }
      if (id !== runId) return;
      let blob = null;
      try { blob = await toBlob(api.grab(f / fps, W), 'image/jpeg', QUALITY); } catch { }
      if (id !== runId) return;
      if (blob) { blobs.set(f, blob); bytes += blob.size; }
      done++;
      if (bytes > MAX_BYTES) { state = 'partial'; api.restore(); emit(); return; }
      if (performance.now() - lastEmit > 400) { lastEmit = performance.now(); emit(); }
      await nextTask();
    }
    api.restore(); state = 'ready'; emit();
  }

  return {
    // live.js: the film is loaded and ready (a reload throws the old pictures away first)
    attach(a) { clear(); api = a; if (mode) build().catch(() => { state = 'idle'; }); },
    reset() { clear(); emit(); },
    paint, hide, info, shown: () => shown,
    // live.js, once a second while playing: the real frame rate. Slow for two seconds on live drawing although the check said the film
    // is light (or never ran): save it after all
    observe(fps, fromCache) {
      if (!api || !mode || fromCache || fps >= 45 || (state !== 'light' && state !== 'idle')) { slow = fromCache || fps >= 45 ? 0 : slow; return; }
      if (++slow >= 2) { slow = 0; build(true).catch(() => { state = 'idle'; }); }
    },
    playing(on) { playing = !!on; if (on) { prefetch(Math.round((api?.now() || 0) * (api?.info.fps || 30))); } },
    // the on/off button: off drops every saved picture
    setMode(on) { mode = !!on; try { localStorage.setItem('vh-smooth', mode ? '1' : '0'); } catch { } if (!mode) { clear(); emit(); } else if (api) build().catch(() => { state = 'idle'; }); return mode; },
    get mode() { return mode; },
  };
}
