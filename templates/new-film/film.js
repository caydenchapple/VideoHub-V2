// A new film, written as code. Start here; see docs/PROJECT-CONTRACT.md (VideoHub folder) for the rules.
//
//   window.renderOut(t)  must draw second t of the film synchronously on the fixed-size canvas (#c, 1920x1080)
//   window.READY = true  once every asset is loaded (images, fonts, …)
//   window.VH_SCENES     the film's scenes [{name, t0, t1}] — they show up on VideoHub's timeline
//   window.VH_BODIES(t)  optional but recommended: where the film's objects are (metres, y up) so hub_review can check physics exactly:
//                        gravity, floating, objects passing through each other, sinking, teleporting, jitter (skill/videohub/REALISM.md)
//
// Golden rule: the picture is a pure function of t (no Date.now(), no state carried from frame to frame, no unseeded
// Math.random()). Then the live preview can jump anywhere, frame stepping works, and a partial re-render of one chunk
// matches its neighbours exactly.
(function () {
  'use strict';
  const W = 1920, H = 1080;
  const DUR = 10;                      // keep in step with render.env.DUR (hub_project) and the length of audio/mix.wav
  const cv = document.getElementById('c'), g = cv.getContext('2d');

  const SCENES = [
    { name: 'Opening', t0: 0, t1: 5 },
    { name: 'Ending', t0: 5, t1: DUR },
  ];
  window.VH_SCENES = SCENES;

  // ---- a world with real physics: 1 unit = 1 metre, y up, the picture is WORLD.h metres tall (so 1 m = H / WORLD.h pixels)
  const WORLD = { h: 6, ground: 0 }, PPM = H / WORLD.h, GROUND_Y = H * 0.82, G = 9.81, RADIUS = 0.25, BOUNCE = 0.62;
  window.VH_SCALE = { metersPerHeight: WORLD.h, ground: WORLD.ground };
  // a ball dropped from 3.5 m: free fall y = h - g t²/2, then bounces that lose energy (each one is BOUNCE² of the last height). Closed form, so
  // it is a pure function of t and a jump in the live preview or a re-render of one chunk matches exactly.
  function ballAt(t) {
    const h0 = 3.5; let tt = Math.max(0, t - 0.4);   // it starts falling after 0.4 s
    const fall = Math.sqrt(2 * h0 / G);
    if (tt < fall) return { y: h0 - 0.5 * G * tt * tt, vy: -G * tt, ground: false };
    tt -= fall; let v = G * fall * BOUNCE;
    for (let k = 0; k < 14; k++) { const air = 2 * v / G; if (tt < air) return { y: v * tt - 0.5 * G * tt * tt, vy: v - G * tt, ground: false }; tt -= air; v *= BOUNCE; }
    return { y: 0, vy: 0, ground: true };
  }
  window.VH_BODIES = t => { const b = ballAt(clamp(+t || 0, 0, DUR)); return [{ id: 'ball', pos: [0, b.y + RADIUS, 0], r: RADIUS, grounded: b.ground }]; };
  // the ball and its shadow: squash a little on the frames around each landing (volume kept), shadow smaller and lighter higher up
  function drawBall(t) {
    const b = ballAt(t), x = W * 0.5, near = 1 - clamp(b.y / 0.35), squash = b.vy < 0 || b.ground ? 0 : 0, hit = clamp(near) * clamp(-b.vy / 8);
    const sx = 1 + 0.18 * hit, sy = 1 / sx, cy = GROUND_Y - (b.y + RADIUS * sy) * PPM, rr = RADIUS * PPM;
    g.fillStyle = 'rgba(0,0,0,' + (0.38 - 0.25 * clamp(b.y / 3)) + ')';
    g.beginPath(); g.ellipse(x, GROUND_Y + 10, rr * 1.1 * (1 - 0.35 * clamp(b.y / 3)), rr * 0.28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff7a3d'; g.beginPath(); g.ellipse(x, cy, rr * sx, rr * sy, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(x - rr * 0.3, cy - rr * 0.35, rr * 0.22, rr * 0.16, -0.5, 0, Math.PI * 2); g.fill();
  }

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

  // ---- assets: load everything before READY (example: const img = await loadImage('assets/logo.png'))
  const loadImage = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  function opening(t) {
    g.fillStyle = '#101320'; g.fillRect(0, 0, W, H);
    g.globalAlpha = ease(t / 0.8);
    g.fillStyle = '#f3efe6'; g.font = '800 120px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Your film starts here', W / 2, H * 0.3 - (1 - ease(t / 0.8)) * 40);
    g.globalAlpha = 1;
    g.fillStyle = '#1d2236'; g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    drawBall(t);
  }
  function ending(t) {
    const s = t - 5;
    g.fillStyle = '#ff7a3d'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#101320'; g.font = '700 90px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('The end', W / 2, H / 2 + Math.sin(s * 2) * 10);
  }

  window.renderOut = function (t) {
    t = clamp(+t || 0, 0, DUR);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (t < 5) opening(t); else ending(t);
  };

  (async () => {
    // await loadImage(...), document.fonts.load('700 90px MyFont'), …
    await document.fonts.ready;
    window.renderOut(0);
    window.READY = true;
  })();
})();
