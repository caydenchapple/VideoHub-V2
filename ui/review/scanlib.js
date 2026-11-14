// Checks for a film that looks wrong in motion: the picture shaking or snapping sideways, a patch that wobbles, shapes or textures that
// swim without moving, lighting that jumps, an object that falls the wrong way, stops dead, floats or teleports, and (when the film says
// where its objects are, window.VH_BODIES) bodies that overlap, sink into the ground, hover, fall at the wrong gravity or jitter.
// Pure functions on small frames: no DOM, no network. Used by the review page's Scan panel (ui/review/autoscan.js) and by the MCP
// review (server/review.js), which runs the same film in a hidden browser.
//
// A frame: { t, luma: Uint8Array (w*h grey), w, h, rgb?: [r, g, b] (mean), sharp?: number, bodies?: Body[] }, frames equally spaced in time.
// A body:  { id, pos: [x, y, z] in metres (y up), size: [w, h, d] (full extent, metres) or r (radius), static?, grounded?, flying?, parent?,
//            allowOverlap? }
// A finding: { kind, t0, t1, n, infos: [text], conf: 0-1, where?: [x, y] (0-1 in the picture) }

export const REAL_G = 9.81;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 2) => +v.toFixed(d);

// ---------- picture motion
// the best whole-picture shift (dx, dy) of b against a, searched in +-R pixels over the middle of the picture
export function bestShift(a, b, w, h, R = 3) {
  const x0 = R + 1, x1 = w - R - 1, y0 = R + 1, y1 = h - R - 1, area = (x1 - x0) * (y1 - y0);
  let best = Infinity, bx = 0, by = 0, zero = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0;
    for (let y = y0; y < y1; y += 2) { const ra = y * w, rb = (y + dy) * w + dx; for (let x = x0; x < x1; x += 2) s += Math.abs(a[ra + x] - b[rb + x]); }
    if (dx === 0 && dy === 0) zero = s;
    if (s < best) { best = s; bx = dx; by = dy; }
  }
  const k = area / 4;
  return { dx: bx, dy: by, sad: best / k, sad0: zero / k };
}
const meanAbsDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
// the same with the difference in average brightness taken out: is it the same picture, only lighter or darker?
const meanAbsDiffNorm = (a, b, off) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(b[i] - a[i] - off); return s / a.length; };

// every pair of frames: the global shift, how much changed, how much of it is not explained by a shift
export function motionSeries(frames) {
  const out = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    const s = bestShift(a.luma, b.luma, b.w, b.h);
    out.push({ i, t: b.t, dx: s.dx, dy: s.dy, sad: s.sad, sad0: s.sad0, diff: meanAbsDiff(a.luma, b.luma) });
  }
  return out;
}

// merge flagged sample times into ranges of one kind
function ranges(kind, hits, dt, mk) {
  const out = [], gap = dt * 2.5;
  for (const h of hits.sort((a, b) => a.t - b.t)) {
    const l = out[out.length - 1];
    if (l && h.t - l.t1 <= gap) { l.t1 = h.t; l.n++; l.conf = Math.max(l.conf, h.conf ?? 0.6); if (h.info && l.infos.length < 3 && !l.infos.includes(h.info)) l.infos.push(h.info); if (h.where) l.where = h.where; }
    else out.push({ kind, t0: h.t, t1: h.t, n: 1, conf: h.conf ?? 0.6, infos: h.info ? [h.info] : [], where: h.where });
  }
  for (const r of out) { r.t0 = round(r.t0, 3); r.t1 = round(r.t1, 3); if (mk) mk(r); }
  return out;
}

// the whole picture shaking (it shifts back and forth), or snapping sideways in one frame
export function detectShake(frames, ms, { fps }) {
  const dt = 1 / fps, W = frames[0]?.w || 96, px = v => `${Math.abs(v)} px of ${W}`;
  const hits = [], win = Math.max(5, Math.round(fps * 0.4));
  for (let k = 0; k + win <= ms.length; k++) {
    const seg = ms.slice(k, k + win);
    if (seg.some(m => m.diff > 30 && m.sad > 20)) continue;   // a cut inside (a shifted copy of the same picture matches well: sad is low)
    for (const axis of ['dx', 'dy']) {
      const v = seg.map(m => m[axis]); let flips = 0, amp = 0, drift = 0;
      for (let j = 1; j < v.length; j++) { if (v[j] * v[j - 1] < 0) flips++; amp = Math.max(amp, Math.abs(v[j])); drift += v[j]; }
      if (flips >= Math.min(4, win - 2) && amp >= 1 && Math.abs(drift) <= amp * 2) hits.push({ t: seg[Math.floor(win / 2)].t, conf: clamp(0.5 + flips / 12, 0.5, 0.95), info: `the whole picture jitters ${axis === 'dx' ? 'sideways' : 'up and down'} (${flips} reversals in ${(win * dt).toFixed(1)} s, up to ${px(amp)})` });
    }
  }
  const out = ranges('shake', hits, dt);
  // one frame that jumps by 3+ px while the frames around it hardly move
  const pops = [];
  for (let k = 1; k < ms.length - 1; k++) {
    const m = ms[k], mag = Math.max(Math.abs(m.dx), Math.abs(m.dy));
    if (mag >= 3 && m.sad < 20 && Math.max(Math.abs(ms[k - 1].dx), Math.abs(ms[k - 1].dy), Math.abs(ms[k + 1].dx), Math.abs(ms[k + 1].dy)) <= 1) pops.push({ t: m.t, conf: 0.7, info: `the picture snaps ${px(m.dx || m.dy)} in one frame while it is still before and after` });
  }
  return out.concat(ranges('snap', pops, dt));
}

// blocks of the picture that jiggle by themselves (a wobbling object) while the rest is still: block motion that reverses direction again and again
export function detectWobble(frames, { fps, grid = [8, 6] } = {}) {
  if (frames.length < 8) return [];
  const [gx, gy] = grid, w = frames[0].w, h = frames[0].h, bw = Math.floor(w / gx), bh = Math.floor(h / gy), R = 2;
  const motion = [];   // per pair: per block [dx, dy] or null when the block is flat
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].luma, b = frames[i].luma, row = [];
    for (let by = 0; by < gy; by++) for (let bx = 0; bx < gx; bx++) {
      const x0 = bx * bw + R + 1, y0 = by * bh + R + 1, x1 = (bx + 1) * bw - R - 1, y1 = (by + 1) * bh - R - 1;
      let best = Infinity, ox = 0, oy = 0, zero = 0, contrast = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) contrast += Math.abs(a[y * w + x] - a[y * w + x + 1]);
      if (contrast / ((x1 - x0) * (y1 - y0)) < 3) { row.push(null); continue; }   // no texture: motion cannot be told
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        let s = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += Math.abs(a[y * w + x] - b[(y + dy) * w + x + dx]);
        if (!dx && !dy) zero = s; if (s < best) { best = s; ox = dx; oy = dy; }
      }
      row.push(zero - best > (x1 - x0) * (y1 - y0) * 1.2 ? [ox, oy] : [0, 0]);
    }
    motion.push(row);
  }
  const hits = [], win = Math.max(6, Math.round(fps * 0.5));
  for (let k = 0; k + win <= motion.length; k += 2) {
    const mid = frames[k + 1 + Math.floor(win / 2)].t, flat = [];
    for (let blk = 0; blk < gx * gy; blk++) {
      let flips = 0, amp = 0, prev = 0, moving = 0;
      for (let j = k; j < k + win; j++) { const m = motion[j][blk]; if (!m) { flips = 0; break; } const v = m[0] || m[1] ? (Math.abs(m[0]) >= Math.abs(m[1]) ? m[0] : m[1]) : 0; if (v) { moving++; amp = Math.max(amp, Math.abs(v)); if (prev && v * prev < 0) flips++; prev = v; } }
      if (flips >= 3 && moving >= win * 0.6) flat.push(blk);
    }
    // the rest of the picture is calm: fewer than a third of the blocks wobble (more is a camera shake, found elsewhere)
    if (flat.length && flat.length < gx * gy / 3) { const blk = flat[0]; hits.push({ t: mid, conf: 0.6, info: `a patch of the picture wobbles back and forth by itself (about ${Math.round(((blk % gx) + 0.5) / gx * 100)}% across, ${Math.round((Math.floor(blk / gx) + 0.5) / gy * 100)}% down)`, where: [((blk % gx) + 0.5) / gx, (Math.floor(blk / gx) + 0.5) / gy] }); }
  }
  return ranges('wobble', hits, 1 / fps);
}

// shapes or textures that change without moving: after the best local match, a large part of the picture still does not match the frame before
export function detectMorph(frames, ms, { fps, grid = [8, 6], fracs: dbg = null } = {}) {
  if (frames.length < 8) return [];
  const [gx, gy] = grid, w = frames[0].w, h = frames[0].h, bw = Math.floor(w / gx), bh = Math.floor(h / gy), R = 3;
  const hits = [], fracs = [];
  for (let i = 1; i < frames.length; i++) {
    if (ms[i - 1].diff > 22) { fracs.push(0); continue; }   // a cut or a flash is not morphing
    const a = frames[i - 1].luma, b = frames[i].luma; let bad = 0, used = 0;
    for (let by = 0; by < gy; by++) for (let bx = 0; bx < gx; bx++) {
      const x0 = bx * bw + R + 1, y0 = by * bh + R + 1, x1 = (bx + 1) * bw - R - 1, y1 = (by + 1) * bh - R - 1, n = (x1 - x0) * (y1 - y0);
      let contrast = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) contrast += Math.abs(b[y * w + x] - b[y * w + x + 1]);
      if (contrast / n < 4) continue;   // flat sky or wall: nothing to match
      used++; let best = Infinity;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { let s = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += Math.abs(b[y * w + x] - a[(y + dy) * w + x + dx]); if (s < best) best = s; }
      if (best / n > 9) bad++;
    }
    fracs.push(used >= 6 ? bad / used : 0);
  }
  if (dbg) dbg.push(...fracs);
  const win = Math.max(5, Math.round(fps * 0.35));
  for (let k = 0; k + win <= fracs.length; k++) {
    const seg = fracs.slice(k, k + win), mean = seg.reduce((s, x) => s + x, 0) / win;
    if (mean > 0.22 && seg.every(x => x > 0.08)) hits.push({ t: frames[k + 1 + Math.floor(win / 2)].t, conf: clamp(mean * 1.5, 0.45, 0.85), info: `${Math.round(mean * 100)}% of the picture changes shape or texture without moving (it swims or morphs)` });
  }
  return ranges('morph', hits, 1 / fps);
}

// brightness or colour that jumps inside a shot, and a picture that suddenly goes soft
export function detectLight(frames, ms, { fps, cutTimes = [] }) {
  const lighting = [], soft = [];
  const mean = f => { let s = 0; for (let i = 0; i < f.luma.length; i += 3) s += f.luma[i]; return s / Math.ceil(f.luma.length / 3); };
  const m = frames.map(mean);
  for (let i = 1; i < frames.length; i++) {
    if (meanAbsDiffNorm(frames[i - 1].luma, frames[i].luma, m[i] - m[i - 1]) > 22) continue;   // a different picture: a cut
    const dl = m[i] - m[i - 1];
    if (cutTimes.some(c => Math.abs(c - frames[i].t) < 1.6 / fps)) continue;   // a scene boundary is a cut: the light is allowed to change there
    // a jump of 12+ grey levels in the average, in a frame whose picture is otherwise the same (the shift-corrected match is good)
    if (Math.abs(dl) >= 12 && meanAbsDiffNorm(frames[i - 1].luma, frames[i].luma, dl) < 14 && Math.abs(m[Math.min(frames.length - 1, i + 2)] - m[i]) < Math.abs(dl) * 0.5) lighting.push({ t: frames[i].t, conf: 0.65, info: `the picture gets ${dl > 0 ? 'brighter' : 'darker'} by ${Math.abs(dl).toFixed(0)} levels in one frame without a cut` });
    const a = frames[i - 1].rgb, b = frames[i].rgb;
    if (a && b) { const warm = (b[0] - b[2]) - (a[0] - a[2]); if (Math.abs(warm) >= 14 && ms[i - 1].sad < 30) lighting.push({ t: frames[i].t, conf: 0.55, info: `the colour of the light shifts ${warm > 0 ? 'warmer' : 'cooler'} in one frame` }); }
  }
  const sh = frames.map(f => f.sharp).filter(x => x != null);
  if (sh.length > 8) {
    const med = [...sh].sort((a, b) => a - b)[sh.length >> 1], win = Math.max(6, Math.round(fps * 0.5));
    for (let k = 0; k + win <= frames.length; k++) {
      const seg = frames.slice(k, k + win); if (seg.some(f => f.sharp == null) || seg[0].t < 0.5) continue;
      if (med > 2 && seg.every(f => f.sharp < med * 0.45) && ms.slice(k, k + win - 1).every(x => x.diff < 22)) soft.push({ t: seg[win >> 1].t, conf: 0.5, info: `the picture goes soft (sharpness ${Math.round(seg[win >> 1].sharp / med * 100)}% of the film's usual)` });
    }
  }
  return ranges('lightstep', lighting, 1 / fps).concat(ranges('soft', soft, 1 / fps));
}

// ---------- moving things, from the picture alone (a film that does not report its bodies)
// the largest moving patch between two frames, after taking the whole-picture shift out
function movingBlob(a, b, w, h, shift) {
  const g = 4, cw = Math.floor(w / g), ch = Math.floor(h / g), grid = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let s = 0, n = 0;
    for (let y = cy * g; y < (cy + 1) * g; y++) for (let x = cx * g; x < (cx + 1) * g; x++) { const yy = y + shift.dy, xx = x + shift.dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue; s += Math.abs(a[y * w + x] - b[yy * w + xx]); n++; }
    grid[cy * cw + cx] = n && s / n > 14 ? 1 : 0;
  }
  const seen = new Uint8Array(cw * ch); let best = null;
  for (let s0 = 0; s0 < grid.length; s0++) {
    if (!grid[s0] || seen[s0]) continue;
    const q = [s0]; seen[s0] = 1; let n = 0, sx = 0, sy = 0, x0 = cw, x1 = 0, y0 = ch, y1 = 0;
    while (q.length) { const c = q.pop(), x = c % cw, y = (c / cw) | 0; n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const nb of [c - 1, c + 1, c - cw, c + cw]) { if (nb < 0 || nb >= grid.length || !grid[nb] || seen[nb]) continue; if ((nb === c - 1 && x === 0) || (nb === c + 1 && x === cw - 1)) continue; seen[nb] = 1; q.push(nb); } }
    if (!best || n > best.n) best = { n, cx: (sx / n + 0.5) / cw, cy: (sy / n + 0.5) / ch, w: (x1 - x0 + 1) / cw, h: (y1 - y0 + 1) / ch };
  }
  return best && best.n >= 2 && best.n < grid.length * 0.4 ? best : null;
}

// follow the main moving object and look at how it moves vertically: constant speed instead of falling, stopping dead, jumping
export function detectFall(frames, ms, { fps, metersPerHeight = null }) {
  if (frames.length < 10) return [];
  const dt = 1 / fps, track = [];
  for (let i = 1; i < frames.length; i++) {
    const b = ms[i - 1].diff > 24 ? null : movingBlob(frames[i - 1].luma, frames[i].luma, frames[i].w, frames[i].h, { dx: ms[i - 1].dx, dy: ms[i - 1].dy });
    track.push(b ? { t: frames[i].t, y: b.cy, x: b.cx, h: b.h } : null);
  }
  // an object that stops leaves nothing to track (no change between frames): keep it where it was for a few samples so the stop is seen
  for (let i = 1, held = 0; i < track.length; i++) {
    if (track[i]) { held = 0; continue; }
    const p = track[i - 1]; if (p && held < 3) { track[i] = { ...p, t: frames[i + 1].t, held: true }; held++; } else held = 3;
  }
  const found = [], tele = [];
  // runs of consecutive samples that belong to one object (no jump of more than 25% of the picture)
  let run = [];
  const flush = () => { if (run.length >= Math.max(6, Math.round(fps * 0.35))) analyseRun(run); run = []; };
  for (const p of track) {
    if (!p) { flush(); continue; }
    const l = run[run.length - 1];
    if (l && Math.hypot(p.x - l.x, p.y - l.y) > 0.25) { tele.push({ t: p.t, conf: 0.5, info: `the main moving object jumps ${Math.round(Math.hypot(p.x - l.x, p.y - l.y) * 100)}% of the picture in one frame (it teleports)`, where: [p.x, p.y] }); flush(); }
    run.push(p);
  }
  flush();
  function analyseRun(r) {
    const v = []; for (let j = 1; j < r.length; j++) v.push({ t: r[j].t, vy: (r[j].y - r[j - 1].y) / dt });   // picture heights per second, down is positive
    // falling: speed down for 0.35 s or more. Constant speed (no acceleration) is floating; real gravity speeds it up
    const win = Math.max(5, Math.round(fps * 0.35));
    for (let k = 0; k + win <= v.length; k++) {
      const seg = v.slice(k, k + win), allDown = seg.every(s => s.vy > 0.12);
      if (!allDown) continue;
      const half = Math.floor(win / 2), early = seg.slice(0, half).reduce((s, x) => s + x.vy, 0) / half, late = seg.slice(-half).reduce((s, x) => s + x.vy, 0) / half;
      const acc = (late - early) / (dt * (win - half));   // picture heights per second squared
      if (acc < 0.08 * (early + late) / 2 / dt / fps * 0 + 0.15 && late < early * 1.12) found.push({ t: seg[half].t, conf: 0.5, info: `an object moves down at an even speed (${(early * 100).toFixed(0)}% of the picture per second) without speeding up: it floats instead of falling`, where: [r[0].x, r[0].y] });
      else if (metersPerHeight) { const g = acc * metersPerHeight; if (g < REAL_G * 0.45 || g > REAL_G * 2.2) found.push({ t: seg[half].t, conf: 0.7, info: `an object falls at ${g.toFixed(1)} m/s² (real gravity is ${REAL_G} m/s²)`, where: [r[0].x, r[0].y] }); }
    }
    // stops dead: a fast fall that is still within one or two frames, without the bounce reversing it
    for (let j = 2; j < v.length - 2; j++) {
      const before = (v[j - 1].vy + v[j - 2].vy) / 2, after = (v[j + 1].vy + v[j + 2].vy) / 2;
      if (before > 0.5 && Math.abs(after) < before * 0.1 && v[j].vy < before * 0.5) found.push({ t: v[j].t, conf: 0.55, info: `an object falling at ${(before * 100).toFixed(0)}% of the picture per second stops dead in one frame: no bounce, squash or slowing`, where: [r[j].x, r[j].y] });
    }
  }
  return ranges('fall', found, dt).concat(ranges('teleport', tele, dt));
}

// ---------- bodies the film reports (exact)
const halfSize = b => b.size ? [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] : [b.r || 0.5, b.r || 0.5, b.r || 0.5];
const overlapFrac = (a, b) => {
  const ha = halfSize(a), hb = halfSize(b); let vol = 1;
  for (let k = 0; k < 3; k++) { const o = Math.min(a.pos[k] + ha[k], b.pos[k] + hb[k]) - Math.max(a.pos[k] - ha[k], b.pos[k] - hb[k]); if (o <= 0) return 0; vol *= o; }
  const va = 8 * ha[0] * ha[1] * ha[2], vb = 8 * hb[0] * hb[1] * hb[2];
  return vol / Math.max(1e-9, Math.min(va, vb));
};
const related = (a, b) => a.parent === b.id || b.parent === a.id || (a.parent && a.parent === b.parent) || a.allowOverlap || b.allowOverlap;

export function detectBodies(frames, { fps, ground = 0, maxSpeed = 40 }) {
  const dt = 1 / fps, out = { overlap: [], sunk: [], floating: [], gravity: [], teleport: [], jitter: [], scalepop: [], deadstop: [] };
  const series = new Map();   // id -> [{ t, b }]
  for (const f of frames) for (const b of f.bodies || []) { if (!b || !b.id || !Array.isArray(b.pos)) continue; if (!series.has(b.id)) series.set(b.id, []); series.get(b.id).push({ t: f.t, b }); }
  const name = id => `"${id}"`;
  // overlap: two bodies share more than a fifth of the smaller one for three samples or more
  const run = new Map();
  for (const f of frames) {
    const bs = (f.bodies || []).filter(b => b && b.id && Array.isArray(b.pos)), seenNow = new Set();
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j]; if ((a.static && b.static) || related(a, b)) continue;
      const fr = overlapFrac(a, b); if (fr < 0.2) continue;
      const key = a.id + '|' + b.id; seenNow.add(key); const r = run.get(key) || { n: 0, t0: f.t, max: 0 }; r.n++; r.max = Math.max(r.max, fr); r.t1 = f.t; r.at = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2]; run.set(key, r);
      if (r.n === Math.max(3, Math.round(fps * 0.1))) out.overlap.push({ t: f.t, conf: 0.85, info: `${name(a.id)} and ${name(b.id)} pass through each other (${Math.round(fr * 100)}% of the smaller one is inside the other)`, ids: [a.id, b.id] });
    }
    for (const [k, r] of run) if (!seenNow.has(k)) run.delete(k);
  }
  for (const [id, s] of series) {
    const first = s[0].b; if (first.static) continue;
    const bottom = x => x.b.pos[1] - halfSize(x.b)[1], g0 = x => (x.b.ground ?? ground);
    // sunk into the ground / hovering above it without moving
    let sunk = 0, still = 0;
    for (let i = 0; i < s.length; i++) {
      const x = s[i], gap = bottom(x) - g0(x);
      sunk = gap < -0.03 ? sunk + 1 : 0;
      if (sunk === Math.max(3, Math.round(fps * 0.1))) out.sunk.push({ t: x.t, conf: 0.8, info: `${name(id)} is ${(-gap * 100).toFixed(0)} cm below the ground`, ids: [id] });
      const speed = i ? Math.hypot(...x.b.pos.map((v, k) => v - s[i - 1].b.pos[k])) / dt : 0;
      still = gap > 0.06 && speed < 0.05 && !x.b.flying && !x.b.grounded && x.b.grounded !== false ? still + 1 : 0;
      if (still === Math.max(5, Math.round(fps * 0.4))) out.floating.push({ t: x.t, conf: 0.7, info: `${name(id)} hovers ${(gap * 100).toFixed(0)} cm above the ground and does not move: nothing holds it up (mark it flying: true if that is on purpose)`, ids: [id] });
    }
    // teleport and scale pop
    for (let i = 1; i < s.length; i++) {
      const d = Math.hypot(...s[i].b.pos.map((v, k) => v - s[i - 1].b.pos[k])), v = d / dt;
      // a jump: far more than the frames around it, or faster than anything real
      const dPrev = i > 1 ? Math.hypot(...s[i - 1].b.pos.map((v2, k) => v2 - s[i - 2].b.pos[k])) : 0, dNext = i < s.length - 1 ? Math.hypot(...s[i + 1].b.pos.map((v2, k) => v2 - s[i].b.pos[k])) : 0;
      if (((v > maxSpeed && d > 0.3) || (d > 0.5 && d > 8 * Math.max(dPrev, dNext) + 0.1)) && !s[i].b.teleports) out.teleport.push({ t: s[i].t, conf: 0.8, info: `${name(id)} moves ${d.toFixed(1)} m in one frame (${v.toFixed(0)} m/s): it teleports`, ids: [id] });
      const sa = halfSize(s[i - 1].b), sb = halfSize(s[i].b), ch = Math.max(...sa.map((x, k) => Math.abs(sb[k] - x) / Math.max(1e-6, x)));
      if (ch > 0.2 && !s[i].b.scales) out.scalepop.push({ t: s[i].t, conf: 0.6, info: `${name(id)} changes size by ${Math.round(ch * 100)}% in one frame`, ids: [id] });
    }
    // gravity: stretches of free flight (no ground contact) where height follows a parabola
    const win = Math.max(5, Math.round(fps * 0.3));
    for (let k = 0; k + win <= s.length; k += 2) {
      const seg = s.slice(k, k + win); if (seg.some(x => x.b.grounded || x.b.flying || x.b.attached)) continue;
      const ys = seg.map(x => x.b.pos[1]), t0 = seg[0].t;
      // free flight only: no touch of the ground (sampled coarsely, so allow for what it travels between samples) and no impact (a bounce or a hit
      // is a huge acceleration for one sample, far above any fall)
      const vy = []; for (let j = 1; j < ys.length; j++) vy.push((ys[j] - ys[j - 1]) / dt);
      const impact = vy.some((v, j) => j && Math.abs(v - vy[j - 1]) / dt > REAL_G * 6);
      const bot = seg.map((x, j) => bottom(x) - g0(x) - Math.abs(vy[Math.min(j, vy.length - 1)]) * dt * 1.2); if (impact || Math.min(...bot) < 0.05) continue;
      const q = fitQuadratic(seg.map(x => x.t - t0), ys); if (!q || q.rms > 0.04) continue;   // not a smooth arc
      const a = 2 * q.c;   // m/s², negative = falling
      const moving = Math.abs(q.b) + Math.abs(a) * win * dt > 0.4;
      if (!moving) continue;
      if (a > -REAL_G * 0.3 && a < REAL_G * 0.3 && Math.abs(q.b) > 0.8) out.gravity.push({ t: seg[win >> 1].t, conf: 0.65, info: `${name(id)} travels ${Math.abs(q.b).toFixed(1)} m/s in a straight line in the air with no gravity (real: ${REAL_G} m/s² down)`, ids: [id] });
      else if (a > REAL_G * 0.3) out.gravity.push({ t: seg[win >> 1].t, conf: 0.7, info: `${name(id)} speeds up upwards (${a.toFixed(1)} m/s²) with nothing pushing it`, ids: [id] });
      else if (a < -REAL_G * 2.5 || (a < 0 && a > -REAL_G * 0.45 && a <= -REAL_G * 0.3)) out.gravity.push({ t: seg[win >> 1].t, conf: 0.6, info: `${name(id)} falls at ${(-a).toFixed(1)} m/s² (real gravity is ${REAL_G} m/s²)${-a < REAL_G ? ': it floats' : ': it plunges'}`, ids: [id] });
    }
    // dead stop and jitter
    for (let i = 2; i < s.length - 2; i++) {
      const sp = j => Math.hypot(...s[j].b.pos.map((v, k) => v - s[j - 1].b.pos[k])) / dt;
      const before = (sp(i - 1) + sp(i)) / 2, after = (sp(i + 1) + sp(i + 2)) / 2, touching = bottom(s[i]) - g0(s[i]) < 0.08 + before * dt * 1.5 || s[i].b.grounded;
      if (before > 3 && after < before * 0.1 && !touching && !(s[i].b.stops)) out.deadstop.push({ t: s[i].t, conf: 0.55, info: `${name(id)} stops from ${before.toFixed(1)} m/s to a standstill in the air with no contact`, ids: [id] });
    }
    const w2 = Math.max(6, Math.round(fps * 0.4));
    for (let k = 0; k + w2 <= s.length; k += 2) {
      const seg = s.slice(k, k + w2); let flips = 0, amp = 0;
      for (const axis of [0, 2]) { let prev = 0; for (let j = 1; j < seg.length; j++) { const d = seg[j].b.pos[axis] - seg[j - 1].b.pos[axis]; if (Math.abs(d) < 0.002) continue; if (prev && d * prev < 0) { flips++; amp = Math.max(amp, Math.abs(d)); } prev = d; } }
      // up-and-down reversals next to the ground are a ball coming to rest (smaller and smaller bounces), not jitter
      const nearGround = seg.some(x => bottom(x) - g0(x) < 0.12);
      let pv = 0, flipsY = 0; if (!nearGround) for (let j = 1; j < seg.length; j++) { const d = seg[j].b.pos[1] - seg[j - 1].b.pos[1]; if (Math.abs(d) < 0.002) continue; if (pv && d * pv < 0) { flipsY++; amp = Math.max(amp, Math.abs(d)); } pv = d; }
      if (flips + flipsY >= 5 && amp < 0.08) out.jitter.push({ t: seg[w2 >> 1].t, conf: 0.7, info: `${name(id)} jitters (${flips + flipsY} direction reversals in ${(w2 * dt).toFixed(1)} s, each under ${(amp * 100).toFixed(0)} cm)`, ids: [id] });
    }
  }
  return Object.entries(out).flatMap(([kind, hits]) => ranges(kind, hits, dt, r => { const ids = hits.filter(h => h.t >= r.t0 - 1e-6 && h.t <= r.t1 + 1e-6).flatMap(h => h.ids || []); if (ids.length) r.ids = [...new Set(ids)]; }));
}
// y(t) = a + b t + c t²: least squares and the rms of what is left
export function fitQuadratic(ts, ys) {
  const n = ts.length; let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) { const t = ts[i], y = ys[i]; s1 += t; s2 += t * t; s3 += t ** 3; s4 += t ** 4; y0 += y; y1 += t * y; y2 += t * t * y; }
  const M = [[s0, s1, s2, y0], [s1, s2, s3, y1], [s2, s3, s4, y2]];
  for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; if (Math.abs(M[p][i]) < 1e-12) return null; [M[i], M[p]] = [M[p], M[i]];
    for (let r = i + 1; r < 3; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; } }
  const c = M[2][3] / M[2][2], b = (M[1][3] - M[1][2] * c) / M[1][1], a = (M[0][3] - M[0][1] * b - M[0][2] * c) / M[0][0];
  let e = 0; for (let i = 0; i < n; i++) e += (ys[i] - (a + b * ts[i] + c * ts[i] * ts[i])) ** 2;
  return { a, b, c, rms: Math.sqrt(e / n) };
}

// ---------- everything together
// kind -> [title, severity, what to do]
export const REVIEW_KINDS = {
  shake: ['The whole picture shakes', 'warn', 'Remove the camera jitter: smooth the camera path (no per-frame random offsets, or damp them) unless a handheld look is wanted.'],
  snap: ['The picture snaps sideways', 'warn', 'The camera or scene jumps in one frame: ease the move in and out instead of changing the position at once.'],
  wobble: ['A patch wobbles by itself', 'warn', 'An object jiggles back and forth: check for two animations fighting over it, a spring that never settles, or noise added every frame.'],
  morph: ['Shapes or textures swim', 'warn', 'Parts of the picture change shape without moving (a typical sign of generated or unstable content). Make it a stable object: fixed geometry and a texture that moves with it.'],
  lightstep: ['Lighting jumps', 'warn', 'Brightness or colour changes in one frame without a cut: ease the light change over several frames or put it on a cut.'],
  soft: ['The picture goes soft', 'info', 'The image loses sharpness for a moment (a blur or a resolution drop).'],
  fall: ['A fall that looks wrong', 'warn', 'Movement down should speed up (about 9.8 m/s² on a real scale) and end with contact: a bounce, squash or settle, not a dead stop.'],
  teleport: ['Something teleports', 'error', 'An object changes position by a large distance in one frame: animate the move, or hide the jump with a cut.'],
  overlap: ['Objects pass through each other', 'error', 'Two bodies occupy the same space: move one, add a collision, or mark a deliberate contact (parent / allowOverlap).'],
  sunk: ['Sunk into the ground', 'error', 'The object is below the ground surface: place it on the ground (its bottom at ground level) and keep it there.'],
  floating: ['Hovering without support', 'warn', 'The object floats above the ground: put it on the ground, add a support, or mark it flying: true.'],
  gravity: ['Gravity is wrong', 'error', 'Free flight should follow y = y0 + v0 t - 4.9 t² (real gravity 9.81 m/s²); use that, then exaggerate a little for a cartoon feel (hang time at the top, a fast fall), not none.'],
  deadstop: ['Stops dead in the air', 'warn', 'Speed drops to zero in one frame with no contact: slow it down with an ease, or make it hit something.'],
  jitter: ['Jitters', 'warn', 'The position vibrates by a few centimetres: smooth it (one source of motion per object, no random noise per frame).'],
  scalepop: ['Size pops', 'warn', 'The object changes size in one frame: animate the scale, or hide it with a cut.'],
  scenes: ['Scene list problem', 'warn', 'Fix window.VH_SCENES so the scenes follow each other without gaps or overlaps and cover the whole film.'],
  noaudio: ['No sound', 'warn', ''], clip: ['Sound clipping', 'error', ''], quiet: ['Sound level far off', 'warn', ''], sync: ['Sound and picture lengths differ', 'error', ''], silence: ['Silence in the sound', 'info', ''],
};
export function analyzeFrames(frames, { fps, metersPerHeight = null, ground = 0, only = null, cutTimes = [] } = {}) {
  const out = [], want = k => !only || only.includes(k);
  if (frames.length >= 6) {
    const ms = motionSeries(frames);
    if (want('shake') || want('snap')) out.push(...detectShake(frames, ms, { fps }));
    if (want('wobble')) out.push(...detectWobble(frames, { fps }));
    if (want('morph')) out.push(...detectMorph(frames, ms, { fps }));
    if (want('lightstep') || want('soft')) out.push(...detectLight(frames, ms, { fps, cutTimes }));
    if (want('fall') || want('teleport')) out.push(...detectFall(frames, ms, { fps, metersPerHeight }));
  }
  if (frames.some(f => f.bodies && f.bodies.length)) out.push(...detectBodies(frames, { fps, ground }));
  return out.filter(r => want(r.kind)).sort((a, b) => a.t0 - b.t0);
}

// window.VH_SCENES = [{name, t0, t1}]: a gap, an overlap, an empty scene, or scenes that stop short of (or run past) the film
export function sceneIssues(S, D) {
  const out = [], add = (t0, t1, info) => out.push({ kind: 'scenes', shot: '', t0: +t0.toFixed(3), t1: +Math.max(t0, t1).toFixed(3), n: 1, conf: 0.9, infos: [info] });
  if (!Array.isArray(S) || !S.length) return out;
  const L = S.filter(s => s && Number.isFinite(+s.t0) && Number.isFinite(+s.t1)).map(s => ({ name: s.name || '?', t0: +s.t0, t1: +s.t1 })).sort((p, q) => p.t0 - q.t0);
  if (!L.length) return out;
  L.forEach((s, i) => {
    if (s.t1 <= s.t0) add(s.t0, s.t0, `scene "${s.name}" has no length`);
    const nx = L[i + 1];
    if (nx && nx.t0 < s.t1 - 0.01) add(nx.t0, s.t1, `"${s.name}" and "${nx.name}" overlap by ${(s.t1 - nx.t0).toFixed(2)} s`);
    else if (nx && nx.t0 > s.t1 + 0.05) add(s.t1, nx.t0, `no scene between "${s.name}" and "${nx.name}" for ${(nx.t0 - s.t1).toFixed(2)} s`);
  });
  if (L[0].t0 > 0.05) add(0, L[0].t0, `the first scene "${L[0].name}" starts at ${L[0].t0.toFixed(2)} s`);
  const last = L[L.length - 1];
  if (D && last.t1 < D - 0.05) add(last.t1, D, `the scenes end ${(D - last.t1).toFixed(2)} s before the film does`);
  if (D && last.t1 > D + 0.05) add(D, last.t1, `the last scene runs ${(last.t1 - D).toFixed(2)} s past the film's end`);
  return out;
}

// the same finding seen twice (the whole-film pass and a dense burst) becomes one: same kind, touching or within half a second
export function mergeFindings(list, gap = 0.5) {
  const out = [];
  for (const r of [...list].sort((a, b) => a.kind.localeCompare(b.kind) || a.t0 - b.t0)) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === r.kind && r.t0 <= prev.t1 + gap && (!prev.ids || !r.ids || prev.ids.some(i => r.ids.includes(i)))) {
      prev.t1 = Math.max(prev.t1, r.t1); prev.n = (prev.n || 1) + (r.n || 1); prev.conf = Math.max(prev.conf ?? 0, r.conf ?? 0);
      for (const i of r.infos || []) if (!prev.infos.includes(i) && prev.infos.length < 3) prev.infos.push(i);
      if (r.ids) prev.ids = [...new Set([...(prev.ids || []), ...r.ids])];
    } else out.push({ ...r, infos: [...(r.infos || [])] });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}
