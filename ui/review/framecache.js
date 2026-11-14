// Smooth playback for films that cannot be drawn live at full speed. A heavy film (3D, post effects) can need 100 ms or more for
// one frame, so the live preview crawls however fast the computer is. Because window.renderOut(t) is a pure function of t, every
// frame can be drawn once, in the background while you are not watching, kept as a small JPEG, and then played back from those
// pictures at the screen's full speed (live.js asks paint(t) first and only draws the film itself for frames not saved yet).
//
//   - a quick check first (24 frames spread over the film): films that draw fast everywhere are left alone ("light": nothing is saved);
//     a film that turns out slow while playing anyway (a few heavy shots the check missed) is saved after all
//   - frames are drawn from the playhead forward, one at a time, while the preview is paused and you are not using it (pausing is
//     enough: it carries on a moment after you pause, it does not wait for the mouse to stand still)
//   - a code change (the preview reloads) keeps the pictures but does not trust them: 1 frame in 15 is drawn again and compared with its
//     saved picture, and only the stretches that really changed are saved again (the rest stays ready, so smooth playback is back in
//     seconds, not minutes); the memory used is capped (about 450 MB)
//   - paused, scrubbing, notes and captures always show the film's own exact frame, never a saved picture. While frames are being
//     drawn in the background the film page flashes through the whole film behind the scenes, so a still copy of the picture you
//     were looking at covers it (freeze) and the film is put back on that frame the moment you touch anything (thaw)
//   - playback uses the saved pictures only where the next half second is saved too (no flipping between a saved picture and a
//     slow live draw), and waits a moment at the start until the first pictures are decoded
const MAX_BYTES = 450 * 1024 * 1024, LONG_SIDE = 1280, QUALITY = 0.84, HEAVY_MS = 14, AHEAD = 24, KEEP_BEHIND = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextTask = () => new Promise(r => setTimeout(r, 0));
const toBlob = (c, type, q) => new Promise(res => c.toBlob(b => res(b), type, q));

export function createFrameCache({ onChange } = {}) {
  let api = null, runId = 0, state = 'idle', done = 0, total = 0, bytes = 0, mode = true;
  try { mode = localStorage.getItem('vh-smooth') !== '0'; } catch { }
  const blobs = new Map(), bitmaps = new Map(), pending = new Set();
  let ov = null, g = null, shown = false, lastF = -1, lastInput = 0, playing = false, slow = 0, frozen = false, usingCache = false, waiting = false, grabMs = 0, grabbed = 0;
  let stale = false, phase = 'speed', shape = null, freshWaiters = [];
  const sigs = new Map();   // frame -> a 32 px wide grey picture, to tell whether a frame looks the same after a code change
  const sg = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const emit = () => { try { onChange?.(info()); } catch { } };
  const info = () => ({ state, phase, stale, done, total, bytes, mode, waiting, pct: total ? Math.round(100 * done / total) : 0, etaSec: grabbed ? Math.round((total - done) * (grabMs / grabbed) / 1000) : null });
  if (typeof document !== 'undefined') // using the preview = clicking, drawing (a drag), typing, scrolling; a mouse that only rests or hovers over it does not count
  if (typeof document !== 'undefined') for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) document.addEventListener(ev, e => { if (ev === 'pointermove' && !e.buttons) return; if (ev === 'keydown' && (e.code === 'Space' || e.key === 'k')) return; lastInput = performance.now(); }, { capture: true, passive: true });

  function overlay() {
    if (ov) return ov;
    ov = document.createElement('canvas'); ov.className = 'live-cache'; ov.hidden = true;
    ov.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;background:#000;';
    g = ov.getContext('2d'); return ov;
  }
  function place(fullSize = false) {   // same box and scale as the film's iframe
    const o = overlay(), f = api.iframe();
    if (!f) return;
    if (o.parentNode !== api.box || api.box.lastChild !== o) api.box.append(o);   // always the last (top) layer: a reloaded page is added after it
    o.style.width = api.info.w + 'px'; o.style.height = api.info.h + 'px'; o.style.transform = f.style.transform || 'none';
    const k = fullSize ? 1 : Math.min(1, LONG_SIDE / Math.max(api.info.w, api.info.h)), W = Math.round(api.info.w * k), H = Math.round(api.info.h * k);
    if (o.width !== W || o.height !== H) { o.width = W; o.height = H; }
  }
  // a still copy of what the film page shows now covers it while frames are drawn behind it; thaw puts the film back on that picture
  function freeze() {
    if (frozen || !api) return;
    try { place(true); g.drawImage(api.copy(api.info.w), 0, 0, ov.width, ov.height); ov.hidden = false; shown = true; lastF = -1; frozen = true; } catch { }
  }
  function thaw() {
    if (!frozen) return;
    frozen = false;
    try { api.restore(); } catch { }
    hide();
  }
  function clear() {
    runId++; thaw(); usingCache = false; stale = false; sigs.clear(); shape = null; resolveFresh(); blobs.clear(); for (const b of bitmaps.values()) try { b.close(); } catch { } bitmaps.clear(); pending.clear();
    bytes = 0; done = 0; total = 0; lastF = -1; hide(); state = 'idle'; waiting = false; grabMs = 0; grabbed = 0;
  }
  function hide() { if (shown && ov) ov.hidden = true; shown = false; }

  // the frame to show for film time t, or false when the film itself has to draw it
  function paint(t) {
    if (!api || !mode || !blobs.size || stale) return false;
    const fps = api.info.fps || 30, f = Math.min(Math.max(0, Math.round(t * fps)), Math.ceil(api.info.dur * fps) - 1);
    prefetch(f);
    // saved pictures only where the next stretch is saved as well; after a gap, live drawing until a longer stretch is saved
    if (frozen) thaw();
    const ok = covered(f, usingCache ? 12 : 36);
    if (!ok) { usingCache = false; return false; }
    usingCache = true;
    const bmp = bitmaps.get(f);
    if (bmp) {
      if (f !== lastF || !shown) { place(); g.drawImage(bmp, 0, 0, ov.width, ov.height); lastF = f; }
      if (!shown) { ov.hidden = false; shown = true; }
      return true;
    }
    return shown;   // saved but not decoded yet: keep the picture on screen for a moment instead of a slow live draw
  }
  function covered(f, n) {
    const last = Math.min(f + n - 1, Math.ceil(api.info.dur * (api.info.fps || 30)) - 1);
    for (let k = f; k <= last; k++) if (!blobs.has(k)) return false;
    return true;
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
  const quiet = () => api && !playing && !api.busy() && performance.now() - lastInput > 700;

  const shapeOf = () => `${api.info.w}x${api.info.h}@${api.info.fps}/${Math.round(api.info.dur * 100)}`;
  const resolveFresh = () => { const w = freshWaiters; freshWaiters = []; for (const r of w) r(); };
  // a 32 px wide grey copy of a drawn frame
  function sigOf(c) {
    sg.width = 32; sg.height = Math.max(8, Math.round(32 * c.height / c.width));
    const x = sg.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, sg.width, sg.height);
    const d = x.getImageData(0, 0, sg.width, sg.height).data, out = new Uint8Array(sg.width * sg.height);
    for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    return out;
  }
  const sigDiff = (a, b) => { if (!a || !b || a.length !== b.length) return 255; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  const forget = (a, b) => { for (let f = a; f <= b; f++) { const x = blobs.get(f); if (x) { bytes -= x.size; blobs.delete(f); } sigs.delete(f); const bm = bitmaps.get(f); if (bm) { try { bm.close(); } catch { } bitmaps.delete(f); } } };
  // after a code change: draw 1 frame in 15 again and compare it with the saved one; forget the stretches around the frames that
  // changed (half a second either side), keep everything else. Nearly everything changed (a camera or colour change): forget it all.
  async function revalidate(id) {
    const { fps, dur } = api.info, N = Math.ceil(dur * fps), STEP = 15, W = Math.round(api.info.w * Math.min(1, LONG_SIDE / Math.max(api.info.w, api.info.h)));
    const probes = []; for (let f = Math.min(7, N - 1); f < N; f += STEP) if (sigs.has(f)) probes.push(f);
    phase = 'changes'; total = probes.length; done = 0; state = 'checking'; emit();
    const changed = []; let lastEmit = 0;
    for (const f of probes) {
      while (playing) { await sleep(200); if (id !== runId) return false; }
      freeze();
      const c = api.grab(f / fps, W);
      if (sigDiff(sigs.get(f), sigOf(c)) > 1.5) changed.push(f);
      done++; if (performance.now() - lastEmit > 300) { lastEmit = performance.now(); emit(); }
      await nextTask(); if (id !== runId) return false;
    }
    thaw();
    if (probes.length && changed.length > probes.length * 0.6) { forget(0, N); }
    else for (const f of changed) forget(Math.max(0, f - STEP), Math.min(N - 1, f + STEP));
    return true;
  }
  // 24 frames spread over the film (golden-ratio steps: never in step with a film's own rhythm): slow when the average is high
  // or one frame in four is far over budget
  async function benchmark(id) {
    const { dur, fps } = api.info, n = 24, ms = [];
    for (let i = 0; i < n; i++) {
      while (!quiet()) { thaw(); if (!waiting) { waiting = true; emit(); } await sleep(250); if (id !== runId) return null; }
      waiting = false; freeze();
      const t = dur * (0.02 + 0.96 * ((i * 0.618034) % 1)), a = performance.now();
      api.grab(Math.round(t * fps) / fps, 160); ms.push(performance.now() - a);
      await nextTask(); if (id !== runId) return null;
    }
    thaw();
    const sorted = [...ms].sort((a, b) => a - b), mean = ms.reduce((s, x) => s + x, 0) / ms.length;
    return mean >= HEAVY_MS || sorted[Math.floor(n * 0.75)] > 30 ? 'heavy' : 'light';
  }
  async function build(force = false) {
    const id = ++runId;
    if (!api || !mode) return;
    state = 'checking'; phase = force ? 'build' : 'speed'; emit();
    if (!force) {
      await sleep(900); if (id !== runId) return;
      const verdict = await benchmark(id); if (verdict == null || id !== runId) return;
      if (verdict === 'light') { state = 'light'; emit(); return; }
    }
    const { dur, fps } = api.info, N = Math.max(1, Math.ceil(dur * fps)), W = Math.round(api.info.w * Math.min(1, LONG_SIDE / Math.max(api.info.w, api.info.h)));
    total = N; done = 0; grabMs = 0; grabbed = 0; state = 'building'; phase = 'build'; shape = shapeOf(); emit();
    const start = Math.min(N - 1, Math.max(0, Math.round(api.now() * fps)));
    let lastEmit = 0;
    for (let k = 0; k < N; k++) {
      const f = (start + k) % N;
      if (blobs.has(f)) { done++; continue; }
      while (!quiet()) { thaw(); if (!waiting) { waiting = true; emit(); } await sleep(300); if (id !== runId) return; }
      if (id !== runId) return;
      waiting = false; freeze();
      let blob = null; const g0 = performance.now();
      try { const c = api.grab(f / fps, W); sigs.set(f, sigOf(c)); blob = await toBlob(c, 'image/jpeg', QUALITY); } catch { }
      if (id !== runId) return;
      grabMs += performance.now() - g0; grabbed++;
      if (blob) { blobs.set(f, blob); bytes += blob.size; }
      done++;
      if (bytes > MAX_BYTES) { state = 'partial'; thaw(); emit(); return; }
      if (performance.now() - lastEmit > 400) { lastEmit = performance.now(); emit(); }
      await nextTask();
    }
    thaw(); state = 'ready'; emit();
  }

  return {
    // live.js: the film is loaded and ready (a reload throws the old pictures away first)
    attach(a) {
      const keep = stale && blobs.size && shape === `${a.info.w}x${a.info.h}@${a.info.fps}/${Math.round(a.info.dur * 100)}`;
      if (!keep) clear();
      api = a;
      if (!mode) return;
      if (!keep) { build().catch(() => { state = 'idle'; }); return; }
      const id = ++runId;
      revalidate(id).then(ok => { if (!ok || id !== runId) return; stale = false; resolveFresh(); emit(); return build(true); }).catch(() => { stale = false; resolveFresh(); state = 'idle'; });
    },
    // live.js: the page is being replaced (a code change). The saved pictures stay, but are not shown until they are checked again.
    invalidate() { if (!blobs.size) { clear(); emit(); return; } runId++; frozen = false; stale = true; usingCache = false; hide(); state = 'checking'; phase = 'changes'; waiting = false; emit(); },
    staleNow: () => stale,
    whenFresh() { return stale ? new Promise(r => { freshWaiters.push(r); setTimeout(r, 15000); }) : Promise.resolve(); },
    reset() { clear(); emit(); },
    paint, hide, info, shown: () => shown,
    // live.js, once a second while playing: the real frame rate. Slow for two seconds on live drawing although the check said the film
    // is light (or never ran): save it after all
    observe(fps, fromCache) {
      if (!api || !mode || fromCache || fps >= 45 || (state !== 'light' && state !== 'idle')) { slow = fromCache || fps >= 45 ? 0 : slow; return; }
      if (++slow >= 2) { slow = 0; build(true).catch(() => { state = 'idle'; }); }
    },
    playing(on) { playing = !!on; if (on) { thaw(); prefetch(Math.round((api?.now() || 0) * (api?.info.fps || 30))); } },
    // live.js asks before starting to play: are saved pictures there for this moment, and (warm) have the first ones been decoded
    covers(t) { if (!api || !mode || !blobs.size || stale) return false; const fps = api.info.fps || 30; return covered(Math.min(Math.max(0, Math.round(t * fps)), Math.ceil(api.info.dur * fps) - 1), 12); },
    warm(t) {
      const fps = api.info.fps || 30, f = Math.round(t * fps); prefetch(f);
      return new Promise(res => { const t0 = performance.now(); (function poll() { let ok = true; for (let k = f; k < f + 6; k++) if (blobs.has(k) && !bitmaps.has(k)) ok = false; if (ok || performance.now() - t0 > 400) res(); else setTimeout(poll, 16); })(); });
    },
    // the on/off button: off drops every saved picture
    setMode(on) { mode = !!on; try { localStorage.setItem('vh-smooth', mode ? '1' : '0'); } catch { } if (!mode) { clear(); emit(); } else if (api) build().catch(() => { state = 'idle'; }); return mode; },
    get mode() { return mode; },
  };
}
