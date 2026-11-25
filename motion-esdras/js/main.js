import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SoftBloomPass } from './bloom.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import opentype from 'three/addons/libs/opentype.module.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as U from './util.js';
import * as C from './content.js';
import { buildOverlay } from './overlay.js';
import { NOISE } from './noise.js';

const { clamp, lerp, prog, smooth, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack, easeOutQuint, pulse, spring, win } = U;
const W = 1080, H = 1920, TAU = Math.PI * 2;
import { HIT, DROP, END } from './timing.js';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('stage').prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040c);
scene.fog = new THREE.FogExp2(0x02040c, 0.016);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 700);

// studio environment (blue + white softboxes) for chrome / glass reflections
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050a1a, side: THREE.BackSide })));
  const box = (w, h, col, k, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  box(40, 5, 0xffffff, 5, [0, 22, 2]);
  box(10, 30, 0x2f6bff, 5, [-24, 2, 6]);
  box(10, 30, 0x3da9ff, 4, [24, 0, -6]);
  box(24, 4, 0xcfe6ff, 4, [0, -8, 24]);
  box(7, 14, 0xffffff, 9, [12, 8, 20]);
  box(6, 6, 0x6fb6ff, 6, [-10, -4, -22]);
  box(3.2, 40, 0xffffff, 12, [0, 0, 26]);
  box(1.2, 40, 0xcfe6ff, 10, [5, 0, 25]);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.025).texture;
}
scene.environmentIntensity = 1.0;
const keyLight = new THREE.DirectionalLight(0xdfeaff, 1.6); keyLight.position.set(4, 6, 8); scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x3d7bff, 2.2); rimLight.position.set(-6, 2, -6); scene.add(rimLight);
scene.add(new THREE.AmbientLight(0x1a2850, 0.6));

// ---------------------------------------------------------------- background dome (follows camera)
const bgU = { uTime: { value: 0 }, uTint: { value: new THREE.Color(0x1d4dff) }, uGlow: { value: 1 } };
const bgDome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
  uniforms: bgU, side: THREE.BackSide, depthWrite: false, depthTest: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec3 vDir; uniform float uTime; uniform vec3 uTint; uniform float uGlow;
    float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
    float n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
    void main(){ vec3 d=normalize(vDir);
      vec3 col = mix(vec3(0.0035,0.007,0.02), vec3(0.008,0.016,0.045), smoothstep(0.7,-0.5,d.y));
      float n = n3(d*2.2+vec3(0.,0.,uTime*0.025))*0.65 + n3(d*4.7-vec3(uTime*0.018))*0.35;
      col += uTint * pow(n,3.2) * 0.075 * uGlow;
      gl_FragColor = vec4(col,1.); }`,
}));
bgDome.frustumCulled = false; bgDome.renderOrder = -10;
scene.add(bgDome);

// ---------------------------------------------------------------- dust particles
const dustU = { uTime: { value: 0 }, uScale: { value: 1 }, uBoost: { value: 0 } };
{
  const N = 9000, r = U.rng(3);
  const pos = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const z = 30 - r() * 300, a = r() * TAU, rad = 0.6 + Math.pow(r(), 0.75) * 20;
    const cx = z < -50 && z > -130 ? 34 * smooth(clamp((-z - 50) / 20)) : (z <= -130 ? 34 - 20 * smooth(clamp((-z - 130) / 30)) : 0);
    pos[i * 3] = cx + Math.cos(a) * rad; pos[i * 3 + 1] = Math.sin(a) * rad * 1.3; pos[i * 3 + 2] = z;
    sz[i] = 0.5 + Math.pow(r(), 4) * 4.5; ph[i] = r() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float size; attribute float phase; uniform float uTime; uniform float uScale; varying float vA;
      void main(){ vec3 p = position + vec3(sin(uTime*0.21+phase)*0.18, cos(uTime*0.17+phase*1.3)*0.18, sin(uTime*0.13+phase*0.7)*0.18);
        vec4 mv = modelViewMatrix*vec4(p,1.);
        gl_PointSize = max(1.2, size * 0.012 * uScale / -mv.z);
        gl_Position = projectionMatrix*mv;
        float tw = 0.55+0.45*sin(uTime*1.9+phase*7.);
        vA = tw * smoothstep(0.25,2.5,-mv.z) * (1.0 - smoothstep(26.,55.,-mv.z)); }`,
    fragmentShader: `varying float vA; uniform float uBoost;
      void main(){ vec2 c=gl_PointCoord-0.5; float d=length(c); float a=smoothstep(0.5,0.0,d); a*=a;
        gl_FragColor = vec4(vec3(0.55,0.75,1.0)*(0.9+uBoost*2.0), a*vA*0.85); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
}

// ---------------------------------------------------------------- helpers
const glowTex = U.glowTexture();
function sprite(scale, color = 0xffffff, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(scale); return s;
}
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
function glowMat(hex, k, opts = {}) { return new THREE.MeshBasicMaterial({ color: hdr(hex, k), transparent: true, depthWrite: false, ...opts }); }
function tubeReveal(mesh, f0, f1) {
  const g = mesh.geometry, per = g.parameters.radialSegments * 6, n = g.parameters.tubularSegments;
  const a = Math.floor(clamp(f0) * n), b = Math.ceil(clamp(f1) * n);
  g.setDrawRange(a * per, Math.max(0, b - a) * per);
}
function polyPath(pts) {
  const p = new THREE.CurvePath();
  for (let i = 0; i < pts.length - 1; i++) p.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  return p;
}
function setOpacity(obj, o) {
  obj.traverse((c) => { if (c.material) { c.material.opacity = o; c.visible = o > 0.002; } });
}

// ---------------------------------------------------------------- stations
const S = {
  A: new THREE.Vector3(0, 0, 0),
  B: new THREE.Vector3(0, 0, -40),
  C: new THREE.Vector3(34, 3, -66),
  D: new THREE.Vector3(34, 3, -112),
  E: new THREE.Vector3(14, 0, -150),
  F: new THREE.Vector3(14, 0, -205),
  H: new THREE.Vector3(14, 0, -250),
};
const G = {};
for (const k in S) { G[k] = new THREE.Group(); G[k].position.copy(S[k]); scene.add(G[k]); }

let font, fontSemi;
async function loadFont(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  return opentype.parse(buf);
}
// glyph -> THREE.Shapes with holes classified by containment (robust for CFF/OTF winding)
function glyphShapes(f, ch, size) {
  const path = f.getPath(ch, 0, 0, size);
  const contours = []; let cur = null;
  for (const c of path.commands) {
    if (c.type === 'M') { cur = new THREE.Path(); cur.moveTo(c.x, -c.y); }
    else if (c.type === 'L') cur.lineTo(c.x, -c.y);
    else if (c.type === 'Q') cur.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === 'C') cur.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    else if (c.type === 'Z' && cur) { cur.closePath(); contours.push(cur); cur = null; }
  }
  if (cur) contours.push(cur);
  const polys = contours.map((p) => p.getPoints(6));
  const inside = (pt, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) ins = !ins; } return ins; };
  const area = (poly) => Math.abs(THREE.ShapeUtils.area(poly));
  const depth = polys.map((p, i) => polys.reduce((n, q, j) => n + (j !== i && inside(p[0], q) ? 1 : 0), 0));
  const shapes = [], map = new Map();
  contours.forEach((c, i) => { if (depth[i] % 2 === 0) { const sh = new THREE.Shape(); sh.curves = c.curves; shapes.push(sh); map.set(i, sh); } });
  contours.forEach((c, i) => {
    if (depth[i] % 2 !== 1) return;
    let best = -1, ba = Infinity;
    polys.forEach((q, j) => { if (depth[j] === depth[i] - 1 && inside(polys[i][0], q) && area(q) < ba) { ba = area(q); best = j; } });
    if (best >= 0) { const h = new THREE.Path(); h.curves = c.curves; map.get(best).holes.push(h); }
  });
  return shapes;
}
const advance = (f, ch, size) => (f.charToGlyph(ch).advanceWidth || 500) * size / f.unitsPerEm;

const chrome = new THREE.MeshPhysicalMaterial({ color: 0xe8f0ff, metalness: 1, roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 2.6, transparent: true });
const chromeSoft = new THREE.MeshPhysicalMaterial({ color: 0xb8d2ff, metalness: 1, roughness: 0.28, clearcoat: 0.4, envMapIntensity: 2.4, transparent: true });

function buildWord(f, text, size, depth, bevel, tracking, mat) {
  const letters = [];
  let x = 0;
  for (const ch of text) {
    const adv = advance(f, ch, size);
    if (ch !== ' ') {
      const shapes = glyphShapes(f, ch, size);
      const geo = new THREE.ExtrudeGeometry(shapes, { depth, curveSegments: 14, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.55, bevelSegments: 5 });
      geo.computeBoundingBox();
      const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
      geo.translate(-cx, -cy, -cz);
      const mesh = new THREE.Mesh(geo, mat.clone());
      letters.push({ ch, mesh, shapes, x0: x, cx, cy, front: depth / 2 + bevel, home: new THREE.Vector3() });
    }
    x += adv + tracking;
  }
  return { letters, width: x - tracking };
}
function trackingFor(f, text, size, target) {
  let w = 0; for (const ch of text) w += advance(f, ch, size);
  return (target - w) / (text.length - 1);
}

// logo: ESDRAS / SOLUÇÕES
function buildLogo() {
  const root = new THREE.Group();
  const l1 = buildWord(font, 'ESDRAS', 1.0, 0.26, 0.035, 0.045, chrome);
  const tr = trackingFor(fontSemi, 'SOLUÇÕES', 0.285, l1.width * 0.985);
  const l2 = buildWord(fontSemi, 'SOLUÇÕES', 0.285, 0.07, 0.012, tr, chromeSoft);
  const y1 = 0.0, y2 = -0.6;
  l1.letters.forEach((L) => { L.home.set(L.x0 - l1.width / 2 + L.cx, y1 + L.cy, 0); L.ox = L.x0 - l1.width / 2; L.oy = y1; });
  l2.letters.forEach((L) => { L.home.set(L.x0 - l2.width / 2 + L.cx, y2 + L.cy, 0); L.ox = L.x0 - l2.width / 2; L.oy = y2; });
  const all = [...l1.letters, ...l2.letters];
  // vertical centering
  let minY = 1e9, maxY = -1e9;
  all.forEach((L) => { const bb = L.mesh.geometry.boundingBox; minY = Math.min(minY, L.home.y + bb.min.y); maxY = Math.max(maxY, L.home.y + bb.max.y); });
  const dy = -(minY + maxY) / 2;
  all.forEach((L) => { L.home.y += dy; L.oy += dy; L.mesh.position.copy(L.home); root.add(L.mesh); });
  return { root, l1: l1.letters, l2: l2.letters, width: l1.width };
}

// ============================================================ A: problem -> solution -> brand
const A = {};
function buildA() {
  const g = G.A;
  A.core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 16), new THREE.MeshBasicMaterial({ color: hdr(0xcfe6ff, 6) }));
  A.coreGlow = sprite(1.6, 0x7fb6ff, 1);
  A.coreHalo = sprite(5.5, 0x2f6bff, 0.35);
  A.coreG = new THREE.Group(); A.coreG.add(A.core, A.coreGlow, A.coreHalo); g.add(A.coreG);
  A.ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 160), glowMat(0x9fd0ff, 3, { side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  A.ring2 = new THREE.Mesh(new THREE.RingGeometry(0.99, 1, 160), glowMat(0x2f6bff, 3, { side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  g.add(A.ring, A.ring2);

  A.logo = buildLogo();
  A.logo.root.scale.setScalar(0.72);
  g.add(A.logo.root);
  // E outline in logo space
  const E = A.logo.l1[0];
  const pts = E.shapes[0].getPoints(4).map((p) => new THREE.Vector3(p.x + E.ox, p.y + E.oy, E.front + 0.01));
  // dedupe + close
  const clean = [];
  pts.forEach((p) => { if (!clean.length || clean[clean.length - 1].distanceTo(p) > 1e-4) clean.push(p); });
  if (clean[0].distanceTo(clean[clean.length - 1]) > 1e-4) clean.push(clean[0].clone());
  // start drawing from the top-left corner region: rotate so start is the point with max(y - x)
  let si = 0; clean.slice(0, -1).forEach((p, i) => { if (p.y - p.x * 0.3 > clean[si].y - clean[si].x * 0.3) si = i; });
  const loop = clean.slice(0, -1); const rot = [...loop.slice(si), ...loop.slice(0, si)]; rot.push(rot[0].clone());
  A.ePath = polyPath(rot);
  A.eTube = new THREE.Mesh(new THREE.TubeGeometry(A.ePath, 700, 0.026, 8, false), glowMat(0xbfe0ff, 5, { blending: THREE.AdditiveBlending }));
  A.eTube2 = new THREE.Mesh(new THREE.TubeGeometry(A.ePath, 700, 0.08, 8, false), glowMat(0x2f6bff, 1.6, { blending: THREE.AdditiveBlending, opacity: 0.5 }));
  A.logo.root.add(A.eTube, A.eTube2);
  // comet flight from core (logo-local) to outline start
  const start = rot[0];
  const corePos = new THREE.Vector3(0, 0, 0); // logo root sits at station origin
  A.flight = new THREE.CubicBezierCurve3(corePos, new THREE.Vector3(0.9, 1.4, 1.6), new THREE.Vector3(start.x - 1.2, start.y + 1.3, 1.2), start.clone());
  A.flightTube = new THREE.Mesh(new THREE.TubeGeometry(A.flight, 300, 0.03, 8, false), glowMat(0xbfe0ff, 4, { blending: THREE.AdditiveBlending }));
  A.logo.root.add(A.flightTube);
  A.head = new THREE.Group(); A.head.add(sprite(1.3, 0xbfe0ff, 1), sprite(4.0, 0x2f6bff, 0.4));
  A.logo.root.add(A.head);
}
function updA(t) {
  const g = G.A; g.visible = t < 9.1;
  if (!g.visible) return;
  // core: breathing, hit pulse, then becomes comet head
  const hp = pulse(t, HIT, 0.05, 0.7);
  const breathe = 1 + 0.06 * Math.sin(t * 2.4);
  const coreOn = t < 4.15 ? smooth(prog(t, 0.35, 1.4)) : 0;
  A.coreG.visible = coreOn > 0;
  A.core.scale.setScalar(breathe * (1 + hp * 0.6));
  A.coreGlow.scale.setScalar(1.6 * breathe * (1 + hp * 1.4)); A.coreGlow.material.opacity = coreOn;
  A.coreHalo.scale.setScalar(5.5 * (1 + hp * 0.5)); A.coreHalo.material.opacity = 0.32 * coreOn + hp * 0.25;
  A.core.material.color.copy(hdr(0xcfe6ff, 6 * coreOn));
  // shock rings on the music hit
  const rp = prog(t, HIT, HIT + 1.5), rp2 = prog(t, HIT + 0.12, HIT + 1.9);
  A.ring.visible = rp > 0 && rp < 1; A.ring.scale.setScalar(0.2 + easeOutQuint(rp) * 5.5); A.ring.material.opacity = (1 - rp) * 0.9;
  A.ring2.visible = rp2 > 0 && rp2 < 1; A.ring2.scale.setScalar(0.2 + easeOutQuint(rp2) * 8); A.ring2.material.opacity = (1 - rp2) * 0.6;

  // comet flight 4.15 -> 5.0
  const fp = easeInOutCubic(prog(t, 4.15, 5.0));
  const flightOn = t > 4.15 && t < 5.6;
  A.flightTube.visible = flightOn;
  if (flightOn) tubeReveal(A.flightTube, Math.max(0, fp - 0.35), fp + 0.002);
  A.flightTube.material.opacity = 1 - smooth(prog(t, 5.0, 5.5));
  // outline draw 5.0 -> 6.45
  const dp = easeInOutCubic(prog(t, 5.0, 6.45));
  A.eTube.visible = A.eTube2.visible = t > 5.0 && t < 7.4;
  tubeReveal(A.eTube, 0, dp); tubeReveal(A.eTube2, 0, dp);
  const outFade = 1 - smooth(prog(t, 6.55, 7.3));
  A.eTube.material.opacity = outFade; A.eTube2.material.opacity = 0.5 * outFade;
  // head
  A.head.visible = t > 4.15 && t < 6.9;
  if (t < 5.0) A.head.position.copy(A.flight.getPointAt(fp)); else A.head.position.copy(A.ePath.getPointAt(Math.min(dp, 1)));
  A.head.children[0].material.opacity = 1 - smooth(prog(t, 6.4, 6.9));
  A.head.children[1].material.opacity = 0.4 * (1 - smooth(prog(t, 6.4, 6.9)));

  // letters
  const L1 = A.logo.l1, L2 = A.logo.l2;
  const scatter = easeInCubic(prog(t, 8.38, 8.9));
  L1.forEach((L, i) => {
    let o, off = new THREE.Vector3(), ry = 0, s = 1;
    if (i === 0) {
      o = smooth(prog(t, 6.2, 6.85)); s = 0.97 + 0.03 * o;
    } else {
      const p = easeOutCubic(prog(t, 6.75 + i * 0.075, 7.45 + i * 0.075));
      o = smooth(prog(t, 6.75 + i * 0.075, 7.2 + i * 0.075));
      off.set(0.25 * (1 - p), -0.15 * (1 - p), -1.4 * (1 - p)); ry = 0.9 * (1 - p);
    }
    const sx = L.home.x >= 0 ? 1 : -1;
    off.add(new THREE.Vector3(sx * (2.0 + Math.abs(L.home.x)) * scatter * 4, (L.home.y + 0.3) * scatter * 2.5, scatter * 1.6));
    L.mesh.position.copy(L.home).add(off);
    L.mesh.rotation.set(scatter * 0.6 * sx, ry + scatter * sx * 1.2, 0);
    L.mesh.scale.setScalar(s);
    L.mesh.material.opacity = o * (1 - smooth(prog(t, 8.55, 8.85)));
    L.mesh.visible = L.mesh.material.opacity > 0.002;
  });
  L2.forEach((L, i) => {
    const p = easeOutCubic(prog(t, 7.15 + i * 0.045, 7.85 + i * 0.045));
    const sx = L.home.x >= 0 ? 1 : -1;
    L.mesh.position.copy(L.home).add(new THREE.Vector3(sx * scatter * 6, -scatter * 2, scatter * 4 - (1 - p) * 0.6));
    L.mesh.position.y -= (1 - p) * 0.12;
    L.mesh.material.opacity = smooth(prog(t, 7.15 + i * 0.045, 7.6 + i * 0.045)) * (1 - smooth(prog(t, 8.5, 8.8)));
    L.mesh.visible = L.mesh.material.opacity > 0.002;
  });
}

// ============================================================ B: Sites (phone + laptop)
const B = {};
function buildB() {
  const g = G.B;
  const alu = new THREE.MeshPhysicalMaterial({ color: 0x3a4152, metalness: 1, roughness: 0.32, clearcoat: 0.3, envMapIntensity: 1.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.4, metalness: 0.2 });
  // phone
  B.phone = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.02, 2.1, 0.1, 8, 0.14), new THREE.MeshPhysicalMaterial({ color: 0x1b2233, metalness: 1, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.6 }));
  B.phone.add(body);
  const front = new THREE.Mesh(U.roundedRectGeo(0.99, 2.07, 0.13), dark); front.position.z = 0.0505; B.phone.add(front);
  B.mobTex = U.canvasTex(720, 3000, C.drawSiteMobile);
  B.mobTex.wrapT = THREE.ClampToEdgeWrapping; B.mobTex.repeat.set(1, 0.505); B.mobTex.offset.set(0, 1 - 0.505);
  const scr = new THREE.Mesh(U.roundedRectGeo(0.93, 2.0, 0.1), new THREE.MeshBasicMaterial({ map: B.mobTex, color: new THREE.Color(1.15, 1.15, 1.15) }));
  scr.position.z = 0.052; B.phone.add(scr);
  const island = new THREE.Mesh(U.roundedRectGeo(0.26, 0.075, 0.037), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  island.position.set(0, 0.92, 0.054); B.phone.add(island);
  // glass reflection sheen
  const sheen = new THREE.Mesh(U.roundedRectGeo(0.99, 2.07, 0.13), new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.035, envMapIntensity: 2.5, clearcoat: 1 }));
  sheen.position.z = 0.056; B.phone.add(sheen);
  B.phone.position.set(-0.25, -0.2, 1.1);
  g.add(B.phone);
  // laptop
  B.laptop = new THREE.Group();
  const base = new THREE.Mesh(new RoundedBoxGeometry(4.4, 0.12, 3.0, 4, 0.05), alu); base.position.y = 0.06; B.laptop.add(base);
  const kb = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 2.7), new THREE.MeshStandardMaterial({ map: U.canvasTex(1024, 680, C.drawKeyboard), roughness: 0.6 }));
  kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.122, 0.05); B.laptop.add(kb);
  const lid = new THREE.Group(); lid.position.set(0, 0.12, -1.48); B.laptop.add(lid);
  const lidBox = new THREE.Mesh(new RoundedBoxGeometry(4.4, 2.86, 0.07, 4, 0.04), alu); lidBox.position.set(0, 1.43, 0); lid.add(lidBox);
  const bez = new THREE.Mesh(U.roundedRectGeo(4.34, 2.8, 0.06), dark); bez.position.set(0, 1.43, 0.036); lid.add(bez);
  B.deskTex = U.canvasTex(1280, 2400, C.drawSiteDesktop);
  const rep = (1280 * 2.62 / 4.16) / 2400; B.deskRep = rep;
  B.deskTex.repeat.set(1, rep); B.deskTex.offset.set(0, 1 - rep);
  const dscr = new THREE.Mesh(U.roundedRectGeo(4.16, 2.62, 0.03), new THREE.MeshBasicMaterial({ map: B.deskTex, color: new THREE.Color(1.1, 1.1, 1.1) }));
  dscr.position.set(0, 1.46, 0.038); lid.add(dscr);
  lid.rotation.x = -0.22;
  B.laptop.position.set(0.9, -1.55, -1.7);
  B.laptop.rotation.y = -0.5;
  g.add(B.laptop);
  // soft backlight glow
  B.glow = sprite(9, 0x2f6bff, 0.35); B.glow.position.set(0.4, 0.2, -3.5); g.add(B.glow);
}
function updB(t) {
  const g = G.B; g.visible = t > 8.2 && t < 10.9;
  if (!g.visible) return;
  const p = prog(t, 8.3, 10.9);
  B.phone.rotation.set(-0.06 + 0.04 * Math.sin(t), 0.55 - 0.75 * smooth(p), 0.05 - 0.07 * p);
  B.phone.position.y = -0.2 + 0.06 * Math.sin(t * 1.3);
  const sp = easeInOutCubic(prog(t, 8.7, 10.6));
  B.mobTex.offset.y = (1 - 0.505) - sp * 0.3;
  B.deskTex.offset.y = (1 - B.deskRep) - easeInOutCubic(prog(t, 8.6, 10.7)) * 0.38;
  B.laptop.position.y = -1.55 + 0.05 * Math.sin(t * 1.1 + 1);
}

// ============================================================ C: Sistemas (dashboard)
const Cc = {};
function glassCard(w, h, tex, op = 0.55) {
  const grp = new THREE.Group();
  const slab = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.05, 4, 0.024), new THREE.MeshPhysicalMaterial({
    color: 0x0f2150, metalness: 0.1, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: op, envMapIntensity: 1.4,
  }));
  grp.add(slab);
  const edge = new THREE.LineLoop(U.roundedRectOutline(w - 0.01, h - 0.01, 0.024 * 4), new THREE.LineBasicMaterial({ color: hdr(0x8fc4ff, 1.4), transparent: true, opacity: 0.55 }));
  edge.position.z = 0.027; grp.add(edge);
  if (tex) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    face.position.z = 0.03; grp.add(face);
  }
  return grp;
}
function buildC() {
  const g = G.C;
  Cc.mainTex = U.canvasTex(1024, 640, (c, w, h) => C.drawMainCard(c, w, h, 0, 0));
  Cc.main = glassCard(3.2, 2.0, Cc.mainTex); Cc.main.position.set(0, 0.1, 0); Cc.main.rotation.y = 0.18;
  Cc.barsTex = U.canvasTex(640, 512, C.drawBarsCard);
  Cc.bars = glassCard(2.0, 1.6, Cc.barsTex); Cc.bars.position.set(-1.45, -1.75, 0.95); Cc.bars.rotation.y = 0.35;
  Cc.barMeshes = [];
  const bh = [0.35, 0.5, 0.42, 0.65, 0.58, 0.8, 0.95];
  bh.forEach((hh, i) => {
    const hot = i === bh.length - 1;
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.16, 1, 0.16, 2, 0.03), new THREE.MeshStandardMaterial({
      color: hot ? 0x9fd4ff : 0x2f6bff, emissive: hot ? hdr(0x6fb6ff, 1.6) : hdr(0x2f6bff, 0.55), metalness: 0.3, roughness: 0.3,
    }));
    m.geometry.translate(0, 0.5, 0);
    m.position.set(-0.72 + i * 0.24, -0.6, 0.1); m.userData.h = hh * 0.95; Cc.bars.add(m); Cc.barMeshes.push(m);
  });
  Cc.donutTex = U.canvasTex(512, 512, (c, w, h) => C.drawDonutCard(c, w, h, 0));
  Cc.donut = glassCard(1.5, 1.5, Cc.donutTex); Cc.donut.position.set(1.55, 1.65, -0.8); Cc.donut.rotation.y = -0.18;
  const circ = new THREE.EllipseCurve(0, 0, 0.46, 0.46, Math.PI / 2, Math.PI / 2 - TAU, true);
  const cpts = circ.getPoints(200).map((p) => new THREE.Vector3(p.x, p.y - 0.06, 0.07));
  Cc.ringBg = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cpts), 200, 0.045, 10, false), new THREE.MeshStandardMaterial({ color: 0x142a66, transparent: true, opacity: 0.8 }));
  Cc.ringFg = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cpts), 200, 0.06, 12, false), glowMat(0x5aa8ff, 2.2));
  Cc.donut.add(Cc.ringBg, Cc.ringFg);
  Cc.list = glassCard(2.1, 1.6, U.canvasTex(640, 480, C.drawListCard)); Cc.list.position.set(1.45, -1.85, -1.0); Cc.list.rotation.y = -0.22;
  Cc.pill1 = glassCard(1.75, 0.56, U.canvasTex(560, 180, (c, w, h) => C.drawPill(c, w, h, 'Clientes 2.4k', '+18% este mês')), 0.7);
  Cc.pill1.position.set(-1.45, 1.5, 1.5); Cc.pill1.rotation.y = 0.32;
  Cc.pill2 = glassCard(1.55, 0.5, U.canvasTex(500, 160, (c, w, h) => C.drawPill(c, w, h, 'Online', 'tempo real')), 0.7);
  Cc.pill2.position.set(1.25, 0.1, 2.3); Cc.pill2.rotation.y = -0.25;
  Cc.items = [Cc.main, Cc.bars, Cc.donut, Cc.list, Cc.pill1, Cc.pill2];
  Cc.items.forEach((o) => { o.userData.base = o.position.clone(); g.add(o); });
  Cc.glow = sprite(12, 0x2f6bff, 0.3); Cc.glow.position.set(0, 0, -4); g.add(Cc.glow);
}
function updC(t) {
  const g = G.C; g.visible = t > 10.0 && t < 13.1;
  if (!g.visible) return;
  Cc.items.forEach((o, i) => {
    const b = o.userData.base;
    const ap = easeOutCubic(prog(t, 10.2 + i * 0.06, 11.0 + i * 0.06));
    o.position.set(b.x, b.y + 0.06 * Math.sin(t * 1.2 + i * 1.7) - (1 - ap) * 0.4, b.z - (1 - ap) * 1.5);
  });
  const lp = easeInOutCubic(prog(t, 10.6, 12.3));
  C.drawMainCard(Cc.mainTex.userData.ctx, 1024, 640, lp, 48920 * easeOutCubic(prog(t, 10.6, 12.2)));
  Cc.mainTex.needsUpdate = true;
  Cc.barMeshes.forEach((m, i) => { const p = easeOutBack(prog(t, 10.75 + i * 0.07, 11.35 + i * 0.07), 1.4); m.scale.y = Math.max(0.001, m.userData.h * p); });
  const dv = easeInOutCubic(prog(t, 10.8, 12.0));
  tubeReveal(Cc.ringFg, 0, dv * 0.87);
  if (Math.abs(dv - (Cc._dv ?? -1)) > 0.004) { C.drawDonutCard(Cc.donutTex.userData.ctx, 512, 512, dv * 87); Cc.donutTex.needsUpdate = true; Cc._dv = dv; }
}

// ============================================================ D: Motion design (fluid blob + ribbons)
const Dd = {}; const blobU = { uTime: { value: 0 }, uAmp: { value: 1 } };
function ribbonGeo(R, A, phase, tilt, width, segs = 700) {
  const pos = [], uv = [], idx = [];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, phase * 0.7, tilt * 0.6));
  const c = (u) => new THREE.Vector3(Math.cos(u * TAU) * R * (1 + 0.1 * Math.sin(u * TAU * 3 + phase)), A * Math.sin(u * TAU * 2 + phase), Math.sin(u * TAU) * R).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs, p = c(u), tg = c(u + 0.0005).sub(p).normalize();
    const n = new THREE.Vector3().crossVectors(tg, up).normalize().applyAxisAngle(tg, Math.sin(u * TAU * 2 + phase) * 1.1);
    pos.push(...p.clone().addScaledVector(n, width / 2).toArray(), ...p.clone().addScaledVector(n, -width / 2).toArray());
    uv.push(u, 0, u, 1);
    if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
function buildD() {
  const g = G.D;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x1f56ff, metalness: 0.35, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04,
    iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 700], envMapIntensity: 1.9,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = blobU.uTime; sh.uniforms.uAmp = blobU.uAmp;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uAmp;
        ${NOISE}
        vec3 displ(vec3 p){ vec3 q = normalize(p);
          float n = snoise(q*1.1 + vec3(uTime*0.32, uTime*0.21, -uTime*0.26));
          float n2 = snoise(q*2.6 - vec3(uTime*0.37, -uTime*0.2, uTime*0.3));
          return p * (1.0 + uAmp*(0.2*n + 0.055*n2)); }`)
      .replace('#include <beginnormal_vertex>', `
        vec3 nn = normalize(normal);
        vec3 tg = normalize(cross(nn, abs(nn.y) < 0.99 ? vec3(0.,1.,0.) : vec3(1.,0.,0.)));
        vec3 bt = cross(nn, tg);
        float e = 0.012;
        vec3 d0 = displ(position); vec3 d1 = displ(position + tg*e); vec3 d2 = displ(position + bt*e);
        vec3 objectNormal = normalize(cross(d1 - d0, d2 - d0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = d0;');
  };
  Dd.blob = new THREE.Mesh(new THREE.SphereGeometry(1.3, 200, 150), mat);
  Dd.blob.position.set(0, -0.35, 0); g.add(Dd.blob);
  Dd.ribU = { uTime: { value: 0 }, uOp: { value: 1 } };
  const rmat = (a, b) => new THREE.ShaderMaterial({
    uniforms: { ...Dd.ribU, uA: { value: hdr(a, 1.0) }, uB: { value: hdr(b, 2.2) } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uOp;
      void main(){ float edge = smoothstep(0.0,0.3,vUv.y)*smoothstep(1.0,0.7,vUv.y);
        float band = pow(0.5+0.5*sin((vUv.x*2.0 - uTime*0.45)*6.2831), 5.0);
        vec3 col = mix(uA, uB, 0.5+0.5*sin(vUv.x*6.2831*2.0 + uTime*0.9)) * (0.45 + 2.2*band);
        gl_FragColor = vec4(col, edge*uOp*(0.25+0.75*band)); }`,
  });
  Dd.ribbons = [
    new THREE.Mesh(ribbonGeo(2.35, 0.55, 0.0, 0.35, 0.16), rmat(0x2f6bff, 0x9fd4ff)),
    new THREE.Mesh(ribbonGeo(2.8, 0.75, 2.1, -0.5, 0.1), rmat(0x3d7bff, 0xcfe6ff)),
    new THREE.Mesh(ribbonGeo(2.1, 0.4, 4.0, 1.1, 0.07), rmat(0x1d3dff, 0x6fb6ff)),
  ];
  Dd.ribbons.forEach((r) => { r.position.copy(Dd.blob.position); g.add(r); });
  Dd.orbs = [];
  const r = U.rng(9);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07 + r() * 0.1, 32, 16), new THREE.MeshPhysicalMaterial({ color: 0xdfe9ff, metalness: 1, roughness: 0.06, envMapIntensity: 2 }));
    m.userData = { R: 1.9 + r() * 1.3, sp: 0.4 + r() * 0.5, ph: r() * TAU, tilt: (r() - 0.5) * 1.4 };
    g.add(m); Dd.orbs.push(m);
  }
  Dd.glow = sprite(9, 0x2f6bff, 0.45); Dd.glow.position.set(0, -0.3, -2.5); g.add(Dd.glow);
}
function updD(t) {
  const g = G.D; g.visible = t > 12.3 && t < 15.6;
  if (!g.visible) return;
  blobU.uTime.value = t * 1.0;
  blobU.uAmp.value = 0.6 + 0.6 * easeOutCubic(prog(t, 12.4, 13.6)) + 0.25 * pulse(t, 13.27, 0.05, 0.5);
  Dd.blob.rotation.set(t * 0.12, t * 0.25, 0);
  const s = 0.75 + 0.25 * easeOutBack(prog(t, 12.5, 13.3), 1.3);
  Dd.blob.scale.setScalar(s);
  Dd.ribU.uTime.value = t;
  Dd.ribU.uOp.value = smooth(prog(t, 12.7, 13.4));
  Dd.ribbons.forEach((r, i) => { r.rotation.set(0, t * (0.3 + i * 0.12) * (i % 2 ? -1 : 1), Math.sin(t * 0.4 + i) * 0.15); });
  Dd.orbs.forEach((m) => {
    const u = m.userData, a = u.ph + t * u.sp;
    m.position.set(Math.cos(a) * u.R, -0.35 + Math.sin(a * 1.3) * 0.5 + Math.sin(a) * u.tilt, Math.sin(a) * u.R);
    m.scale.setScalar(easeOutCubic(prog(t, 12.8, 13.5)));
  });
}

// ============================================================ E: Flyers & design
const Ee = {};
function buildE() {
  const g = G.E; const r = U.rng(21);
  Ee.items = [];
  const paper = (w, h, tex) => {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), [
      new THREE.MeshStandardMaterial({ color: 0xdde6f5, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0xdde6f5, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xdde6f5, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0xdde6f5, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.32 }),
      new THREE.MeshStandardMaterial({ color: 0xe8eef8, roughness: 0.6 }),
    ]);
    grp.add(m); return grp;
  };
  const NF = 16;
  for (let i = 0; i < NF; i++) {
    const biz = i % 3 === 2;
    const tex = biz ? U.canvasTex(1050, 600, (c, w, h) => C.drawBizCard(c, w, h, i)) : U.canvasTex(600, 840, (c, w, h) => C.drawFlyer(c, w, h, i));
    const it = biz ? paper(1.1, 0.63, tex) : paper(1.25, 1.75, tex);
    const th = i * 1.05 + 0.4, R = 2.05 + r() * 0.6 + (biz ? -0.3 : 0);
    it.userData = { th, R, z: 4.5 - i * 1.15, spin: (r() - 0.5) * 0.6, ph: r() * TAU, tilt: (r() - 0.5) * 0.5 };
    g.add(it); Ee.items.push(it);
  }
  Ee.hero = paper(2.0, 2.8, U.canvasTex(800, 1120, C.drawHeroFlyer));
  Ee.hero.position.set(0, 0, -16.5); g.add(Ee.hero);
  Ee.heroGlow = sprite(9, 0x2f6bff, 0.55); Ee.heroGlow.position.set(0, 0, -18); g.add(Ee.heroGlow);
}
function updE(t) {
  const g = G.E; g.visible = t > 14.9 && t < 19.2;
  if (!g.visible) return;
  Ee.items.forEach((it) => {
    const u = it.userData;
    const th = u.th + t * 0.18;
    const x = Math.cos(th) * u.R, y = Math.sin(th) * u.R * 1.2;
    it.position.set(x, y + 0.08 * Math.sin(t * 1.4 + u.ph), u.z);
    it.lookAt(x * 0.2, y * 0.2, u.z + 6);
    it.rotateZ(u.tilt + Math.sin(t * 0.6 + u.ph) * 0.08);
    it.rotateY(u.spin * Math.sin(t * 0.5 + u.ph));
  });
  const hp = easeOutCubic(prog(t, 16.4, 18.0));
  const away = easeInCubic(prog(t, 18.05, 18.6));
  Ee.hero.rotation.set(-0.5 * away, -0.35 * (1 - hp) + 0.05 * Math.sin(t) + 1.3 * away, 0.05 * (1 - hp) - 0.4 * away);
  Ee.hero.position.set(4.5 * away, 0.05 * Math.sin(t * 1.2) + 1.8 * away, -16.5 + 2 * away);
  Ee.heroGlow.material.opacity = 0.55 * (1 - smooth(prog(t, 18.0, 18.35)));
}

// ============================================================ F/G: purpose ring + signature
const Ff = {};
function buildF() {
  const g = G.F;
  const circ = new THREE.EllipseCurve(0, 0, 1.0, 1.0, Math.PI / 2, Math.PI / 2 + TAU, false);
  const pts = circ.getPoints(400).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts);
  Ff.ring = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.006, 8, false), glowMat(0xcfe6ff, 5, { blending: THREE.AdditiveBlending }));
  Ff.ringW = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 0.02, 8, false), glowMat(0x2f6bff, 2, { blending: THREE.AdditiveBlending, opacity: 0.6 }));
  Ff.ringG = new THREE.Group(); Ff.ringG.add(Ff.ring, Ff.ringW); Ff.ringG.position.set(0, 0.2, -1.2); g.add(Ff.ringG);
  Ff.head = sprite(0.8, 0xcfe6ff, 1); Ff.ringG.add(Ff.head);
  Ff.halo = sprite(14, 0x1d4dff, 0.0); Ff.halo.position.set(0, 0.2, -4); g.add(Ff.halo);
  // signature object (wireframe -> solid -> check)
  Ff.obj = new THREE.Group(); Ff.obj.position.set(0, 0.85, 0.6); g.add(Ff.obj);
  const ico = new THREE.IcosahedronGeometry(0.62, 1);
  const edges = new THREE.EdgesGeometry(ico);
  const ep = edges.attributes.position;
  Ff.wire = new THREE.Group(); Ff.obj.add(Ff.wire);
  const wmat = glowMat(0x7fb6ff, 2.6);
  for (let i = 0; i < ep.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(ep, i), b = new THREE.Vector3().fromBufferAttribute(ep, i + 1);
    const len = a.distanceTo(b);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 6, 1), wmat.clone());
    cyl.position.copy(a).add(b).multiplyScalar(0.5);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    cyl.userData.k = (Math.atan2(cyl.position.x, cyl.position.z) / TAU + 0.5 + (cyl.position.y + 0.7) * 0.3) % 1;
    Ff.wire.add(cyl);
  }
  Ff.solid = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), new THREE.MeshPhysicalMaterial({ color: 0xa9ccff, metalness: 1, roughness: 0.08, flatShading: true, clearcoat: 1, envMapIntensity: 2.2, transparent: true }));
  Ff.obj.add(Ff.solid);
  const ck = [new THREE.Vector3(-0.42, 0.02, 0), new THREE.Vector3(-0.12, -0.3, 0), new THREE.Vector3(0.48, 0.36, 0)];
  Ff.check = new THREE.Mesh(new THREE.TubeGeometry(polyPath(ck), 200, 0.05, 12, false), glowMat(0xcfe6ff, 4.5));
  Ff.checkW = new THREE.Mesh(new THREE.TubeGeometry(polyPath(ck), 200, 0.11, 12, false), glowMat(0x2f6bff, 1.8, { blending: THREE.AdditiveBlending, opacity: 0.5 }));
  Ff.checkG = new THREE.Group(); Ff.checkG.add(Ff.check, Ff.checkW); Ff.obj.add(Ff.checkG);
  Ff.objGlow = sprite(4, 0x2f6bff, 0.0); Ff.obj.add(Ff.objGlow);
}
function updF(t) {
  const g = G.F; g.visible = t > 18.0 && t < 25.6;
  if (!g.visible) return;
  // ring draws around the message
  const rp = easeInOutCubic(prog(t, 20.75, 22.0));
  Ff.ringG.visible = rp > 0;
  tubeReveal(Ff.ring, 0, rp); tubeReveal(Ff.ringW, 0, rp);
  const ringScale = 1.95 + 0.05 * Math.sin(t * 0.8);
  Ff.ringG.scale.setScalar(ringScale);
  const dim = 1 - 0.65 * smooth(prog(t, 22.3, 22.9)) + 0.6 * pulse(t, 24.34, 0.05, 0.5);
  Ff.ring.material.opacity = dim * (1 - smooth(prog(t, 24.9, 25.3)));
  Ff.ringW.material.opacity = 0.6 * dim * (1 - smooth(prog(t, 24.9, 25.3)));
  Ff.head.visible = rp > 0 && rp < 1;
  Ff.head.position.copy(new THREE.Vector3(-Math.sin(rp * TAU), Math.cos(rp * TAU), 0));
  Ff.halo.material.opacity = 0.35 * smooth(prog(t, 18.2, 20.2)) * (1 - 0.5 * smooth(prog(t, 22.3, 23)));
  Ff.ringG.rotation.z = 0;
  // signature object
  const wOn = smooth(prog(t, 22.55, 23.2));
  Ff.obj.rotation.set(0.35 + t * 0.25, t * 0.55, 0);
  Ff.wire.children.forEach((c) => {
    const k = c.userData.k, p = smooth(prog(t, 22.55 + k * 0.45, 22.75 + k * 0.45));
    c.scale.set(1, Math.max(0.001, p), 1);
    c.material.opacity = p * (1 - 0.8 * smooth(prog(t, 23.5, 23.9))) * (1 - smooth(prog(t, 24.3, 24.5)));
    c.visible = c.material.opacity > 0.003;
  });
  const sp = easeOutBack(prog(t, 23.5, 23.95), 1.6);
  Ff.solid.visible = t > 23.5 && t < 24.6;
  Ff.solid.scale.setScalar(Math.max(0.001, sp * (1 - easeInCubic(prog(t, 24.3, 24.55)))));
  Ff.solid.material.opacity = 1;
  // check (counter-rotate so it faces camera)
  const cp = easeOutCubic(prog(t, 24.36, 24.8));
  Ff.checkG.visible = t > 24.36;
  tubeReveal(Ff.check, 0, cp); tubeReveal(Ff.checkW, 0, cp);
  Ff.checkG.quaternion.copy(Ff.obj.quaternion).invert();
  const cs = 1.25 + 0.15 * pulse(t, 24.36, 0.05, 0.4);
  Ff.checkG.scale.setScalar(cs * (1 - smooth(prog(t, 25.0, 25.35))));
  Ff.objGlow.material.opacity = 0.5 * pulse(t, 24.36, 0.05, 0.6) + 0.15 * wOn;
}

// ============================================================ H: CTA
const Hh = {};
function buildH() {
  const g = G.H;
  Hh.rings = new THREE.Group(); Hh.rings.position.set(0, -0.85, -3); g.add(Hh.rings);
  const mk = (R, tube, col, k, op) => {
    const pts = new THREE.EllipseCurve(0, 0, R, R, 0, TAU).getPoints(360).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 360, tube, 8, true), glowMat(col, k, { blending: THREE.AdditiveBlending, opacity: op }));
    Hh.rings.add(m); return m;
  };
  Hh.r1 = mk(1.9, 0.012, 0xcfe6ff, 4, 1);
  Hh.r2 = mk(2.12, 0.007, 0x6fb6ff, 3, 0.7);
  Hh.r3 = mk(2.5, 0.005, 0x2f6bff, 3, 0.6);
  Hh.r1w = mk(1.9, 0.05, 0x2f6bff, 1.5, 0.35);
  // dotted ring
  const dp = []; for (let i = 0; i < 140; i++) { const a = (i / 140) * TAU; dp.push(Math.cos(a) * 2.32, Math.sin(a) * 2.32, 0); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  Hh.dots = new THREE.Points(dg, new THREE.PointsMaterial({ color: hdr(0x9fd4ff, 2), size: 5, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTex }));
  Hh.rings.add(Hh.dots);
  Hh.halo = sprite(16, 0x1d4dff, 0.45); Hh.halo.position.set(0, -0.85, -5); g.add(Hh.halo);
  Hh.logo = buildLogo();
  Hh.logo.root.scale.setScalar(0.5);
  Hh.logo.root.position.set(0, 3.1, 0);
  g.add(Hh.logo.root);
}
function updH(t) {
  const g = G.H; g.visible = t > 24.85;
  if (!g.visible) return;
  const ap = easeOutCubic(prog(t, 25.2, 26.4));
  const dropK = spring(t, DROP, 1.6, 3.2);
  const dp = pulse(t, DROP, 0.04, 0.8);
  Hh.rings.scale.setScalar((0.6 + 0.4 * ap) * (1 + 0.06 * dropK + 0.08 * dp));
  Hh.rings.rotation.set(0.0, 0.0, t * 0.05);
  Hh.r2.rotation.set(Math.sin(t * 0.5) * 0.25, Math.cos(t * 0.4) * 0.25, 0);
  Hh.r3.rotation.set(Math.cos(t * 0.3) * 0.35, Math.sin(t * 0.35) * 0.3, 0);
  Hh.dots.rotation.z = -t * 0.12;
  const on = smooth(prog(t, 25.3, 26.2));
  Hh.r1.material.opacity = on * (0.7 + 0.3 * dp + 0.3 * smooth(prog(t, DROP - 0.2, DROP)));
  Hh.r1w.material.opacity = 0.35 * on + 0.4 * dp;
  Hh.r2.material.opacity = 0.7 * on; Hh.r3.material.opacity = 0.6 * on; Hh.dots.material.opacity = on * (0.6 + 0.4 * dp);
  Hh.halo.material.opacity = 0.3 * on + 0.35 * dp;
  // logo letters assemble
  const all = [...Hh.logo.l1, ...Hh.logo.l2];
  all.forEach((L, i) => {
    const p = easeOutCubic(prog(t, 25.25 + i * 0.035, 26.0 + i * 0.035));
    L.mesh.position.copy(L.home); L.mesh.position.z -= (1 - p) * 1.2; L.mesh.position.y -= (1 - p) * 0.15;
    L.mesh.rotation.y = (1 - p) * 0.8;
    L.mesh.material.opacity = smooth(prog(t, 25.25 + i * 0.035, 25.7 + i * 0.035));
    L.mesh.visible = L.mesh.material.opacity > 0.002;
  });
  Hh.logo.root.rotation.y = Math.sin(t * 0.5) * 0.12;
}

// ---------------------------------------------------------------- cameras
const V3 = (a) => new THREE.Vector3(...a);
function keysCam(origin, keys) {
  const tr = U.keyTrack(keys.map((k) => ({ t: k.t, v: [...k.p, ...k.l, k.r ?? 0, k.f ?? 40] })));
  return (t) => { const v = tr(t); return { p: V3(v.slice(0, 3)).add(origin), l: V3(v.slice(3, 6)).add(origin), roll: v[6], fov: v[7] }; };
}
const cams = {
  A: keysCam(S.A, [
    { t: 0.0, p: [0.3, -0.12, 9.2], l: [0, 0, 0], r: -0.04, f: 38 },
    { t: 2.4, p: [0.12, -0.02, 7.3], l: [0, 0, 0], r: -0.015, f: 38 },
    { t: 4.05, p: [0.0, 0.0, 6.0], l: [0, 0, 0], r: 0, f: 38 },
    { t: 5.3, p: [0.7, 0.35, 8.2], l: [-0.45, 0.1, 0], r: 0.025, f: 40 },
    { t: 6.8, p: [0.7, 0.3, 9.8], l: [0, -0.3, 0], r: 0.01, f: 40 },
    { t: 8.35, p: [-0.8, 0.0, 8.9], l: [0, -0.3, 0], r: -0.02, f: 40 },
    { t: 9.0, p: [-0.9, -0.05, 7.2], l: [0, -0.3, 0], r: -0.03, f: 40 },
  ]),
  B: keysCam(S.B, [
    { t: 8.3, p: [3.6, 1.4, 9.8], l: [0.4, 0.6, 0], r: 0.07, f: 40 },
    { t: 8.95, p: [2.5, 1.05, 7.3], l: [0.2, 0.5, 0], r: 0.025, f: 40 },
    { t: 10.55, p: [-1.0, 0.5, 6.0], l: [-0.1, 0.42, 0], r: -0.02, f: 40 },
    { t: 11.0, p: [-1.8, 0.4, 5.7], l: [-0.2, 0.4, 0], r: -0.03, f: 40 },
  ]),
  C: keysCam(S.C, [
    { t: 10.0, p: [-7.0, 1.9, 9.0], l: [-0.6, 0.95, 0], r: -0.09, f: 42 },
    { t: 10.55, p: [-3.3, 1.2, 8.0], l: [0, 0.9, 0], r: -0.035, f: 42 },
    { t: 12.73, p: [2.0, -0.25, 6.6], l: [0.3, 0.8, 0], r: 0.03, f: 42 },
    { t: 13.2, p: [2.8, -0.5, 5.6], l: [0.4, 0.75, 0], r: 0.04, f: 42 },
  ]),
  D: (t) => {
    const a = lerp(0.35, -0.7, smooth(prog(t, 12.4, 15.5)));
    const R = lerp(11, 7.0, easeOutCubic(prog(t, 12.3, 13.6))) - 6.4 * easeInCubic(prog(t, 15.0, 15.45));
    const y = 0.55 + 0.3 * Math.sin(t * 0.7);
    const p = new THREE.Vector3(Math.sin(a) * R, y, Math.cos(a) * R).add(S.D);
    const l = new THREE.Vector3(0, 0.35 - 0.6 * easeInCubic(prog(t, 15.0, 15.45)), 0).add(S.D);
    return { p, l, roll: -0.65 * (1 - easeOutCubic(prog(t, 12.4, 13.7))), fov: 40 };
  },
  E: (t) => {
    const z = lerp(9.5, -10.8, easeInOutCubic(prog(t, 14.9, 18.4)) * 0.85 + prog(t, 14.9, 18.4) * 0.15);
    const p = new THREE.Vector3(0.35 * Math.sin(t * 0.9), 0.25 * Math.cos(t * 0.7), z).add(S.E);
    const lookFar = new THREE.Vector3(0, 0, z - 7);
    const lookHero = new THREE.Vector3(0, 0.0, -16.5);
    const k = smooth(prog(t, 16.3, 17.6));
    const l = lookFar.lerp(lookHero, k).add(S.E);
    return { p, l, roll: 0.35 * (1 - smooth(prog(t, 15.0, 17.4))), fov: 42 };
  },
  F: keysCam(S.F, [
    { t: 18.0, p: [0, 1.6, 15.5], l: [0, 0.6, 0], r: 0.0, f: 40 },
    { t: 19.0, p: [0, 0.5, 10.4], l: [0, 0.25, 0], r: 0, f: 40 },
    { t: 22.4, p: [0, 0.3, 8.9], l: [0, 0.2, 0], r: 0, f: 40 },
    { t: 25.0, p: [0, 0.35, 7.9], l: [0, 0.3, 0], r: 0, f: 40 },
    { t: 25.4, p: [0, 0.35, 6.0], l: [0, 0.3, -2], r: 0, f: 40 },
  ]),
  H: (t) => {
    const ap = easeOutCubic(prog(t, 24.9, 26.6));
    const back = smooth(prog(t, 26.0, END));
    const p = new THREE.Vector3(0.35 * Math.sin(t * 0.35), 0.3, lerp(19, 10.6, ap) + 1.3 * back - 0.45 * spring(t, DROP, 1.4, 3.5)).add(S.H);
    const l = new THREE.Vector3(0, 0.6, 0).add(S.H);
    return { p, l, roll: 0.01 * Math.sin(t * 0.4), fov: 40 };
  },
};
const transitions = [
  { a: 'A', b: 'B', t0: 8.3, t1: 9.0 },
  { a: 'B', b: 'C', t0: 10.04, t1: 10.62 },
  { a: 'C', b: 'D', t0: 12.28, t1: 12.86 },
  { a: 'D', b: 'E', t0: 15.04, t1: 15.56 },
  { a: 'E', b: 'F', t0: 18.02, t1: 19.08 },
  { a: 'F', b: 'H', t0: 24.92, t1: 25.46 },
];
// C2-smooth (velocity and acceleration start/end at zero) with a softened peak
const easeTrans = (x) => U.smoother(x) * 0.7 + (0.5 - 0.5 * Math.cos(Math.PI * x)) * 0.3;
function camState(t) {
  let st = 'A';
  for (const tr of transitions) {
    if (t >= tr.t0 && t <= tr.t1) {
      const A1 = cams[tr.a](t), B1 = cams[tr.b](t), k = easeTrans(prog(t, tr.t0, tr.t1));
      return { p: A1.p.lerp(B1.p, k), l: A1.l.lerp(B1.l, k), roll: lerp(A1.roll, B1.roll, k), fov: lerp(A1.fov, B1.fov, k) };
    }
    if (t > tr.t1) st = tr.b;
  }
  return cams[st](t);
}
function applyCam(cam, s) {
  cam.position.copy(s.p); cam.up.set(0, 1, 0); cam.lookAt(s.l); cam.rotateZ(s.roll);
  if (cam.fov !== s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
}
// word "punches" on the signature
function fovPunch(t) {
  return -1.6 * pulse(t, 22.63, 0.04, 0.35) - 1.6 * pulse(t, 23.55, 0.04, 0.35) - 2.2 * pulse(t, 24.34, 0.04, 0.4);
}

// ---------------------------------------------------------------- post
const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const accRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
const accQuad = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uW: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D tSrc; uniform float uW; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uW, 1.0); }`,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  depthTest: false, depthWrite: false,
}));
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(1); composer.setSize(W, H);
const srcPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tAcc: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tAcc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tAcc, vUv); }`,
});
srcPass.uniforms.tAcc.value = accRT.texture; // set after construction (render-target textures are not cloneable)
composer.addPass(srcPass);
const blurPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uRad: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uRad; varying vec2 vUv;
    void main(){
      if (length(uDir) < 0.0006 && abs(uRad) < 0.0008) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 acc = vec4(0.); const int N = 18;
      for (int i=0;i<N;i++){ float s = float(i)/float(N-1) - 0.5; vec2 o = uDir*s + (vUv-0.5)*vec2(1.0,1.0)*uRad*s; acc += texture2D(tDiffuse, vUv+o); }
      gl_FragColor = acc/float(N); }`,
});
composer.addPass(blurPass);
const bloom = new SoftBloomPass(W, H, { levels: 7, strength: 0.16, threshold: 0.85, knee: 0.45, radius: 1.0 });
composer.addPass(bloom);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSeed: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 1 }, uCA: { value: 0.006 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSeed, uFlash, uFade, uCA; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uSeed*0.618)*43758.5453); }
    void main(){
      vec2 c = vUv-0.5; vec2 ca = c*vec2(0.5625,1.0); float r2 = dot(ca,ca);
      vec2 off = c*uCA*r2*4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv-off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv+off).b);
      float vig = smoothstep(0.62, 0.12, length(c*vec2(0.85,1.0)));
      col *= mix(0.62, 1.0, vig);
      col += uFlash*vec3(0.45,0.68,1.0)*(0.6+0.4*vig);
      col += (hash(vUv*vec2(1080.,1920.)) - 0.5) * 0.016;
      col *= uFade;
      gl_FragColor = vec4(col,1.); }`,
});
composer.addPass(gradePass);

// ---------------------------------------------------------------- overlay
let OV;

// ---------------------------------------------------------------- frame
const prevCam = new THREE.PerspectiveCamera(40, W / H, 0.05, 700);
const SHUTTER = 0.6 / 60; // 216-degree shutter
function setState(t) {
  updA(t); updB(t); updC(t); updD(t); updE(t); updF(t); updH(t);
  scene.environmentRotation.set(0, -0.9 + 1.8 * smooth(prog(t, 6.6, 8.6)) + (t > 24 ? Math.sin(t * 0.55) * 0.7 : 0), 0);
  const s = camState(t); s.fov += fovPunch(t);
  applyCam(camera, s);
  bgDome.position.copy(camera.position);
  bgU.uTime.value = t;
  dustU.uTime.value = t;
  dustU.uScale.value = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
// screen-space camera motion across the shutter interval
function motion(t) {
  const a = camState(t - SHUTTER / 2); a.fov += fovPunch(t - SHUTTER / 2); applyCam(prevCam, a);
  const b = camState(t + SHUTTER / 2); b.fov += fovPunch(t + SHUTTER / 2); applyCam(camera, b);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const P = camera.position.clone().addScaledVector(fwd, 8);
  const ndc = P.clone().project(prevCam);
  const dir = new THREE.Vector2(ndc.x * 0.5, ndc.y * 0.5);
  const rad = camera.position.clone().sub(prevCam.position).dot(fwd) / 6.0;
  const px = (dir.length() + Math.abs(rad) * 0.35) * H;
  return { dir, rad, px };
}
function subframes(t) {
  const m = motion(t);
  // fast object motion moments also get extra samples
  const objFast = (t > 8.3 && t < 9.0) || (t > 4.15 && t < 5.1) || (t > 22.55 && t < 25.0) || (t > 28.5 && t < 28.9) ? 3 : 1;
  return { m, n: Math.max(objFast, Math.min(10, Math.ceil(m.px / 2.8))) };
}
window.__subframes = (t) => subframes(t).n;
function renderFrame(t, frameIndex = 0) {
  const { m, n } = subframes(t);
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(accRT); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
  for (let i = 0; i < n; i++) {
    const ts = n === 1 ? t : t + ((i + 0.5) / n - 0.5) * SHUTTER;
    setState(ts);
    renderer.setRenderTarget(sceneRT); renderer.setClearColor(0x02040c, 1); renderer.clear(true, true, true);
    renderer.render(scene, camera);
    accQuad.material.uniforms.tSrc.value = sceneRT.texture; accQuad.material.uniforms.uW.value = 1 / n;
    renderer.setRenderTarget(accRT); accQuad.render(renderer);
  }
  renderer.autoClear = prevAuto;
  if (n > 1) setState(t);
  // residual directional blur fills the gaps between sub-frames
  const dir = m.dir.clone().multiplyScalar(1 / n);
  if (dir.length() > 0.05) dir.setLength(0.05);
  const rad = clamp(m.rad / n, -0.08, 0.08);
  blurPass.uniforms.uDir.value.copy(dir.length() > 0.0012 ? dir : dir.set(0, 0));
  blurPass.uniforms.uRad.value = Math.abs(rad) > 0.0015 ? rad : 0;
  dustU.uBoost.value = 0.6 * pulse(t, DROP, 0.04, 0.9) + 0.25 * pulse(t, HIT, 0.04, 0.6);
  bloom.strength = 0.16 * (1 + 0.6 * pulse(t, DROP, 0.04, 0.7) + 0.35 * pulse(t, HIT, 0.04, 0.5));
  const flash = 0.22 * pulse(t, DROP, 0.03, 0.5) + 0.2 * Math.max(0, 1 - Math.abs(t - 15.3) / 0.2) + 0.06 * pulse(t, HIT, 0.03, 0.4) + 0.08 * pulse(t, 24.36, 0.03, 0.3);
  gradePass.uniforms.uFlash.value = flash;
  gradePass.uniforms.uFade.value = smooth(prog(t, 0.0, 0.9)) * (1 - smooth(prog(t, END - 0.7, END)));
  gradePass.uniforms.uSeed.value = frameIndex % 1000;
  composer.render();
  OV.update(t);
  return n;
}

async function init() {
  await Promise.all(['300', '400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 40px "Inter Display"`)));
  font = await loadFont('fonts/InterDisplay-Bold.otf');
  fontSemi = await loadFont('fonts/InterDisplay-SemiBold.otf');
  buildA(); buildB(); buildC(); buildD(); buildE(); buildF(); buildH();
  OV = buildOverlay(document.getElementById('ov'));
  // warm-up compile
  for (const tt of [0.5, 5.5, 7.5, 9.5, 11.5, 14, 17, 21, 23.8, 24.6, 29]) renderFrame(tt);
  window.renderFrame = renderFrame;
  window.__dbg = { bloom, blurPass, gradePass, scene, A, camera, renderer };
  window.ready = true;
  const q = new URLSearchParams(location.search);
  if (q.has('t')) renderFrame(parseFloat(q.get('t')));
}
init().catch((e) => { window.__errors.push(String(e && e.stack || e)); window.ready = true; });
