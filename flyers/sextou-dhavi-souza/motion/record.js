// Renderiza o motion quadro a quadro e envia para o ffmpeg (H.264, 30 fps)
const {chromium} = require('playwright');
const {spawn} = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const FPS = 30, DUR = 15, OUT = process.argv[2] || 'motion.mp4', ONLY = process.argv[3]; // ONLY="1.2,3.4" -> stills
const server = http.createServer((q, s) => { const f = path.join(__dirname, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.end(d); }); }).listen(0);
(async () => {
  const port = server.address().port;
  const b = await chromium.launch(); const p = await b.newPage({viewport: {width: 1080, height: 1920}});
  await p.goto(`http://127.0.0.1:${port}/motion.html`); await p.evaluate(() => window.ready);
  if (ONLY) {
    for (const t of ONLY.split(',').map(Number)) {
      const d = await p.evaluate(t => window.frame(t), t);
      fs.writeFileSync(`still_${t}.jpg`, Buffer.from(d.split(',')[1], 'base64'));
    }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-profile:v', 'high', '-movflags', '+faststart', OUT]);
    for (let i = 0; i < FPS * DUR; i++) {
      const d = await p.evaluate(t => window.frame(t), i / FPS);
      if (!ff.stdin.write(Buffer.from(d.split(',')[1], 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
  }
  await b.close(); server.close();
})();
