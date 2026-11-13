// VideoHub's icon for macOS (a dark tile with a gauge, the same picture as scripts/make-icon.ps1): an SVG drawn by the browser (or qlmanage),
// resized by sips and packed by iconutil, which ship with macOS.
//   node scripts/make-icon.mjs <out.icns>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect x="100" y="100" width="824" height="824" rx="190" fill="#1e222c"/>
<path d="M 275 700 A 237 237 0 0 1 749 700" fill="none" stroke="#ebebf0" stroke-width="64" stroke-linecap="round" transform="rotate(0 512 700)" stroke-dasharray="560 400"/>
<path d="M 628 495 A 237 237 0 0 1 749 700" fill="none" stroke="#e8742c" stroke-width="64" stroke-linecap="round"/>
<line x1="512" y1="700" x2="355" y2="540" stroke="#e8742c" stroke-width="58" stroke-linecap="round"/>
<circle cx="512" cy="700" r="66" fill="#ebebf0"/>
</svg>`;

// the picture with a transparent background: through the browser renders already use (puppeteer-core + Chrome); without one,
// qlmanage draws it on white (square white corners around the tile, but an icon all the same)
async function pictureFromBrowser(big) {
  const { TOOLS } = await import('../server/util.js'); if (!TOOLS.browser) throw new Error('no browser');
  const puppeteer = (await import('puppeteer-core')).default;
  const br = await puppeteer.launch({ executablePath: TOOLS.browser, headless: 'new' });
  try {
    const pg = await br.newPage(); await pg.setViewport({ width: 1024, height: 1024 });
    await pg.setContent(`<style>html,body{margin:0;background:transparent}</style>${SVG}`);
    await pg.screenshot({ path: big, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  } finally { await br.close(); }
}

export async function makeIcns(out) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'videohub-icon-'));
  try {
    const big = path.join(tmp, 'icon.png');
    try { await pictureFromBrowser(big); } catch {
      const svg = path.join(tmp, 'icon.svg'); fs.writeFileSync(svg, SVG);
      execFileSync('qlmanage', ['-t', '-s', '1024', '-o', tmp, svg], { stdio: 'ignore', timeout: 30000 });
      fs.renameSync(svg + '.png', big);
    }
    if (!fs.existsSync(big)) throw new Error('no picture was made');
    const set = path.join(tmp, 'VideoHub.iconset'); fs.mkdirSync(set);
    for (const [n, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]])
      execFileSync('sips', ['-z', String(px), String(px), big, '--out', path.join(set, `icon_${n}.png`)], { stdio: 'ignore' });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync('iconutil', ['-c', 'icns', set, '-o', out], { stdio: 'ignore' });
    return out;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('Usage: node scripts/make-icon.mjs <out.icns>'); process.exit(2); }
  try { console.log(await makeIcns(path.resolve(process.argv[2]))); } catch (e) { console.error(e.message); process.exit(1); }
}
