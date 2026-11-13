import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFfmpegAudio, findings } from './audioscan.js';

const TEXT = `[silencedetect @ 0x1] silence_start: 12.5
[silencedetect @ 0x1] silence_end: 15.1 | silence_duration: 2.6
[silencedetect @ 0x1] silence_start: 30.2
[Parsed_volumedetect_1 @ 0x2] mean_volume: -41.2 dB
[Parsed_volumedetect_1 @ 0x2] max_volume: 0.0 dB
[Parsed_volumedetect_1 @ 0x2] histogram_0db: 42`;
test('parseFfmpegAudio reads silences (also one that runs to the end) and the levels', () => {
  const a = parseFfmpegAudio(TEXT);
  assert.deepEqual(a.silences, [{ t0: 12.5, t1: 15.1 }, { t0: 30.2, t1: null }]);
  assert.equal(a.mean, -41.2); assert.equal(a.max, 0); assert.equal(a.clipped, 42);
});
test('findings: silence in the middle only, clipping, quiet, and a length mismatch', () => {
  const kinds = r => r.map(x => x.kind).sort();
  const f = findings(parseFfmpegAudio(TEXT), 40, 40);
  assert.deepEqual(kinds(f), ['clip', 'quiet', 'silence']);   // the silence from 30.2 s to 40 s is within 0.4 s of the end? no: it ends at 40 -> the film's tail, not flagged
  const long = findings({ silences: [{ t0: 5, t1: 8 }, { t0: 0, t1: 1.9 }, { t0: 38.9, t1: 40 }], mean: -20, max: -3, clipped: 0 }, 40, 40);
  assert.deepEqual(long.map(x => [x.kind, x.t0, x.t1]), [['silence', 5, 8]]);   // the start and the end of a film may be silent
  const sync = findings({ silences: [], mean: -20, max: -3, clipped: 0 }, 38.2, 40);
  assert.equal(sync[0].kind, 'sync'); assert.match(sync[0].infos[0], /1\.8 s shorter/);
  assert.deepEqual(findings({ silences: [], mean: -20, max: -3, clipped: 0 }, 40, 40.2), []);
  assert.equal(findings({ silences: [], mean: -9, max: -1, clipped: 0 }, 40, 40)[0].kind, 'quiet');   // too loud shares the kind
});
