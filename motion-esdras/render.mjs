import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';

const [start, end, id] = process.argv.slice(2).map(Number);
const FPS = 60;
const out = `segs/seg_${String(id).padStart(2, '0')}.mp4`;
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
p.on('pageerror', (e) => console.log(`[w${id}] pageerror:`, e.message));
await p.goto('http://127.0.0.1:8765/index.html');
await p.waitForFunction('window.ready === true', null, { timeout: 300000 });
const errs = await p.evaluate(() => window.__errors);
if (errs.length) { console.log(`[w${id}] ERRORS`, errs); process.exit(1); }
const t0 = Date.now();
for (let f = start; f < end; f++) {
  await p.evaluate((f) => window.renderFrame(f / 60, f), f);
  const buf = await p.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if ((f - start) % 30 === 0) fs.writeFileSync(`segs/prog_${id}.txt`, `${f - start + 1}/${end - start} ${((Date.now() - t0) / (f - start + 1)).toFixed(0)}ms/f\n`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
fs.writeFileSync(`segs/prog_${id}.txt`, `DONE ${end - start} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
await b.close();
