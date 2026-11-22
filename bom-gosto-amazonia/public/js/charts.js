// Gráficos simples em SVG (sem biblioteca): colunas por mês e barras horizontais.
import { html, useState, useEffect, useRef, fmtBRL, fmtCompact, ymAdd } from './lib.js';

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const mesCurto = (ym) => MES[Number(ym.slice(5, 7)) - 1];
export const COR = { verde: '#1b7f4f', violeta: '#6250d6', laranja: '#eb6834', azul: '#2a78d6', ambar: '#f2b134' };

function useLargura(ref) {
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    setW(ref.current.clientWidth || 600);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((es) => setW(Math.round(es[0].contentRect.width) || 600));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return w;
}

function escala(max) {
  if (max <= 0) return { topo: 100000, passo: 25000 };
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / mag;
  const base = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  const passo = base * mag;
  return { passo, topo: Math.ceil(max / passo) * passo };
}

/** Colunas agrupadas por mês. series: [{ k, nome, cor }] ; dados: [{ ym, [k]: centavos }] */
export function ColunasMeses({ dados, series, altura = 250 }) {
  const ref = useRef(null);
  const W = useLargura(ref);
  const [dica, setDica] = useState(null);
  const [tabela, setTabela] = useState(false);
  const L = 54; const R = 8; const T = 12; const B = 30;
  const gw = Math.max(W - L - R, 50);
  const gh = altura - T - B;
  const max = Math.max(0, ...dados.flatMap((d) => series.map((s) => d[s.k] || 0)));
  const { topo, passo } = escala(max);
  const slot = gw / dados.length;
  const bw = Math.max(6, Math.min(24, slot / (series.length + 1.2)));
  const total = bw * series.length + 2 * (series.length - 1);
  const ticks = [];
  for (let v = 0; v <= topo + 1; v += passo) ticks.push(v);
  const y = (v) => T + gh - (v / topo) * gh;
  const ult = dados[dados.length - 1];

  return html`<div>
    <div class="row between" style="margin-bottom:6px">
      <div class="legend">${series.map((s) => html`<span key=${s.k}><i style=${{ background: s.cor }}></i>${s.nome}</span>`)}</div>
      <button class="link small muted" onClick=${() => setTabela(!tabela)}>${tabela ? 'Ver gráfico' : 'Ver como tabela'}</button>
    </div>
    ${tabela ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mês</th>${series.map((s) => html`<th class="num">${s.nome}</th>`)}</tr></thead>
      <tbody>${dados.map((d) => html`<tr><td>${mesCurto(d.ym)}/${d.ym.slice(2, 4)}</td>${series.map((s) => html`<td class="num">${fmtBRL(d[s.k] || 0)}</td>`)}</tr>`)}</tbody></table></div>` : html`
    <div class="chart" ref=${ref} onMouseLeave=${() => setDica(null)}>
      <svg width=${W} height=${altura} role="img" aria-label=${`Gráfico de colunas: ${series.map((s) => s.nome).join(' e ')} nos últimos meses`}>
        ${ticks.map((v) => html`<g key=${v}><line class=${v === 0 ? 'axis-l' : 'grid-l'} x1=${L} x2=${L + gw} y1=${y(v)} y2=${y(v)} />
          <text x=${L - 8} y=${y(v) + 4} text-anchor="end">${v === 0 ? '0' : fmtCompact(v).replace('R$ ', '')}</text></g>`)}
        ${dados.map((d, i) => {
          const cx0 = L + slot * i + slot / 2;
          const x0 = cx0 - total / 2;
          return html`<g key=${d.ym}>
            ${series.map((s, j) => {
              const h = ((d[s.k] || 0) / topo) * gh;
              const x = x0 + j * (bw + 2);
              const r = Math.min(4, bw / 2, h);
              return h > 0 ? html`<path d=${`M${x},${T + gh} V${T + gh - h + r} Q${x},${T + gh - h} ${x + r},${T + gh - h} H${x + bw - r} Q${x + bw},${T + gh - h} ${x + bw},${T + gh - h + r} V${T + gh} Z`} fill=${s.cor} />` : null;
            })}
            <text x=${cx0} y=${altura - 8} text-anchor="middle" style=${d === ult ? 'font-weight:700;fill:var(--ink)' : ''}>${mesCurto(d.ym)}</text>
            <rect x=${L + slot * i} y=${T} width=${slot} height=${gh + B - 6} fill="transparent" tabindex="0" role="img"
              aria-label=${`${mesCurto(d.ym)}: ${series.map((s) => `${s.nome} ${fmtBRL(d[s.k] || 0)}`).join(', ')}`}
              onMouseEnter=${() => setDica({ d, x: cx0 })} onFocus=${() => setDica({ d, x: cx0 })} onBlur=${() => setDica(null)} onTouchStart=${() => setDica({ d, x: cx0 })} />
          </g>`;
        })}
        ${ult && Math.max(...series.map((s) => ult[s.k] || 0)) > 0 && html`<text x=${Math.min(L + slot * (dados.length - 1) + slot / 2, W - 34)} y=${y(Math.max(...series.map((s) => ult[s.k] || 0))) - 7} text-anchor="middle" style="font-weight:700;fill:var(--ink)">${fmtCompact(ult[series[0].k] || 0)}</text>`}
      </svg>
      ${dica && html`<div class="tip" style=${{ left: `${Math.max(90, Math.min(dica.x, W - 90))}px`, top: `${T + 8}px` }}>
        <b>${mesCurto(dica.d.ym)}/${dica.d.ym.slice(0, 4)}</b>
        ${series.map((s) => html`<div><span><i style=${{ background: s.cor }}></i>${s.nome}</span><span>${fmtBRL(dica.d[s.k] || 0)}</span></div>`)}</div>`}
    </div>`}
  </div>`;
}

/** Lista de barras horizontais (uma cor só). itens: [{ rotulo, valor, texto, destaque }] */
export function BarrasH({ itens, cor = COR.violeta, trilha = 'v', larg1 = false }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return html`<div>${itens.map((i) => html`<div class=${`hbar ${larg1 ? 'l1' : ''}`} key=${i.rotulo}>
    <span class=${i.destaque ? 'bold' : 'ink2'} style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title=${i.rotulo}>${i.rotulo}</span>
    <div class=${`track ${trilha}`}><div class="fill" style=${{ width: `${Math.max((i.valor / max) * 100, i.valor > 0 ? 3 : 0)}%`, background: cor }}></div></div>
    <span class=${`nowrap mono ${i.destaque ? 'bold' : ''}`}>${i.texto}</span></div>`)}</div>`;
}
export { ymAdd };
