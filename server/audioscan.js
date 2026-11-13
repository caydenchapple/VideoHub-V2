// The sound half of the auto scan (ui/review/autoscan.js): one ffmpeg pass over the film's audio looks for stretches of silence in
// the middle of the film, clipping, a level that is far too quiet or loud, no sound file at all, and a sound whose length does not
// match the picture. Answers in the same "range" shape as the picture checks so the panel can merge them.
import fs from 'node:fs';
import { run, TOOLS, probe } from './util.js';

const cache = new Map();   // file|size|mtime -> parsed numbers
const range = (kind, t0, t1, info) => ({ kind, shot: '', t0: +t0.toFixed(3), t1: +t1.toFixed(3), n: 1, infos: [info] });

// numbers out of ffmpeg's silencedetect + volumedetect text (stderr)
export function parseFfmpegAudio(text) {
  const silences = []; let start = null;
  for (const l of String(text).split('\n')) {
    let m = l.match(/silence_start:\s*(-?[\d.]+)/); if (m) { start = Math.max(0, +m[1]); continue; }
    m = l.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/); if (m) { silences.push({ t0: +m[1] - +m[2], t1: +m[1] }); start = null; }
  }
  if (start != null) silences.push({ t0: start, t1: null });   // silent until the file ends
  const num = re => { const m = String(text).match(re); return m ? +m[1] : null; };
  return { silences, mean: num(/mean_volume:\s*(-?[\d.]+) dB/), max: num(/max_volume:\s*(-?[\d.]+) dB/), clipped: num(/histogram_0db:\s*(\d+)/) || 0 };
}

// the findings for one film: pure (tested)
export function findings(a, audioDur, filmDur) {
  const out = [], D = audioDur || 0;
  for (const s of a.silences) {
    const t1 = s.t1 == null ? D : s.t1;
    if (t1 - s.t0 >= 1.5 && s.t0 > 0.4 && t1 < D - 0.4) out.push(range('silence', s.t0, t1, `${(t1 - s.t0).toFixed(1)} s without any sound`));
  }
  if (a.clipped >= 5 || (a.max != null && a.max > -0.05 && a.clipped >= 1)) out.push(range('clip', 0, 0, `${a.clipped} samples reach full scale (loudest ${a.max} dB): the sound distorts; lower the loudest levels`));
  if (a.mean != null && a.mean < -32) out.push(range('quiet', 0, 0, `average level ${a.mean} dB: very quiet (speech sits around -18 to -23 dB)`));
  else if (a.mean != null && a.mean > -12) out.push(range('quiet', 0, 0, `average level ${a.mean} dB: very loud (speech sits around -18 to -23 dB)`));
  if (D && filmDur && Math.abs(D - filmDur) > 0.5) out.push(range('sync', Math.min(D, filmDur), Math.max(D, filmDur), `the sound is ${Math.abs(D - filmDur).toFixed(1)} s ${D < filmDur ? 'shorter' : 'longer'} than the picture (${D.toFixed(1)} s vs ${filmDur.toFixed(1)} s)`));
  return out;
}

export async function audioReport(file, filmDur) {
  if (!file || !fs.existsSync(file)) return { ok: true, audio: null, ranges: [range('noaudio', 0, 0, 'the film has no sound file (audio/mix.wav)')] };
  const st = fs.statSync(file), key = `${file}|${st.size}|${Math.round(st.mtimeMs)}`;
  let a = cache.get(key);
  if (!a) {
    const r = await run(TOOLS.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=noise=-45dB:d=1.2,volumedetect', '-f', 'null', '-'], { timeout: 120000 });
    if (!/mean_volume/.test(r.stderr)) return { ok: false, reason: 'ffmpeg could not read the sound: ' + r.stderr.trim().split('\n').pop() };
    a = parseFfmpegAudio(r.stderr); cache.set(key, a); if (cache.size > 40) cache.delete(cache.keys().next().value);
  }
  let aDur = 0; try { aDur = (await probe(file)).dur || 0; } catch { }
  return { ok: true, audio: file, audioDur: aDur, mean: a.mean, max: a.max, ranges: findings(a, aDur, filmDur) };
}
