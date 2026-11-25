// Worker that pulls 165-frame segments from a shared queue (atomic mkdir locks) for load balancing
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';

const [id] = process.argv.slice(2).map(Number);
const FPS = 60, TOTAL = 1980, SEG = 165, NSEG = Math.ceil(TOTAL / SEG);
const dir = 'segs2';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
p.setDefaultTimeout(0);
p.on('pageerror', (e) => console.log(`[w${id}] pageerror:`, e.message));
await p.goto('http://127.0.0.1:8765/index.html');
await p.waitForFunction('window.ready === true', null, { timeout: 300000 });
const errs = await p.evaluate(() => window.__errors);
if (errs.length) { console.log(`[w${id}] ERRORS`, errs); process.exit(1); }
for (let k = 0; k < NSEG; k++) {
  try { fs.mkdirSync(`${dir}/lock_${k}`); } catch { continue; }
  const start = k * SEG, end = Math.min(TOTAL, start + SEG);
  const out = `${dir}/seg_${String(k).padStart(2, '0')}.mp4`;
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = start; f < end; f++) {
    await p.evaluate((f) => window.renderFrame(f / 60, f), f);
    const buf = await p.screenshot({ type: 'jpeg', quality: 96 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - start) % 15 === 0) fs.writeFileSync(`${dir}/prog_${id}.txt`, `seg ${k}: ${f - start + 1}/${end - start}\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  fs.writeFileSync(`${dir}/done_${k}.txt`, `${((Date.now() - t0) / 1000).toFixed(0)}s by w${id}\n`);
}
fs.writeFileSync(`${dir}/prog_${id}.txt`, 'worker finished\n');
await b.close();
