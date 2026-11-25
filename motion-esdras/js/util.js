import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (x) => x * x * (3 - 2 * x);
export const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
export const easeInCubic = (x) => x * x * x;
export const easeOutQuint = (x) => 1 - Math.pow(1 - x, 5);
export const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeInOutQuart = (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2);
export const easeInOutQuint = (x) => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2);
export const easeInOutExpo = (x) =>
  x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
export const easeOutBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
// window: 0 before a, ramps up to 1 at a+fi, stays, ramps down from b-fo to b
export const win = (t, a, b, fi = 0.3, fo = 0.3) => Math.min(smooth(prog(t, a, a + fi)), 1 - smooth(prog(t, b - fo, b)));
// damped spring impulse starting at t0
export const spring = (t, t0, freq = 3, damp = 5) => {
  const x = t - t0;
  if (x < 0) return 0;
  return Math.sin(x * freq * Math.PI * 2) * Math.exp(-x * damp);
};
// quick attack / slow decay pulse
export const pulse = (t, t0, attack = 0.06, decay = 0.6) => {
  const x = t - t0;
  if (x < 0) return 0;
  if (x < attack) return smooth(x / attack);
  return Math.exp(-(x - attack) / decay * 2.2);
};

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cubic Hermite through keyframes {t, v:[...]} with Catmull-Rom style tangents in real time (C1 continuous)
export function keyTrack(keys) {
  const n = keys.length;
  const dim = keys[0].v.length;
  const tang = keys.map((k, i) => {
    const p = keys[Math.max(0, i - 1)], q = keys[Math.min(n - 1, i + 1)];
    const dt = q.t - p.t || 1;
    const m = [];
    for (let d = 0; d < dim; d++) m.push((q.v[d] - p.v[d]) / dt);
    // ease endpoints: zero tangent at first/last if flagged
    if ((i === 0 && k.easeIn) || (i === n - 1 && k.easeOut)) m.fill(0);
    if (k.stop) m.fill(0);
    return m;
  });
  return (t) => {
    if (t <= keys[0].t) {
      const out = []; for (let d = 0; d < dim; d++) out.push(keys[0].v[d] + tang[0][d] * (t - keys[0].t)); return out;
    }
    if (t >= keys[n - 1].t) {
      const out = []; for (let d = 0; d < dim; d++) out.push(keys[n - 1].v[d] + tang[n - 1][d] * (t - keys[n - 1].t)); return out;
    }
    let i = 0; while (i < n - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    const h = b.t - a.t, s = (t - a.t) / h;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const out = [];
    for (let d = 0; d < dim; d++) out.push(h00 * a.v[d] + h10 * h * tang[i][d] + h01 * b.v[d] + h11 * h * tang[i + 1][d]);
    return out;
  };
}

export function glowTexture(size = 256, stops = [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(190,225,255,0.85)'], [0.4, 'rgba(70,140,255,0.28)'], [1, 'rgba(20,60,255,0)']]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function roundedRectGeo(w, h, r, seg = 10) {
  const g = new THREE.ShapeGeometry(roundedRectShape(w, h, r), seg);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return g;
}

export function roundedRectOutline(w, h, r, seg = 12) {
  const pts = roundedRectShape(w, h, r).getPoints(seg);
  return new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)));
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.userData.canvas = c; t.userData.ctx = g;
  return t;
}

export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
