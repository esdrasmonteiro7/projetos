import { chromium } from 'playwright';
const times = process.argv.slice(2).map(Number);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.type(), m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://127.0.0.1:8765/index.html');
await p.waitForFunction('window.ready === true', null, { timeout: 180000 });
const errs = await p.evaluate(() => window.__errors);
if (errs.length) console.log('ERRORS', errs);
for (const t of times) {
  const t0 = Date.now();
  await p.evaluate((t) => window.renderFrame(t, Math.round(t * 60)), t);
  await p.screenshot({ path: `stills/s_${t.toFixed(2)}.jpg`, type: 'jpeg', quality: 88 });
  console.log('t', t, 'ms', Date.now() - t0);
}
await b.close();
