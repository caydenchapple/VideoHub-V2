// The MCP review: plays a film in a hidden browser and looks for what makes it look wrong. It draws small frames through the film's own
// window.renderOut(t), runs the checks in ui/review/scanlib.js (shaking, snapping, wobbling, swimming textures, lighting jumps, falls that
// look wrong, and - when the film reports its objects with window.VH_BODIES - overlaps, gravity, floating, sinking, teleporting, jitter),
// adds the sound check and the scene list, and takes pictures of the worst moments plus a contact sheet for the agent to LOOK at.
import puppeteer from 'puppeteer-core';
import { TOOLS } from './util.js';
import { audioReport } from './audioscan.js';
import { analyzeFrames, sceneIssues, mergeFindings, REVIEW_KINDS } from '../ui/review/scanlib.js';

let busy = false;
export const reviewBusy = () => busy;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// runs inside the page: draws a moment and reads it back small
function installHelpers() {
  const shown = () => [...document.querySelectorAll('canvas')].filter(c => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(c).display !== 'none'; });
  const W0 = () => Math.max(1, ...shown().map(c => c.getBoundingClientRect().right)), H0 = () => Math.max(1, ...shown().map(c => c.getBoundingClientRect().bottom));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function compose(w, W, H) {
    const h = Math.round(w * H / W), c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true }), k = w / W;
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (const cv of shown()) { const r = cv.getBoundingClientRect(); try { g.drawImage(cv, r.left * k, r.top * k, r.width * k, r.height * k); } catch { } }
    return c;
  }
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096)); return btoa(s); };
  window.__vhr = {
    size: () => ({ W: W0(), H: H0(), scale: window.VH_SCALE || null, hasBodies: typeof window.VH_BODIES === 'function', scenes: window.VH_SCENES || [], config: window.VH_CONFIG || window.__config || null }),
    sample(times, w, W, H) {
      const out = [];
      for (const t of times) {
        window.renderOut(t);
        const c = compose(w, W, H), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data, luma = new Uint8Array(c.width * c.height); let r = 0, gg = 0, b = 0;
        for (let i = 0; i < luma.length; i++) { const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2]; luma[i] = (R * 77 + G * 150 + B * 29) >> 8; r += R; gg += G; b += B; }
        // sharpness: the variance of a Laplacian on a 192 px wide copy
        const s = compose(192, W, H), sd = s.getContext('2d').getImageData(0, 0, s.width, s.height).data, sw = s.width, sh = s.height; let sum = 0, sum2 = 0, n = 0;
        const L = i => (sd[i * 4] * 77 + sd[i * 4 + 1] * 150 + sd[i * 4 + 2] * 29) >> 8;
        for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) { const i = y * sw + x, v = 4 * L(i) - L(i - 1) - L(i + 1) - L(i - sw) - L(i + sw); sum += v; sum2 += v * v; n++; }
        let bodies = null; if (typeof window.VH_BODIES === 'function') { try { bodies = JSON.parse(JSON.stringify(window.VH_BODIES(t))); } catch { bodies = null; } }
        const px = luma.length;
        out.push({ t, w: c.width, h: c.height, l: b64(luma), rgb: [r / px, gg / px, b / px], sharp: n ? sum2 / n - (sum / n) ** 2 : 0, bodies });
      }
      return out;
    },
    shots(times, width, W, H, q) { return times.map(t => { window.renderOut(t); return compose(width, W, H).toDataURL('image/jpeg', q).split(',')[1]; }); },
    // one picture with a grid of moments, each labelled with its time
    sheet(times, cols, tw, W, H, q) {
      const th = Math.round(tw * H / W), rows = Math.ceil(times.length / cols), c = mk(cols * tw, rows * (th + 18)), g = c.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height); g.font = '13px sans-serif'; g.fillStyle = '#ddd';
      times.forEach((t, i) => { window.renderOut(t); const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + 18); g.drawImage(compose(tw, W, H), x, y + 18); g.fillText(`${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`, x + 4, y + 13); });
      return c.toDataURL('image/jpeg', q).split(',')[1];
    },
  };
}

const unb64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
const TC = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

// depth: quick (up to 8 samples a second), standard (15), deep (the film's own frame rate, at most 30)
export async function reviewFilm({ url, info, depth = 'standard', images = true, maxImages = 8, audioFile = null, onProgress = () => { } }) {
  if (busy) throw Object.assign(new Error('Another review is running; wait for it to finish.'), { code: 409 });
  if (!TOOLS.browser) throw Object.assign(new Error('No Chrome, Edge or Brave was found: the review plays the film in a hidden browser.'), { code: 400 });
  busy = true;
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: TOOLS.browser, headless: 'new', protocolTimeout: 0, args: ['--allow-file-access-from-files', '--force-device-scale-factor=1', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: Math.min(1920, info.w), height: Math.min(1920, info.h) } });
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.READY === true && typeof window.renderOut === 'function', { timeout: 120000 });
    await page.evaluate(installHelpers);
    const env = await page.evaluate(() => window.__vhr.size());
    let { fps, dur } = info, W = env.W, H = env.H;
    const c = env.config; if (c) { if (+c.fps) fps = +c.fps; if (+c.duration) dur = +c.duration; if (+(c.outWidth || c.width) && +(c.outHeight || c.height)) { W = +(c.outWidth || c.width); H = +(c.outHeight || c.height); } }
    if (!(W > 0 && H > 0)) { W = info.w; H = info.h; }
    // How many frames can be drawn: time a few first, then pick a rate that fits the time we are willing to spend (a heavy film draws
    // slowly). A rate below the film's own would miss jitter that happens frame to frame (it aliases), so when it is lower, short
    // bursts of consecutive frames are drawn at several places and the jitter checks run on those.
    const native = Math.min(30, fps), lw = Math.round(Math.sqrt(8200 * W / H));
    const draw = async ts => { const out = []; for (let i = 0; i < ts.length; i += 24) { const part = await page.evaluate((x, w, Wd, Hd) => window.__vhr.sample(x, w, Wd, Hd), ts.slice(i, i + 24), lw, W, H); for (const p of part) out.push({ t: p.t, w: p.w, h: p.h, luma: unb64(p.l), rgb: p.rgb, sharp: p.sharp, bodies: p.bodies }); } return out; };
    const t0c = Date.now(); const probe = await draw(Array.from({ length: 6 }, (_, i) => dur * (0.1 + 0.8 * i / 5))); const perFrame = Math.max(1, (Date.now() - t0c) / 6) / 1000;
    const budget = depth === 'quick' ? 45 : depth === 'deep' ? 300 : 110;
    const sfps = Math.max(2, Math.min(depth === 'quick' ? 8 : native, Math.floor(budget / perFrame / Math.max(1, dur))));
    const n = Math.min(2400, Math.max(8, Math.floor(dur * sfps))), times = Array.from({ length: n }, (_, i) => i / sfps);
    const frames = [];
    onProgress(`drawing ${n} frames`);
    for (let i = 0; i < n; i += 24) { frames.push(...await draw(times.slice(i, i + 24))); onProgress(`drawn ${Math.min(n, i + 24)}/${n} frames`); }
    const dense = sfps < native * 0.9, bursts = [];
    if (dense) {
      const count = Math.max(3, Math.min(8, Math.round(dur / 6))), len = Math.max(8, Math.round(native * 0.8));
      for (let j = 0; j < count; j++) { const t0 = Math.max(0, Math.min(dur - len / native - 0.05, dur * (j + 0.5) / count - 0.4)); bursts.push(await draw(Array.from({ length: len }, (_, k) => t0 + k / native))); }
      onProgress(`${bursts.length} bursts at ${native} fps`);
    }
    onProgress('analysing');
    await sleep(0);
    const scale = { metersPerHeight: env.scale?.metersPerHeight || null, ground: env.scale?.ground ?? 0, cutTimes: (env.scenes || []).map(s => +s.t0).filter(Number.isFinite) };
    const found = analyzeFrames(frames, { fps: sfps, ...scale });
    for (const bf of bursts) found.push(...analyzeFrames(bf, { fps: native, ...scale, only: ['shake', 'snap', 'wobble', 'morph', 'jitter', 'lightstep', 'teleport', 'scalepop'] }));
    const extra = [...sceneIssues(env.scenes, dur)];
    if (audioFile !== undefined) { try { const a = await audioReport(audioFile, dur); if (a.ok) extra.push(...a.ranges); } catch { } }
    const all = mergeFindings([...found, ...extra]).map(r => { const k = REVIEW_KINDS[r.kind] || [r.kind, 'warn', '']; return { ...r, title: k[0], severity: k[1], fix: k[2] }; })
      .sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.severity] - { error: 0, warn: 1, info: 2 }[b.severity]) || a.t0 - b.t0);
    const out = { ok: true, findings: all, stats: { frames: n, sampleFps: sfps, dur, fps, w: W, h: H, bodies: env.hasBodies, scale: env.scale, pageErrors: errs.slice(0, 3) }, images: [] };
    if (images) {
      onProgress('taking pictures');
      const pick = [], seen = new Set();
      for (const f of all.filter(f => f.severity !== 'info' && f.kind !== 'noaudio' && f.kind !== 'clip' && f.kind !== 'quiet' && f.kind !== 'sync')) {
        const t = Math.min(dur - 0.01, Math.max(0, (f.t0 + f.t1) / 2)), key = Math.round(t * 2);
        if (seen.has(key)) continue; seen.add(key); pick.push({ t, label: `${f.title} ${TC(f.t0)}${f.t1 > f.t0 ? '–' + TC(f.t1) : ''}` }); if (pick.length >= maxImages) break;
      }
      const shots = pick.length ? await page.evaluate((ts, w, W, H) => window.__vhr.shots(ts, w, W, H, 0.82), pick.map(p => p.t), 480, W, H) : [];
      pick.forEach((p, i) => out.images.push({ ...p, data: shots[i] }));
      const cols = 4, count = 12, sheetTimes = Array.from({ length: count }, (_, i) => Math.min(dur - 0.05, dur * (i + 0.5) / count));
      out.sheet = { data: await page.evaluate((ts, c, tw, W, H) => window.__vhr.sheet(ts, c, tw, W, H, 0.8), sheetTimes, cols, Math.round(Math.min(360, 1400 / cols)), W, H), times: sheetTimes };
    }
    return out;
  } finally { busy = false; try { await browser?.close(); } catch { } }
}

// pictures of chosen moments (hub_frames): evenly spaced in a range, or the given times
export async function filmFrames({ url, info, times, width = 512, quality = 0.85 }) {
  if (busy) throw Object.assign(new Error('Another review is running; wait for it to finish.'), { code: 409 });
  if (!TOOLS.browser) throw Object.assign(new Error('No Chrome, Edge or Brave was found.'), { code: 400 });
  busy = true; let browser;
  try {
    browser = await puppeteer.launch({ executablePath: TOOLS.browser, headless: 'new', protocolTimeout: 0, args: ['--allow-file-access-from-files', '--force-device-scale-factor=1', '--hide-scrollbars'], defaultViewport: { width: Math.min(1920, info.w), height: Math.min(1920, info.h) } });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.READY === true && typeof window.renderOut === 'function', { timeout: 120000 });
    await page.evaluate(installHelpers);
    const env = await page.evaluate(() => window.__vhr.size()), W = env.W > 0 ? env.W : info.w, H = env.H > 0 ? env.H : info.h;
    const data = await page.evaluate((ts, w, W, H, q) => window.__vhr.shots(ts, w, W, H, q), times, width, W, H, quality);
    return times.map((t, i) => ({ t, data: data[i] }));
  } finally { busy = false; try { await browser?.close(); } catch { } }
}
