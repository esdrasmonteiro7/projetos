// Relatório em PDF: poucas informações, direto e bonito. Página 1 = resumo; 2 = vendedores; 3 = depósito.
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { config } from '../config.js';
import { fmtBRL, fmtCompact, fmtQtd } from '../../shared/money.js';
import { ymLabel, ymMonthName } from '../../shared/dates.js';

const FONTS = path.join(config.root, 'server', 'assets', 'fonts');
const C = {
  ink: '#14231b', ink2: '#4a5a52', muted: '#86948c', line: '#e3e9e5', page: '#f4f7f4', card: '#ffffff',
  g900: '#0b3b27', g700: '#0f5a3a', g600: '#1b7f4f', g100: '#e3f1e9', amber: '#f2b134', violet: '#6250d6', violet100: '#e9e6fa',
  orange: '#eb6834', blue: '#2a78d6', red: '#b3261e',
};
const W = 595.28;
const H = 841.89;
const M = 40;

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (ym) => MES_CURTO[Number(ym.slice(5, 7)) - 1];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function fonts(doc) {
  doc.registerFont('I4', path.join(FONTS, 'inter-400.woff'));
  doc.registerFont('I6', path.join(FONTS, 'inter-600.woff'));
  doc.registerFont('I7', path.join(FONTS, 'inter-700.woff'));
  doc.registerFont('I8', path.join(FONTS, 'inter-800.woff'));
  doc.registerFont('P6', path.join(FONTS, 'poppins-600.woff'));
  doc.registerFont('P7', path.join(FONTS, 'poppins-700.woff'));
}

function fit(doc, text, font, size, maxW, min = 12) {
  let s = size;
  doc.font(font);
  while (s > min) {
    doc.fontSize(s);
    if (doc.widthOfString(text) <= maxW) break;
    s -= 0.5;
  }
  return s;
}

function txt(doc, s, x, y, { font = 'I4', size = 9, color = C.ink, width, align = 'left', spacing = 0 } = {}) {
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(s), x, y, { width, align, characterSpacing: spacing, lineBreak: false });
}

function card(doc, x, y, w, h, r = 14) {
  doc.save();
  doc.fillColor(C.g900).fillOpacity(0.045).roundedRect(x, y + 3, w, h, r).fill();
  doc.fillOpacity(0.03).roundedRect(x, y + 6, w, h, r + 1).fill();
  doc.restore();
  doc.roundedRect(x, y, w, h, r).fillColor(C.card).fill();
  doc.roundedRect(x, y, w, h, r).lineWidth(0.6).strokeColor(C.line).stroke();
}

/** Barra com o topo arredondado (4px) e base reta, como pede o padrão de gráficos. */
function barraTopo(doc, x, y, w, h, r, cor) {
  if (h <= 0) return;
  const rr = Math.min(r, w / 2, h);
  doc.save();
  doc.fillColor(cor);
  doc.moveTo(x, y + h).lineTo(x, y + rr).quadraticCurveTo(x, y, x + rr, y).lineTo(x + w - rr, y).quadraticCurveTo(x + w, y, x + w, y + rr).lineTo(x + w, y + h).closePath().fill();
  doc.restore();
}

function folhas(doc, x, y, escala = 1, opac = 0.07) {
  doc.save();
  doc.translate(x, y);
  const folha = (rot, dx, dy, a, b) => {
    doc.save();
    doc.translate(dx, dy).rotate(rot);
    doc.fillColor('#ffffff').fillOpacity(opac).ellipse(0, 0, a * escala, b * escala).fill();
    doc.lineWidth(1).strokeColor('#ffffff').strokeOpacity(opac * 1.6).moveTo(-a * escala, 0).lineTo(a * escala, 0).stroke();
    doc.restore();
  };
  folha(-38, 0, 0, 92, 30);
  folha(18, -46, 58, 78, 25);
  folha(-72, 62, 52, 64, 21);
  folha(-8, 14, 118, 60, 18);
  doc.restore();
}

function cabecalho(doc, { titulo, subtitulo, mes, escopo, grande = true }) {
  const h = grande ? 150 : 92;
  const grad = doc.linearGradient(0, 0, W, h).stop(0, C.g900).stop(1, C.g600);
  doc.rect(0, 0, W, h).fill(grad);
  folhas(doc, W - 70, grande ? 20 : 10, grande ? 1 : 0.7);
  // marca
  txt(doc, 'Bom Gosto', M, grande ? 34 : 24, { font: 'P7', size: grande ? 30 : 22, color: '#ffffff' });
  txt(doc, 'da Amazônia', M + 1, grande ? 70 : 50, { font: 'P6', size: grande ? 15 : 12, color: C.amber });
  const pill = titulo.toUpperCase();
  doc.font('I7').fontSize(7.5);
  const pw = doc.widthOfString(pill, { characterSpacing: 1.4 }) + 20;
  doc.roundedRect(M, grande ? 106 : 68, pw, 20, 10).fillColor('#ffffff').fillOpacity(0.16).fill().fillOpacity(1);
  txt(doc, pill, M + 10, grande ? 112.5 : 74.5, { font: 'I7', size: 7.5, color: '#ffffff', spacing: 1.4 });
  // mês à direita
  const nomeMes = cap(ymMonthName(mes));
  const ano = mes.slice(0, 4);
  doc.font('P7').fontSize(grande ? 30 : 22);
  const wMes = doc.widthOfString(nomeMes);
  txt(doc, nomeMes, W - M - wMes - 52, grande ? 34 : 24, { font: 'P7', size: grande ? 30 : 22, color: '#ffffff' });
  txt(doc, ano, W - M - 46, grande ? 45 : 31, { font: 'P6', size: grande ? 18 : 13, color: C.amber });
  doc.font('I4').fontSize(9);
  const e = subtitulo || escopo || '';
  const we = doc.widthOfString(e);
  txt(doc, e, W - M - we, grande ? 80 : 54, { size: 9, color: '#d7eadf' });
}

function rodape(doc, { empresa, geradoEm, pagina, total }) {
  doc.moveTo(M, H - 42).lineTo(W - M, H - 42).lineWidth(0.6).strokeColor(C.line).stroke();
  txt(doc, `${empresa} · relatório gerado em ${geradoEm}`, M, H - 32, { size: 8, color: C.muted });
  const t = `${pagina}/${total}`;
  doc.font('I4').fontSize(8);
  txt(doc, t, W - M - doc.widthOfString(t), H - 32, { size: 8, color: C.muted });
}

function fundo(doc) {
  doc.rect(0, 0, W, H).fillColor(C.page).fill();
}

// ---------------------------------------------------------------- cartões de números
function kpi(doc, { x, y, w, h, cor, rotulo, valor, linha1, linha2, linha2Cor }) {
  card(doc, x, y, w, h);
  doc.circle(x + 20, y + 22, 4).fillColor(cor).fill();
  txt(doc, rotulo.toUpperCase(), x + 30, y + 17.5, { font: 'I7', size: 8, color: C.ink2, spacing: 0.9 });
  const s = fit(doc, valor, 'P7', 27, w - 40, 16);
  txt(doc, valor, x + 20, y + 40, { font: 'P7', size: s, color: C.ink });
  if (linha1) txt(doc, linha1, x + 20, y + h - 36, { size: 9, color: C.ink2, width: w - 40 });
  if (linha2) txt(doc, linha2, x + 20, y + h - 21, { font: linha2Cor ? 'I6' : 'I4', size: 9, color: linha2Cor || C.muted, width: w - 40 });
}

function numeroMini(doc, { x, y, w, rotulo, valor, cor }) {
  txt(doc, rotulo.toUpperCase(), x, y, { font: 'I7', size: 7.5, color: C.muted, spacing: 0.9 });
  txt(doc, valor, x, y + 12, { font: 'P6', size: 15, color: cor || C.ink, width: w });
}

// ---------------------------------------------------------------- gráfico de colunas agrupadas (vendido x recebido)
function escalaBonita(max) {
  if (max <= 0) return { topo: 1000_00, passo: 250_00 };
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / mag;
  const base = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  const passo = base * mag;
  return { passo, topo: Math.ceil(max / passo) * passo };
}

function graficoMeses(doc, { x, y, w, h, meses }) {
  card(doc, x, y, w, h);
  txt(doc, 'Vendido e recebido', x + 18, y + 16, { font: 'I7', size: 10, color: C.ink });
  txt(doc, 'últimos 6 meses', x + 18, y + 30, { size: 8, color: C.muted });
  // legenda
  const lx = x + w - 150;
  doc.roundedRect(lx, y + 18, 8, 8, 2).fillColor(C.g600).fill();
  txt(doc, 'Vendido', lx + 13, y + 17.5, { size: 8.5, color: C.ink2 });
  doc.roundedRect(lx + 68, y + 18, 8, 8, 2).fillColor(C.violet).fill();
  txt(doc, 'Recebido', lx + 81, y + 17.5, { size: 8.5, color: C.ink2 });

  const gx = x + 48;
  const gy = y + 52;
  const gw = w - 48 - 16;
  const gh = h - 52 - 34;
  const max = Math.max(...meses.map((m) => Math.max(m.vendido, m.recebido)), 0);
  const { topo, passo } = escalaBonita(max);
  for (let v = 0; v <= topo + 1; v += passo) {
    const yy = gy + gh - (v / topo) * gh;
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).lineWidth(v === 0 ? 0.9 : 0.5).strokeColor(v === 0 ? '#c9d3cd' : C.line).stroke();
    const lab = v === 0 ? '0' : fmtCompact(v).replace('R$ ', '');
    doc.font('I4').fontSize(7.5);
    txt(doc, lab, gx - 8 - doc.widthOfString(lab), yy - 4, { size: 7.5, color: C.muted });
  }
  const slot = gw / meses.length;
  const bw = Math.min(16, slot / 3.2);
  meses.forEach((m, i) => {
    const cx = gx + slot * i + slot / 2;
    const h1 = (m.vendido / topo) * gh;
    const h2 = (m.recebido / topo) * gh;
    barraTopo(doc, cx - bw - 1, gy + gh - h1, bw, h1, 4, C.g600);
    barraTopo(doc, cx + 1, gy + gh - h2, bw, h2, 4, C.violet);
    const lab = mesCurto(m.ym);
    doc.font(i === meses.length - 1 ? 'I7' : 'I4').fontSize(8);
    txt(doc, lab, cx - doc.widthOfString(lab) / 2, gy + gh + 9, { font: i === meses.length - 1 ? 'I7' : 'I4', size: 8, color: i === meses.length - 1 ? C.ink : C.muted });
  });
  // rótulo direto só no último mês (vendido)
  const ult = meses[meses.length - 1];
  if (ult.vendido > 0) {
    const cx = gx + slot * (meses.length - 1) + slot / 2;
    const lab = fmtCompact(ult.vendido);
    doc.font('I7').fontSize(8);
    const lw = doc.widthOfString(lab);
    txt(doc, lab, Math.min(cx - lw / 2 - bw / 2, gx + gw - lw), gy + gh - (ult.vendido / topo) * gh - 13, { font: 'I7', size: 8, color: C.ink });
  }
}

function previsao(doc, { x, y, w, h, itens, proximo }) {
  card(doc, x, y, w, h);
  txt(doc, 'Previsão de recebimento', x + 18, y + 16, { font: 'I7', size: 10, color: C.ink });
  txt(doc, 'o que vence em cada mês', x + 18, y + 30, { size: 8, color: C.muted });
  const max = Math.max(...itens.map((i) => i.total), 1);
  const bx = x + 18;
  const bw = w - 36;
  itens.forEach((it, i) => {
    const yy = y + 58 + i * 44;
    const destaque = it.ym === proximo;
    txt(doc, `${cap(mesCurto(it.ym))}/${it.ym.slice(2, 4)}`, bx, yy, { font: destaque ? 'I7' : 'I4', size: 8.5, color: destaque ? C.ink : C.ink2 });
    const val = it.total > 0 ? fmtBRL(it.total) : '—';
    doc.font(destaque ? 'I7' : 'I4').fontSize(8.5);
    txt(doc, val, bx + bw - doc.widthOfString(val), yy, { font: destaque ? 'I7' : 'I4', size: 8.5, color: destaque ? C.ink : C.ink2 });
    doc.roundedRect(bx, yy + 14, bw, 6, 3).fillColor(C.violet100).fill();
    const f = (it.total / max) * bw;
    if (f > 0) doc.roundedRect(bx, yy + 14, Math.max(f, 6), 6, 3).fillColor(C.violet).fill();
  });
}

// ---------------------------------------------------------------- páginas
function paginaResumo(doc, d, ctx) {
  fundo(doc);
  cabecalho(doc, { titulo: 'Resumo do mês', mes: d.mes, subtitulo: ctx.escopo });
  const gap = 16;
  const cw = (W - 2 * M - gap) / 2;
  const top = 172;
  const ch = 118;
  const proxNome = cap(ymMonthName(d.proximo_mes));
  kpi(doc, {
    x: M, y: top, w: cw, h: ch, cor: C.g600, rotulo: 'Vendido no mês', valor: fmtBRL(d.vendido.total),
    linha1: `${d.vendido.qtd} ${d.vendido.qtd === 1 ? 'venda' : 'vendas'}`, linha2: d.vendido.qtd ? `Ticket médio ${fmtBRL(d.vendido.ticket_medio)}` : 'Nenhuma venda lançada',
  });
  kpi(doc, {
    x: M + cw + gap, y: top, w: cw, h: ch, cor: C.orange, rotulo: 'Em aberto (a receber)', valor: fmtBRL(d.em_aberto.total),
    linha1: `${d.em_aberto.clientes} ${d.em_aberto.clientes === 1 ? 'cliente devendo' : 'clientes devendo'} · ${d.em_aberto.qtd} ${d.em_aberto.qtd === 1 ? 'título' : 'títulos'}`,
    linha2: d.vencido.total > 0 ? `${fmtBRL(d.vencido.total)} já vencido` : 'Nada vencido', linha2Cor: d.vencido.total > 0 ? C.red : null,
  });
  kpi(doc, {
    x: M, y: top + ch + gap, w: cw, h: ch, cor: C.violet, rotulo: `A receber em ${proxNome}`, valor: fmtBRL(d.a_receber_proximo_mes.total),
    linha1: `${d.a_receber_proximo_mes.qtd} ${d.a_receber_proximo_mes.qtd === 1 ? 'título vence' : 'títulos vencem'} no mês seguinte`,
    linha2: `${d.a_receber_proximo_mes.clientes} ${d.a_receber_proximo_mes.clientes === 1 ? 'cliente' : 'clientes'}`,
  });
  const r = d.retiradas;
  kpi(doc, {
    x: M + cw + gap, y: top + ch + gap, w: cw, h: ch, cor: C.blue, rotulo: 'Retiradas no mês', valor: `${fmtQtd(r.unidades)} un`,
    linha1: `em ${r.qtd} ${r.qtd === 1 ? 'retirada' : 'retiradas'}${r.valor > 0 ? ` · ${fmtBRL(r.valor)} em mercadoria` : ''}`,
    linha2: r.devolvidas > 0 ? `${fmtQtd(r.devolvidas)} un devolvidas` : 'Nenhuma devolução',
  });

  // faixa de números menores
  const fy = top + 2 * ch + gap + 24;
  const colw = (W - 2 * M) / 3;
  numeroMini(doc, { x: M + 4, y: fy, w: colw, rotulo: 'Recebido no mês', valor: fmtBRL(d.recebido.total), cor: C.g700 });
  numeroMini(doc, { x: M + colw + 4, y: fy, w: colw, rotulo: 'Vence neste mês', valor: fmtBRL(d.vence_no_mes.total) });
  numeroMini(doc, { x: M + 2 * colw + 4, y: fy, w: colw, rotulo: 'Pix recebido', valor: fmtBRL(d.recebido.pix) });

  const gy = fy + 56;
  const gw = W - 2 * M - gap - 205;
  graficoMeses(doc, { x: M, y: gy, w: gw, h: 250, meses: d.meses });
  previsao(doc, { x: M + gw + gap, y: gy, w: 205, h: 250, itens: d.previsao, proximo: d.proximo_mes });
  if (d.recebido.sem_baixa_total > 0 && ctx.admin) {
    txt(doc, `${fmtBRL(d.recebido.sem_baixa_total)} recebidos ainda sem baixa em nenhuma dívida (conciliar no painel).`, M, gy + 264, { size: 8.5, color: C.muted });
  }
}

function paginaVendedores(doc, d, ctx) {
  doc.addPage({ size: 'A4', margin: 0 });
  fundo(doc);
  cabecalho(doc, { titulo: 'Por vendedor', mes: d.mes, subtitulo: ctx.escopo, grande: false });
  const lista = d.por_vendedor.slice(0, 11);
  const totalVendido = Math.max(...lista.map((v) => v.vendido), 1);
  let y = 112;
  // cabeçalho da tabela
  const cols = { nome: M + 16, ret: W - M - 16 };
  const R = { vendido: 305, recebido: 385, aberto: 470 };
  txt(doc, 'VENDEDOR', cols.nome, y, { font: 'I7', size: 7.5, color: C.muted, spacing: 0.9 });
  const rhead = (t, xr) => { doc.font('I7').fontSize(7.5); txt(doc, t, xr - doc.widthOfString(t, { characterSpacing: 0.9 }), y, { font: 'I7', size: 7.5, color: C.muted, spacing: 0.9 }); };
  rhead('VENDIDO', R.vendido); rhead('RECEBIDO', R.recebido); rhead('EM ABERTO', R.aberto); rhead('RETIRADAS', cols.ret);
  y += 18;
  lista.forEach((v) => {
    card(doc, M, y, W - 2 * M, 40, 10);
    txt(doc, v.nome, cols.nome, y + 9, { font: 'I6', size: 10.5, color: C.ink, width: 200 });
    // barra de participação
    const bw = 170;
    doc.roundedRect(cols.nome, y + 27, bw, 4, 2).fillColor(C.g100).fill();
    const f = (v.vendido / totalVendido) * bw;
    if (f > 0) doc.roundedRect(cols.nome, y + 27, Math.max(f, 4), 4, 2).fillColor(C.g600).fill();
    const num = (val, xr, font = 'I4', cor = C.ink) => { const s = fmtBRL(val); doc.font(font).fontSize(9.5); txt(doc, s, xr - doc.widthOfString(s), y + 14, { font, size: 9.5, color: cor }); };
    num(v.vendido, R.vendido, 'I7');
    num(v.recebido, R.recebido);
    num(v.em_aberto, R.aberto, v.vencido > 0 ? 'I6' : 'I4');
    const rt = v.retiradas_un ? `${fmtQtd(v.retiradas_un)} un` : '—';
    doc.font('I4').fontSize(9.5);
    txt(doc, rt, cols.ret - doc.widthOfString(rt), y + 14, { size: 9.5 });
    if (v.vencido > 0) {
      const t = `${fmtBRL(v.vencido)} vencido`;
      doc.font('I4').fontSize(7.5);
      txt(doc, t, R.aberto - doc.widthOfString(t), y + 27, { size: 7.5, color: C.red });
    }
    y += 46;
  });
  if (!lista.length) txt(doc, 'Nenhum movimento por vendedor neste mês.', M, y + 10, { size: 10, color: C.muted });

  // maiores devedores
  if (d.top_devedores.length && y < H - 200) {
    y += 14;
    txt(doc, 'MAIORES DEVEDORES', M + 4, y, { font: 'I7', size: 7.5, color: C.muted, spacing: 0.9 });
    y += 16;
    for (const c of d.top_devedores.slice(0, 5)) {
      if (y > H - 80) break;
      txt(doc, c.nome, M + 4, y, { font: 'I4', size: 9.5, width: 300 });
      const s = fmtBRL(c.aberto);
      doc.font('I7').fontSize(9.5);
      txt(doc, s, W - M - 4 - doc.widthOfString(s), y, { font: 'I7', size: 9.5 });
      if (c.vencido > 0) {
        const t = `${fmtBRL(c.vencido)} vencido`;
        doc.font('I4').fontSize(8);
        txt(doc, t, W - M - 110 - doc.widthOfString(t), y + 1, { size: 8, color: C.red });
      }
      doc.moveTo(M + 4, y + 16).lineTo(W - M - 4, y + 16).lineWidth(0.5).strokeColor(C.line).stroke();
      y += 24;
    }
  }
}

function paginaDeposito(doc, d, ctx) {
  doc.addPage({ size: 'A4', margin: 0 });
  fundo(doc);
  cabecalho(doc, { titulo: 'Depósito', mes: d.mes, subtitulo: ctx.escopo, grande: false });
  const dep = d.deposito;
  const gap = 12;
  const cw = (W - 2 * M - 3 * gap) / 4;
  const top = 112;
  const mini = (i, cor, rotulo, valor, sub) => {
    const x = M + i * (cw + gap);
    card(doc, x, top, cw, 86, 12);
    doc.circle(x + 15, top + 17, 3.5).fillColor(cor).fill();
    txt(doc, rotulo.toUpperCase(), x + 24, top + 13, { font: 'I7', size: 7, color: C.ink2, spacing: 0.7, width: cw - 28 });
    const s = fit(doc, valor, 'P7', 19, cw - 28, 12);
    txt(doc, valor, x + 15, top + 32, { font: 'P7', size: s, color: C.ink });
    if (sub) txt(doc, sub, x + 15, top + 62, { size: 8, color: C.muted, width: cw - 24 });
  };
  mini(0, C.g600, 'Entrou', fmtQtd(dep.entradas), 'compras e devoluções');
  mini(1, C.blue, 'Produzido', fmtQtd(dep.produzido), 'fabricado no mês');
  mini(2, C.orange, 'Saiu', fmtQtd(dep.vendas_saidas + dep.perdas), 'vendas, saídas e perdas');
  mini(3, C.violet, 'Retiradas', fmtQtd(dep.retiradas), 'levadas pelos vendedores');

  // produção planejada x produzida
  const py = top + 86 + 16;
  card(doc, M, py, W - 2 * M, 112, 14);
  txt(doc, 'Produção: planejado x produzido', M + 20, py + 16, { font: 'I7', size: 10, color: C.ink });
  const p = dep.producao;
  const pct = p.planejado > 0 ? Math.min(p.produzido_do_plano / p.planejado, 1) : 0;
  const bx = M + 20;
  const bw = W - 2 * M - 40;
  doc.roundedRect(bx, py + 42, bw, 10, 5).fillColor(p.planejado > 0 ? '#f6dccf' : C.line).fill();
  if (pct > 0) doc.roundedRect(bx, py + 42, Math.max(bw * pct, 10), 10, 5).fillColor(C.g600).fill();
  txt(doc, `${fmtQtd(p.produzido_do_plano)} produzidos`, bx, py + 62, { font: 'I7', size: 10, color: C.ink });
  doc.font('I7').fontSize(10);
  const t2 = `${fmtQtd(p.nao_produzido)} não produzidos`;
  txt(doc, t2, bx + bw - doc.widthOfString(t2), py + 62, { font: 'I7', size: 10, color: p.nao_produzido > 0 ? C.red : C.ink2 });
  txt(doc, p.planejado > 0 ? `Planejado: ${fmtQtd(p.planejado)} em ${p.ordens} ${p.ordens === 1 ? 'ordem' : 'ordens'} (${p.ordens_concluidas} concluída${p.ordens_concluidas === 1 ? '' : 's'})` : 'Nenhuma produção planejada para este mês.', bx, py + 82, { size: 8.5, color: C.muted });

  // estoque atual
  let y = py + 112 + 16;
  card(doc, M, y, W - 2 * M, 66, 14);
  numeroMini(doc, { x: M + 22, y: y + 14, w: 200, rotulo: 'Estoque atual', valor: `${fmtQtd(dep.estoque.total_unidades)} un` });
  numeroMini(doc, { x: M + 220, y: y + 14, w: 200, rotulo: 'Valor em estoque', valor: fmtBRL(dep.estoque.valor_centavos) });
  y += 66 + 18;

  // por produto
  const linhas = ctx.porProduto || [];
  if (linhas.length) {
    txt(doc, 'MOVIMENTO POR PRODUTO', M + 4, y, { font: 'I7', size: 7.5, color: C.muted, spacing: 0.9 });
    y += 16;
    const xs = { nome: M + 4, entrou: 300, prod: 355, saiu: 410, ret: 465, saldo: W - M - 4 };
    const hd = (t, xr) => { doc.font('I7').fontSize(7); txt(doc, t, xr - doc.widthOfString(t, { characterSpacing: 0.7 }), y, { font: 'I7', size: 7, color: C.muted, spacing: 0.7 }); };
    hd('ENTROU', xs.entrou + 40); hd('PRODUZ.', xs.prod + 40); hd('SAIU', xs.saiu + 40); hd('RETIR.', xs.ret + 40); hd('SALDO', xs.saldo);
    y += 14;
    for (const l of linhas.slice(0, 11)) {
      if (y > H - 80) break;
      txt(doc, l.nome, xs.nome, y, { size: 9, width: 240 });
      const n = (v, xr, font = 'I4') => { const s = v ? fmtQtd(v) : '—'; doc.font(font).fontSize(9); txt(doc, s, xr - doc.widthOfString(s), y, { font, size: 9, color: v ? C.ink : C.muted }); };
      n(l.entrou, xs.entrou + 40); n(l.produzido, xs.prod + 40); n(l.saiu + l.perdido, xs.saiu + 40); n(l.retirado, xs.ret + 40); n(l.saldo, xs.saldo, 'I7');
      doc.moveTo(M + 4, y + 15).lineTo(W - M - 4, y + 15).lineWidth(0.5).strokeColor(C.line).stroke();
      y += 22;
    }
  }
  if (dep.estoque.abaixo_minimo.length && y < H - 110) {
    y += 8;
    txt(doc, 'ABAIXO DO ESTOQUE MÍNIMO', M + 4, y, { font: 'I7', size: 7.5, color: C.red, spacing: 0.9 });
    y += 14;
    for (const a of dep.estoque.abaixo_minimo.slice(0, 5)) {
      if (y > H - 70) break;
      txt(doc, `${a.nome} — ${fmtQtd(a.saldo)} ${a.unidade} (mínimo ${fmtQtd(a.minimo)})`, M + 4, y, { size: 9, color: C.ink2 });
      y += 15;
    }
  }
}

/**
 * @returns {PDFKit.PDFDocument} documento (use pipe + end ficam por conta de quem chama)
 */
export function gerarResumoPDF({ dados, empresa, escopo, admin, opcoes = {}, porProduto = [], geradoEm }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `Resumo ${ymLabel(dados.mes)} — ${empresa}`, Author: empresa, Creator: 'Painel Bom Gosto da Amazônia' } });
  fonts(doc);
  doc.addPage({ size: 'A4', margin: 0 });
  const ctx = { escopo, admin, porProduto };
  const paginas = [paginaResumo];
  if (opcoes.vendedores && admin && dados.por_vendedor.length) paginas.push(paginaVendedores);
  if (opcoes.deposito && admin && dados.deposito) paginas.push(paginaDeposito);
  paginas.forEach((fn, i) => {
    fn(doc, dados, ctx);
    rodape(doc, { empresa, geradoEm, pagina: i + 1, total: paginas.length });
  });
  return doc;
}

