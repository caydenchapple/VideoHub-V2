import test from 'node:test';
import assert from 'node:assert/strict';
import { bestShift, detectShake, detectWobble, detectMorph, detectLight, detectFall, detectBodies, analyzeFrames, motionSeries, fitQuadratic, REAL_G } from './scanlib.js';

const W = 96, H = 54, FPS = 30;
const rnd = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// a textured picture (smooth noise), shifted by (dx, dy), optionally with a bright square at (sx, sy)
function texture(seed = 1, passes = 2) { const r = rnd(seed); let big = new Float32Array((W + 16) * (H + 16)); for (let i = 0; i < big.length; i++) big[i] = r() * 255;
  for (let p = 0; p < passes; p++) { const t = new Float32Array(big.length); for (let y = 1; y < H + 15; y++) for (let x = 1; x < W + 15; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += big[(y + j) * (W + 16) + x + i]; t[y * (W + 16) + x] = s / 9; } big = t; }
  let mn = 1e9, mx = -1e9; for (const v of big) { mn = Math.min(mn, v); mx = Math.max(mx, v); } for (let i = 0; i < big.length; i++) big[i] = (big[i] - mn) / (mx - mn) * 160 + 40; return big; }
const TEX = texture();
function frame(t, { dx = 0, dy = 0, sq = null, level = 0, noise = 0, seed = 0, bodies } = {}) {
  const luma = new Uint8Array(W * H), r = rnd(seed + 7);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = TEX[(y + 8 + dy) * (W + 16) + x + 8 + dx] + level; if (noise) v += (r() - 0.5) * noise; luma[y * W + x] = Math.max(0, Math.min(255, v)); }
  if (sq) for (let y = Math.round(sq[1]); y < Math.round(sq[1]) + 9; y++) for (let x = Math.round(sq[0]); x < Math.round(sq[0]) + 9; x++) if (x >= 0 && x < W && y >= 0 && y < H) luma[y * W + x] = 250;
  return { t, luma, w: W, h: H, rgb: [level + 100, 100, 100], bodies };
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i, i / FPS));
const kinds = r => r.map(x => x.kind);

test('bestShift finds a whole-picture shift', () => {
  const a = frame(0), b = frame(0, { dx: 2, dy: -1 });
  const s = bestShift(a.luma, b.luma, W, H); assert.equal(s.dx, -2); assert.equal(s.dy, 1);   // the shift that lines b up with a
});
test('a picture that jitters sideways is a shake; a steady pan and a still picture are not', () => {
  const shaky = seq(20, (i, t) => frame(t, { dx: i % 2 ? 1 : -1 }));
  assert.ok(kinds(detectShake(shaky, motionSeries(shaky), { fps: FPS })).includes('shake'));
  const pan = seq(20, (i, t) => frame(t, { dx: Math.min(6, Math.floor(i / 3)) }));
  assert.equal(detectShake(pan, motionSeries(pan), { fps: FPS }).length, 0);
  const still = seq(20, (i, t) => frame(t));
  assert.equal(detectShake(still, motionSeries(still), { fps: FPS }).length, 0);
});
test('one frame that jumps sideways is a snap', () => {
  const f = seq(20, (i, t) => frame(t, { dx: i >= 10 ? 3 : 0 }));
  assert.ok(kinds(detectShake(f, motionSeries(f), { fps: FPS })).includes('snap'));
});
test('a picture that changes shape without moving is morphing; an object that moves is not', () => {
  // a texture that boils: fine detail that is new in every frame, over most of the picture (it is not a movement, so no shift explains it)
  const morph = seq(16, (i, t) => { const fr = frame(t), r = rnd(i * 977 + 11); for (let y = 6; y < 48; y++) for (let x = 6; x < 80; x++) fr.luma[y * W + x] = Math.max(0, Math.min(255, fr.luma[y * W + x] + (r() - 0.5) * 70)); return fr; });
  assert.ok(kinds(detectMorph(morph, motionSeries(morph), { fps: FPS })).includes('morph'));
  const moving = seq(16, (i, t) => frame(t, { dx: i % 5 ? 0 : 1, sq: [10 + i * 3, 20] }));
  assert.equal(detectMorph(moving, motionSeries(moving), { fps: FPS }).length, 0);
});
test('a brightness jump inside a shot is a lighting step', () => {
  const f = seq(16, (i, t) => frame(t, { level: i >= 8 ? 30 : 0 }));   // (a brighter picture, same content)
  assert.ok(kinds(detectLight(f, motionSeries(f), { fps: FPS })).includes('lightstep'));
  assert.equal(detectLight(seq(16, (i, t) => frame(t)), motionSeries(seq(16, (i, t) => frame(t))), { fps: FPS }).length, 0);
});
test('an object falling at a steady speed floats; one that speeds up does not; one that stops dead is flagged', () => {
  const steady = seq(24, (i, t) => frame(t, { sq: [44, 2 + i * 1.5] }));
  assert.ok(kinds(detectFall(steady, motionSeries(steady), { fps: FPS })).includes('fall'));
  const real = seq(24, (i, t) => frame(t, { sq: [44, 2 + 0.5 * 90 * t * t / 1] }));   // accelerating
  assert.ok(!kinds(detectFall(real, motionSeries(real), { fps: FPS })).includes('fall') || detectFall(real, motionSeries(real), { fps: FPS }).every(r => !/even speed/.test(r.infos[0])));
  const stop = seq(24, (i, t) => frame(t, { sq: [44, i < 14 ? 2 + 0.5 * 60 * (i / FPS) ** 2 : 2 + 0.5 * 60 * (13 / FPS) ** 2] }));
  assert.ok(detectFall(stop, motionSeries(stop), { fps: FPS }).some(r => r.kind === 'fall'), 'stop');
});
test('fitQuadratic recovers y = 10 - 4.9 t²', () => {
  const ts = [0, .1, .2, .3, .4, .5], q = fitQuadratic(ts, ts.map(t => 10 - 4.9 * t * t));
  assert.ok(Math.abs(2 * q.c + REAL_G) < 0.01 && q.rms < 1e-9);
});

// ---- bodies the film reports
const body = (id, x, y, z, extra = {}) => ({ id, pos: [x, y, z], size: [1, 1, 1], ...extra });
const bodies = (n, f) => seq(n, (i, t) => ({ t, luma: new Uint8Array(1), w: 1, h: 1, bodies: f(i, t) }));
test('bodies: two bodies passing through each other overlap; touching ones and parent/child do not', () => {
  const f = bodies(30, (i, t) => [body('ball', 0, 0.5, 0, { grounded: true }), body('crate', 0.3, 0.5, 0, { grounded: true })]);
  assert.deepEqual(kinds(detectBodies(f, { fps: FPS })), ['overlap']);
  assert.deepEqual(detectBodies(bodies(30, () => [body('a', 0, 0.5, 0, { grounded: true }), body('b', 1.0, 0.5, 0, { grounded: true })]), { fps: FPS }), []);
  assert.deepEqual(detectBodies(bodies(30, () => [body('hand', 0, 0.5, 0, { grounded: true }), body('cup', 0.2, 0.5, 0, { parent: 'hand', grounded: true })]), { fps: FPS }), []);
});
test('bodies: real gravity passes, slow fall, straight line in the air and an upward push are flagged', () => {
  const arc = a => bodies(30, (i, t) => [body('ball', 0, 8 + 0.5 * a * t * t, 0)]);
  assert.deepEqual(detectBodies(arc(-REAL_G), { fps: FPS }), []);
  assert.deepEqual(detectBodies(arc(-REAL_G * 1.3), { fps: FPS }), []);   // a little exaggeration is fine
  assert.ok(kinds(detectBodies(arc(-2.5), { fps: FPS })).includes('gravity'));
  assert.ok(kinds(detectBodies(bodies(30, (i, t) => [body('ball', 0, 8 - 3 * t, 0)]), { fps: FPS })).includes('gravity'));
  assert.ok(kinds(detectBodies(arc(+4), { fps: FPS })).includes('gravity'));
});
test('bodies: below the ground, hovering, teleporting, size pops and jitter', () => {
  assert.ok(kinds(detectBodies(bodies(20, () => [body('rock', 0, 0.2, 0)]), { fps: FPS })).includes('sunk'));
  assert.ok(kinds(detectBodies(bodies(30, () => [body('rock', 0, 1.5, 0)]), { fps: FPS })).includes('floating'));
  assert.ok(!kinds(detectBodies(bodies(30, () => [body('bird', 0, 1.5, 0, { flying: true })]), { fps: FPS })).includes('floating'));
  assert.ok(kinds(detectBodies(bodies(20, (i) => [body('car', i < 10 ? 0 : 5, 0.5, 0, { grounded: true })]), { fps: FPS })).includes('teleport'));
  assert.ok(kinds(detectBodies(bodies(20, (i) => [{ ...body('pop', 0, 0.5, 0, { grounded: true }), size: i < 10 ? [1, 1, 1] : [1.6, 1.6, 1.6] }]), { fps: FPS })).includes('scalepop'));
  assert.ok(kinds(detectBodies(bodies(30, (i) => [body('lamp', (i % 2 ? 0.02 : -0.02), 0.5, 0, { grounded: true })]), { fps: FPS })).includes('jitter'));
});
test('analyzeFrames combines the picture checks and the bodies', () => {
  const f = seq(20, (i, t) => ({ ...frame(t, { dx: i % 2 ? 1 : -1 }), bodies: [body('a', 0, 0.5, 0, { grounded: true }), body('b', 0.1, 0.5, 0, { grounded: true })] }));
  const k = kinds(analyzeFrames(f, { fps: FPS })); assert.ok(k.includes('shake') && k.includes('overlap'));
});
