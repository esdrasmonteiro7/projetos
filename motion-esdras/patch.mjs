// re-render explicit frame ranges (transition patches) with the fixed build
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
const [a, b, name] = process.argv.slice(2);
const start = Number(a), end = Number(b);
const br = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await br.newPage({ viewport: { width: 1080, height: 1920 } });
p.setDefaultTimeout(0);
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://127.0.0.1:8765/index.html');
await p.waitForFunction('window.ready === true', null, { timeout: 300000 });
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', '60', `patches/${name}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
for (let f = start; f < end; f++) {
  await p.evaluate((f) => window.renderFrame(f / 60, f), f);
  const buf = await p.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end(); await new Promise((r) => ff.on('close', r));
fs.writeFileSync(`patches/${name}.done`, `${start} ${end}\n`);
await br.close();
