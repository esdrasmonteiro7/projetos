// 2D canvas artwork used as textures (website, dashboards, flyers, cards)
import { rr, rng } from './util.js';

const F = (w, s) => `${w} ${s}px "Inter Display"`;
const BLUE = '#2f6bff', BLUE2 = '#3da9ff', ICE = '#cfe6ff';

function glow(g, x, y, r, col) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}
function grad(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}
function logoMark(g, x, y, s) {
  g.fillStyle = grad(g, x, y, x + s, y + s, [[0, '#6fb6ff'], [1, '#2a52ff']]);
  rr(g, x, y, s, s, s * 0.28); g.fill();
  g.fillStyle = '#fff'; g.font = F(800, s * 0.62); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('E', x + s / 2, y + s * 0.54);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}
function sphereArt(g, x, y, r) {
  glow(g, x, y, r * 1.9, 'rgba(47,107,255,0.45)');
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  gr.addColorStop(0, '#eaf5ff'); gr.addColorStop(0.25, '#7cc0ff'); gr.addColorStop(0.65, '#2f5bff'); gr.addColorStop(1, '#0a1240');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(160,210,255,0.35)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(x, y, r * 1.45, r * 0.38, -0.35, 0, Math.PI * 2); g.stroke();
}
function lines(g, x, y, w, n, gap = 22, col = 'rgba(255,255,255,0.14)') {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) { rr(g, x, y + i * gap, i === n - 1 ? w * 0.6 : w, 9, 4.5); g.fill(); }
}

export function drawSiteDesktop(g, W, H) {
  g.fillStyle = '#040817'; g.fillRect(0, 0, W, H);
  glow(g, W * 0.78, 330, 720, 'rgba(47,107,255,0.40)');
  glow(g, W * 0.05, 1300, 700, 'rgba(61,169,255,0.16)');
  glow(g, W * 0.9, 2000, 600, 'rgba(47,107,255,0.22)');
  // nav
  logoMark(g, 64, 44, 52);
  g.fillStyle = '#fff'; g.font = F(600, 30); g.fillText('Esdras', 130, 80);
  g.fillStyle = 'rgba(255,255,255,0.62)'; g.font = F(500, 22);
  ['Serviços', 'Portfólio', 'Sobre', 'Contato'].forEach((s, i) => g.fillText(s, 640 + i * 130, 78));
  g.fillStyle = BLUE; rr(g, W - 230, 46, 170, 50, 25); g.fill();
  g.fillStyle = '#fff'; g.font = F(600, 21); g.fillText('Orçamento', W - 200, 78);
  // hero
  g.strokeStyle = 'rgba(140,190,255,0.35)'; g.lineWidth = 2; rr(g, 64, 210, 250, 48, 24); g.stroke();
  g.fillStyle = '#9fd0ff'; g.font = F(500, 21); g.fillText('✦  Estúdio digital', 88, 242);
  g.fillStyle = '#fff'; g.font = F(700, 112); g.fillText('Ideias que', 60, 400);
  g.fillStyle = grad(g, 60, 0, 700, 0, [[0, '#d6ecff'], [0.5, '#6fb6ff'], [1, '#2f5bff']]);
  g.fillText('viram resultado.', 60, 520);
  g.fillStyle = 'rgba(210,225,255,0.62)'; g.font = F(400, 27);
  g.fillText('Sites, sistemas e design que fazem a sua', 64, 600);
  g.fillText('marca crescer de verdade.', 64, 640);
  g.fillStyle = grad(g, 64, 0, 330, 0, [[0, '#4a95ff'], [1, '#2a52ff']]); rr(g, 64, 700, 270, 70, 35); g.fill();
  g.fillStyle = '#fff'; g.font = F(600, 24); g.fillText('Começar projeto  →', 96, 744);
  g.strokeStyle = 'rgba(255,255,255,0.3)'; rr(g, 354, 700, 230, 70, 35); g.stroke();
  g.fillStyle = '#fff'; g.fillText('Ver portfólio', 398, 744);
  sphereArt(g, 1010, 470, 170);
  // trust bar
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = F(500, 20);
  g.fillText('MARCAS QUE CONFIAM NO NOSSO TRABALHO', 64, 900);
  for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(255,255,255,0.07)'; rr(g, 64 + i * 235, 930, 205, 70, 16); g.fill(); }
  // services
  g.fillStyle = '#fff'; g.font = F(700, 64); g.fillText('O que fazemos', 60, 1130);
  const sv = [['Sites', '#4a95ff'], ['Sistemas', '#3da9ff'], ['Design', '#6f7bff']];
  sv.forEach(([s, c], i) => {
    const x = 60 + i * 395, y = 1170;
    g.fillStyle = 'rgba(255,255,255,0.045)'; rr(g, x, y, 370, 330, 30); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 2; rr(g, x, y, 370, 330, 30); g.stroke();
    g.fillStyle = grad(g, x + 30, y + 30, x + 110, y + 110, [[0, c], [1, '#1c2f8f']]); rr(g, x + 32, y + 34, 76, 76, 22); g.fill();
    g.fillStyle = '#fff'; g.font = F(600, 36); g.fillText(s, x + 32, y + 175);
    lines(g, x + 32, y + 210, 290, 3);
  });
  // stats
  [['+120', 'projetos entregues'], ['98%', 'clientes satisfeitos'], ['24h', 'tempo de resposta']].forEach(([a, b], i) => {
    const x = 60 + i * 395;
    g.fillStyle = grad(g, x, 0, x + 260, 0, [[0, '#ffffff'], [1, '#7cc0ff']]); g.font = F(700, 96); g.fillText(a, x, 1680);
    g.fillStyle = 'rgba(210,225,255,0.55)'; g.font = F(400, 26); g.fillText(b, x + 4, 1726);
  });
  // gallery
  const r = rng(7);
  for (let i = 0; i < 4; i++) {
    const x = 60 + (i % 2) * 590, y = 1820 + Math.floor(i / 2) * 290;
    g.fillStyle = grad(g, x, y, x + 560, y + 260, [[0, ['#0d2a7a', '#11358f', '#0a1f5c', '#1a2f9e'][i]], [1, '#060c24']]);
    rr(g, x, y, 560, 260, 28); g.fill();
    glow(g, x + 160 + r() * 260, y + 130, 160, 'rgba(90,160,255,0.45)');
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = F(600, 28); g.fillText(['Branding', 'E-commerce', 'Dashboard', 'Landing'][i], x + 30, y + 225);
  }
}

export function drawSiteMobile(g, W, H) {
  g.fillStyle = '#040817'; g.fillRect(0, 0, W, H);
  glow(g, W * 0.8, 520, 620, 'rgba(47,107,255,0.5)');
  glow(g, W * 0.1, 1700, 600, 'rgba(61,169,255,0.2)');
  // status bar
  g.fillStyle = '#fff'; g.font = F(600, 30); g.fillText('9:41', 56, 62);
  g.fillStyle = '#fff'; rr(g, W - 120, 40, 60, 26, 7); g.fill();
  logoMark(g, 44, 120, 64);
  g.fillStyle = '#fff'; g.font = F(600, 36); g.fillText('Esdras', 124, 164);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 3; i++) { rr(g, W - 100, 132 + i * 16, 52, 6, 3); g.fill(); }
  g.strokeStyle = 'rgba(140,190,255,0.4)'; g.lineWidth = 2; rr(g, 44, 260, 300, 58, 29); g.stroke();
  g.fillStyle = '#9fd0ff'; g.font = F(500, 26); g.fillText('✦  Estúdio digital', 70, 298);
  g.fillStyle = '#fff'; g.font = F(700, 104); g.fillText('Ideias', 40, 450); g.fillText('que viram', 40, 555);
  g.fillStyle = grad(g, 40, 0, 600, 0, [[0, '#d6ecff'], [0.5, '#6fb6ff'], [1, '#2f5bff']]); g.fillText('resultado.', 40, 660);
  g.fillStyle = 'rgba(210,225,255,0.65)'; g.font = F(400, 32);
  g.fillText('Sites, sistemas e design que', 44, 740); g.fillText('fazem sua marca crescer.', 44, 784);
  g.fillStyle = grad(g, 44, 0, W - 44, 0, [[0, '#4a95ff'], [1, '#2a52ff']]); rr(g, 44, 840, W - 88, 96, 48); g.fill();
  g.fillStyle = '#fff'; g.font = F(600, 32); g.textAlign = 'center'; g.fillText('Começar projeto  →', W / 2, 900); g.textAlign = 'left';
  sphereArt(g, W / 2, 1180, 170);
  g.fillStyle = '#fff'; g.font = F(700, 64); g.fillText('O que fazemos', 40, 1500);
  ['Sites', 'Sistemas', 'Motion', 'Design'].forEach((s, i) => {
    const y = 1550 + i * 250;
    g.fillStyle = 'rgba(255,255,255,0.05)'; rr(g, 40, y, W - 80, 220, 32); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.1)'; rr(g, 40, y, W - 80, 220, 32); g.stroke();
    g.fillStyle = grad(g, 70, y + 30, 160, y + 120, [[0, ['#4a95ff', '#3da9ff', '#7a8cff', '#2f5bff'][i]], [1, '#1c2f8f']]); rr(g, 72, y + 36, 88, 88, 24); g.fill();
    g.fillStyle = '#fff'; g.font = F(600, 40); g.fillText(s, 190, y + 92);
    lines(g, 190, y + 124, W - 300, 2, 24);
  });
  [['+120', 'projetos'], ['98%', 'satisfação']].forEach(([a, b], i) => {
    const x = 44 + i * 330;
    g.fillStyle = grad(g, x, 0, x + 260, 0, [[0, '#fff'], [1, '#7cc0ff']]); g.font = F(700, 100); g.fillText(a, x, 2650);
    g.fillStyle = 'rgba(210,225,255,0.55)'; g.font = F(400, 30); g.fillText(b, x + 4, 2700);
  });
  g.fillStyle = grad(g, 40, 2780, W - 40, 2960, [[0, '#2a52ff'], [1, '#3da9ff']]); rr(g, 40, 2780, W - 80, 180, 40); g.fill();
  g.fillStyle = '#fff'; g.font = F(700, 52); g.fillText('Vamos conversar?', 80, 2885);
}

export function drawKeyboard(g, W, H) {
  g.fillStyle = '#0a0d16'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#05070c';
  const kw = (W - 80) / 14;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) { rr(g, 40 + c * kw + 3, 30 + r * (kw * 0.95) + 3, kw - 6, kw * 0.95 - 6, 8); g.fill(); }
  g.fillStyle = '#0d111c'; rr(g, W / 2 - 230, H - 330, 460, 290, 22); g.fill();
}

// --- dashboard cards (transparent backgrounds; glass slab sits behind) ---
export function drawMainCard(g, W, H, p, counter) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(200,220,255,0.7)'; g.font = F(500, 30); g.fillText('Faturamento', 56, 84);
  g.fillStyle = '#fff'; g.font = F(700, 92);
  g.fillText('R$ ' + Math.round(counter).toLocaleString('pt-BR'), 52, 186);
  const bx = 600, by = 120;
  g.fillStyle = 'rgba(61,169,255,0.18)'; rr(g, bx, by, 190, 58, 29); g.fill();
  g.fillStyle = '#8fd0ff'; g.font = F(600, 30); g.fillText('↑ ' + Math.round(128 * Math.min(1, p * 1.15)) + '%', bx + 26, by + 40);
  // chart
  const x0 = 56, x1 = W - 56, y0 = H - 70, y1 = 260;
  g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const y = y1 + (y0 - y1) * i / 3; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  const pts = [0.12, 0.2, 0.16, 0.34, 0.3, 0.46, 0.42, 0.6, 0.56, 0.74, 0.7, 0.92];
  const N = pts.length, P = [];
  for (let i = 0; i < N; i++) P.push([x0 + (x1 - x0) * i / (N - 1), y0 - (y0 - y1) * pts[i]]);
  const cut = p * (N - 1);
  const path = [];
  for (let i = 0; i <= Math.floor(cut); i++) path.push(P[i]);
  if (cut < N - 1) { const i = Math.floor(cut), f = cut - i; path.push([P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f]); }
  if (path.length > 1) {
    const fill = g.createLinearGradient(0, y1, 0, y0);
    fill.addColorStop(0, 'rgba(61,140,255,0.45)'); fill.addColorStop(1, 'rgba(61,140,255,0)');
    g.beginPath(); g.moveTo(path[0][0], y0);
    path.forEach(([x, y]) => g.lineTo(x, y));
    g.lineTo(path[path.length - 1][0], y0); g.closePath(); g.fillStyle = fill; g.fill();
    g.beginPath(); path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = '#8fd0ff'; g.lineWidth = 7; g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = 'rgba(100,180,255,0.9)'; g.shadowBlur = 24; g.stroke(); g.shadowBlur = 0;
    const [hx, hy] = path[path.length - 1];
    g.fillStyle = '#fff'; g.beginPath(); g.arc(hx, hy, 12, 0, Math.PI * 2); g.fill();
    glow(g, hx, hy, 50, 'rgba(140,200,255,0.8)');
  }
  g.fillStyle = 'rgba(200,220,255,0.4)'; g.font = F(500, 22);
  ['Jan', 'Mar', 'Mai', 'Jul', 'Set', 'Nov'].forEach((m, i) => g.fillText(m, x0 + (x1 - x0 - 40) * i / 5, H - 26));
}

export function drawBarsCard(g, W, H) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(200,220,255,0.7)'; g.font = F(500, 30); g.fillText('Vendas por mês', 44, 70);
  g.fillStyle = '#fff'; g.font = F(700, 60); g.fillText('2.847', 44, 140);
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.beginPath(); g.moveTo(44, H - 60); g.lineTo(W - 44, H - 60); g.stroke();
}
export function drawDonutCard(g, W, H, v) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(200,220,255,0.7)'; g.font = F(500, 30); g.fillText('Conversão', 40, 64);
  g.fillStyle = '#fff'; g.font = F(700, 84); g.textAlign = 'center'; g.fillText(Math.round(v) + '%', W / 2, H / 2 + 62); g.textAlign = 'left';
}
export function drawListCard(g, W, H) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(200,220,255,0.7)'; g.font = F(500, 30); g.fillText('Atividade', 40, 64);
  const items = [['Novo pedido #1042', 'agora', '#3da9ff'], ['Pagamento aprovado', '2 min', '#5bd6a0'], ['Cliente cadastrado', '5 min', '#7a8cff']];
  items.forEach(([a, b, c], i) => {
    const y = 110 + i * 112;
    g.fillStyle = 'rgba(255,255,255,0.05)'; rr(g, 30, y, W - 60, 92, 22); g.fill();
    g.fillStyle = c; g.beginPath(); g.arc(80, y + 46, 20, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = F(600, 28); g.fillText(a, 120, y + 44);
    g.fillStyle = 'rgba(200,220,255,0.5)'; g.font = F(400, 22); g.fillText(b, 120, y + 74);
  });
}
export function drawPill(g, W, H, a, b) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#5bd6a0'; g.beginPath(); g.arc(56, H / 2, 14, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = F(600, 40); g.fillText(a, 92, H / 2 + 4);
  g.fillStyle = 'rgba(200,220,255,0.6)'; g.font = F(400, 26); g.fillText(b, 92, H / 2 + 40);
}

// --- flyers ---
const WORDS = [
  ['DESIGN', 'que comunica'], ['FLYER', 'para eventos'], ['BRAND', 'identidade visual'], ['PROMO', 'até 50% off'],
  ['LAUNCH', 'novo produto'], ['MOTION', 'em movimento'], ['SOCIAL', 'posts que vendem'], ['EVENTO', 'sábado · 20h'],
  ['STUDIO', 'criativo'], ['FOCO', 'em resultado'], ['NOVO', 'coleção 2027'], ['ARTE', 'sob medida'],
];
export function drawFlyer(g, W, H, i) {
  const r = rng(100 + i * 17);
  const style = i % 4;
  const [w1, w2] = WORDS[i % WORDS.length];
  if (style === 0) {
    g.fillStyle = grad(g, 0, 0, W, H, [[0, '#2f6bff'], [1, '#081a5c']]); g.fillRect(0, 0, W, H);
    glow(g, W * 0.7, H * 0.3, W * 0.8, 'rgba(160,215,255,0.55)');
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(W * 0.7, H * 0.32, 60 + k * 46, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#fff'; g.font = F(800, 132); g.fillText(w1, 40, H - 220);
  } else if (style === 1) {
    g.fillStyle = '#eef4ff'; g.fillRect(0, 0, W, H);
    g.fillStyle = grad(g, 0, 0, W, 0, [[0, '#2f6bff'], [1, '#3da9ff']]);
    g.beginPath(); g.arc(W * 0.5, H * 0.38, W * 0.36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0a1a4a'; g.font = F(800, 128); g.fillText(w1, 40, H - 220);
  } else if (style === 2) {
    g.fillStyle = '#050b22'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(${60 + r() * 60},${120 + r() * 80},255,${0.25 + r() * 0.5})`;
      const s = 40 + r() * 180; rr(g, r() * W - 40, r() * H * 0.6, s, s, s * 0.2); g.fill();
    }
    g.fillStyle = grad(g, 0, 0, W, 0, [[0, '#d6ecff'], [1, '#3a86ff']]); g.font = F(800, 132); g.fillText(w1, 40, H - 220);
  } else {
    g.fillStyle = grad(g, 0, 0, 0, H, [[0, '#0b1d5e'], [1, '#2f6bff']]); g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
    for (let k = 0; k < 12; k++) { g.beginPath(); g.moveTo(0, k * 70); g.lineTo(W, k * 70 + 120); g.stroke(); }
    g.fillStyle = '#fff'; g.font = F(800, 210); g.fillText(String(10 + i), 36, H * 0.48);
    g.font = F(800, 120); g.fillText(w1, 40, H - 220);
  }
  const dark = style === 1;
  g.fillStyle = dark ? 'rgba(10,26,74,0.7)' : 'rgba(255,255,255,0.8)'; g.font = F(400, 44); g.fillText(w2, 44, H - 150);
  g.fillStyle = dark ? 'rgba(10,26,74,0.5)' : 'rgba(255,255,255,0.55)'; g.font = F(600, 24);
  g.fillText('ESDRAS SOLUÇÕES', 44, H - 60);
  g.fillText('2026', W - 110, H - 60);
}
export function drawHeroFlyer(g, W, H) {
  g.fillStyle = '#030a24'; g.fillRect(0, 0, W, H);
  glow(g, W * 0.5, H * 0.36, W * 0.95, 'rgba(47,107,255,0.7)');
  glow(g, W * 0.5, H * 0.36, W * 0.4, 'rgba(180,225,255,0.6)');
  g.strokeStyle = 'rgba(200,230,255,0.5)'; g.lineWidth = 3;
  g.beginPath(); g.arc(W * 0.5, H * 0.36, W * 0.3, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.font = F(800, 300); g.textAlign = 'center'; g.fillText('E', W / 2, H * 0.36 + 105);
  g.font = F(700, 92); g.fillText('ESDRAS', W / 2, H * 0.72);
  g.font = F(500, 40); g.fillStyle = 'rgba(210,230,255,0.85)'; g.fillText('S O L U Ç Õ E S', W / 2, H * 0.72 + 70);
  g.font = F(400, 30); g.fillStyle = 'rgba(210,230,255,0.6)'; g.fillText('sites · sistemas · motion · design', W / 2, H - 70);
  g.textAlign = 'left';
}
export function drawBizCard(g, W, H, i) {
  if (i % 2 === 0) {
    g.fillStyle = grad(g, 0, 0, W, H, [[0, '#0b1b52'], [1, '#040a22']]); g.fillRect(0, 0, W, H);
    glow(g, W * 0.85, H * 0.2, W * 0.6, 'rgba(47,107,255,0.5)');
    logoMark(g, 60, 60, 110);
    g.fillStyle = '#fff'; g.font = F(700, 64); g.fillText('Esdras', 60, H - 120);
    g.fillStyle = 'rgba(200,220,255,0.7)'; g.font = F(400, 32); g.fillText('Soluções em design & tecnologia', 60, H - 66);
  } else {
    g.fillStyle = '#f3f7ff'; g.fillRect(0, 0, W, H);
    g.fillStyle = grad(g, 0, 0, W, 0, [[0, '#2f6bff'], [1, '#3da9ff']]); g.fillRect(0, H - 26, W, 26);
    g.fillStyle = '#0a1a4a'; g.font = F(700, 56); g.fillText('ESDRAS SOLUÇÕES', 60, 130);
    g.fillStyle = 'rgba(10,26,74,0.6)'; g.font = F(400, 32);
    g.fillText('Sites · Sistemas · Design', 60, 186);
    g.fillText('(92) 99509-9642', 60, H - 80);
  }
}
