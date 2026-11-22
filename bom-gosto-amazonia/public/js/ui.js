// Componentes visuais reutilizáveis.
import {
  html, useState, useEffect, useRef, useMemo, api, qs, parseMoney, fmtBRL, fmtNum, fmtBR, ymLabel, ymAdd, cx, useDebounced, tentar,
} from './lib.js';

const P = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  cart: 'M3 4h2l2.2 11h10.6L20 7H6.2M9 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  cash: 'M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M6.5 10v4M17.5 10v4',
  upload: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  box: 'M21 8 12 3 3 8m18 0v8l-9 5m9-13-9 5m0 8-9-5V8m9 5v8M7.5 5.5 16.5 10.5',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 13h6M9 17h6',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 5.2a3.5 3.5 0 0 1 0 6.6',
  user: 'M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  out: 'M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M21 21l-4.3-4.3',
  left: 'm15 18-6-6 6-6', right: 'm9 18 6-6-6-6', down: 'm6 9 6 6 6-6',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  info: 'M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  download: 'M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM14 6l4 4',
  chat: 'M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  leaf: 'M5 19c0-9 5-14 15-15-1 10-6 15-13 15-.8 0-1.4-.1-2-.3M5 19c3-4 6-7 10-10',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  sheet: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 9h16M4 15h16M10 9v12',
};
export function Icon({ n, s = 20, cls }) {
  return html`<svg class=${cls} width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[n] || P.info} /></svg>`;
}

export function Logo({ size = 46 }) {
  return html`<img class="brand-logo" src="/img/logo-96.png" srcset="/img/logo-96.png 1x, /img/logo-192.png 2x" width=${size} height=${size} alt="Bom Gosto da Amazônia" />`;
}

export function Badge({ tipo = 'mute', children, title }) {
  return html`<span class=${`badge b-${tipo}`} title=${title}>${children}</span>`;
}

export const SITUACAO = {
  aberto: ['info', 'A vencer'], vencido: ['bad', 'Vencido'], parcial: ['warn', 'Pago em parte'], pago: ['ok', 'Pago'], cancelado: ['mute', 'Cancelado'],
};
export function StatusTitulo({ t }) {
  const [tipo, rot] = SITUACAO[t.status] || ['mute', t.status];
  return html`<${Badge} tipo=${tipo}>${t.status === 'vencido' && t.dias_atraso ? `${rot} há ${t.dias_atraso} d` : rot}<//>`;
}

export function Spinner() { return html`<div class="boot" style="height:200px"><div class="spinner"></div></div>`; }

export function Empty({ icon = 'info', titulo, children }) {
  return html`<div class="empty"><${Icon} n=${icon} s=${40} /><div class="t">${titulo}</div><div>${children}</div></div>`;
}

export function ErroCaixa({ erro, onRetry }) {
  return html`<div class="alert bad"><${Icon} n="alert" /><div class="grow">${erro.message || 'Erro ao carregar.'} ${onRetry && html`<button class="link" onClick=${onRetry}>Tentar de novo</button>`}</div></div>`;
}

export function PageHead({ titulo, sub, children }) {
  return html`<div class="page-head"><div><h1 class="titulo">${titulo}</h1>${sub && html`<div class="sub">${sub}</div>`}</div><div class="tools">${children}</div></div>`;
}

export function Btn({ children, tipo, sm, icon, onClick, href, disabled, title, type = 'button', cls, download, target }) {
  const c = cx('btn', tipo === 'primary' && 'btn-primary', tipo === 'danger' && 'btn-danger', tipo === 'ghost' && 'btn-ghost', tipo === 'wa' && 'btn-wa', tipo === 'solid-danger' && 'btn-solid-danger', sm && 'btn-sm', cls);
  const inner = html`${icon && html`<${Icon} n=${icon} s=${sm ? 16 : 18} />`}${children}`;
  if (href) return html`<a class=${c} href=${href} title=${title} download=${download} target=${target} rel=${target ? 'noopener' : undefined}>${inner}</a>`;
  return html`<button class=${c} type=${type} onClick=${onClick} disabled=${disabled} title=${title}>${inner}</button>`;
}

// ---------------------------------------------------------------- modal
export function Modal({ titulo, sub, onClose, children, rodape, tam = '' }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose?.();
    addEventListener('keydown', f);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', f); document.body.style.overflow = ''; };
  }, []);
  return html`
    <div class="modal-back" onMouseDown=${(e) => e.target === e.currentTarget && onClose?.()}>
      <div class=${`modal ${tam}`} role="dialog" aria-modal="true" aria-label=${titulo}>
        <div class="modal-h"><div><h3>${titulo}</h3>${sub && html`<div class="sub">${sub}</div>`}</div>
          <button class="btn btn-ghost btn-icon btn-sm" onClick=${onClose} aria-label="Fechar"><${Icon} n="x" /></button></div>
        <div class="modal-b">${children}</div>
        ${rodape && html`<div class="modal-f">${rodape}</div>`}
      </div>
    </div>`;
}

export function ConfirmHost() {
  const [c, setC] = useState(null);
  useEffect(() => { const f = (e) => setC(e.detail); addEventListener('confirmar', f); return () => removeEventListener('confirmar', f); }, []);
  if (!c) return null;
  const fim = (v) => { c.resolve(v); setC(null); };
  return html`<${Modal} titulo=${c.titulo || 'Confirmar'} tam="sm" onClose=${() => fim(false)}
    rodape=${html`<${Btn} onClick=${() => fim(false)}>Cancelar<//><${Btn} tipo=${c.perigo ? 'solid-danger' : 'primary'} onClick=${() => fim(true)}>${c.ok || 'Confirmar'}<//>`}>
    <div style="white-space:pre-line">${c.texto}</div><//>`;
}

export function ToastHost() {
  const [lista, setLista] = useState([]);
  useEffect(() => {
    const f = (e) => {
      const t = e.detail;
      setLista((l) => [...l.slice(-3), t]);
      setTimeout(() => setLista((l) => l.filter((x) => x.id !== t.id)), t.tipo === 'erro' ? 7000 : 4000);
    };
    addEventListener('toast', f);
    return () => removeEventListener('toast', f);
  }, []);
  return html`<div class="toasts" aria-live="polite">${lista.map((t) => html`<div key=${t.id} class=${`toast ${t.tipo === 'ok' ? '' : t.tipo}`}><${Icon} n=${t.tipo === 'erro' ? 'alert' : 'check'} s=${18} /><span>${t.msg}</span></div>`)}</div>`;
}

// ---------------------------------------------------------------- formulário
export function Field({ label, hint, children, cls }) {
  return html`<div class=${cx('field', cls)}>${label && html`<label>${label}</label>`}${children}${hint && html`<div class="hint">${hint}</div>`}</div>`;
}
export function Input({ value, onInput, ...rest }) {
  return html`<input class="input" value=${value ?? ''} onInput=${(e) => onInput?.(e.target.value)} ...${rest} />`;
}
export function Select({ value, onChange, children, sm, ...rest }) {
  return html`<select class=${cx('select', sm && 'select-sm')} value=${value ?? ''} onChange=${(e) => onChange?.(e.target.value)} ...${rest}>${children}</select>`;
}
export function Check({ checked, onChange, children }) {
  return html`<label class="chk"><input type="checkbox" checked=${!!checked} onChange=${(e) => onChange?.(e.target.checked)} /><span>${children}</span></label>`;
}
/** Campo de dinheiro: o valor guardado é em centavos (número) ou null. */
export function MoneyInput({ value, onChange, placeholder = '0,00', ...rest }) {
  const [txt, setTxt] = useState(value == null ? '' : fmtNum(value));
  const ultimo = useRef(value);
  useEffect(() => { if (value !== ultimo.current) { ultimo.current = value; setTxt(value == null ? '' : fmtNum(value)); } }, [value]);
  return html`<input class="input mono" inputmode="decimal" placeholder=${placeholder} value=${txt} ...${rest}
    onInput=${(e) => { setTxt(e.target.value); const v = parseMoney(e.target.value); ultimo.current = v; onChange?.(v); }}
    onBlur=${() => { if (ultimo.current != null) setTxt(fmtNum(ultimo.current)); }} />`;
}
export function SearchBox({ value, onInput, placeholder = 'Buscar…' }) {
  return html`<div class="searchbox"><${Icon} n="search" s=${18} /><input class="input" type="search" placeholder=${placeholder} value=${value} onInput=${(e) => onInput(e.target.value)} /></div>`;
}

export function MonthBar({ mes, setMes }) {
  return html`<div class="monthbar"><button aria-label="Mês anterior" onClick=${() => setMes(ymAdd(mes, -1))}><${Icon} n="left" s=${18} /></button>
    <span>${ymLabel(mes)}</span><button aria-label="Próximo mês" onClick=${() => setMes(ymAdd(mes, 1))}><${Icon} n="right" s=${18} /></button></div>`;
}

export function Seg({ valor, onChange, opcoes }) {
  return html`<div class="seg" role="tablist">${opcoes.map(([v, l]) => html`<button key=${v} class=${valor === v ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
}
export function Tabs({ valor, onChange, abas }) {
  return html`<div class="tabs" role="tablist">${abas.map(([v, l, n]) => html`<button key=${v} class=${cx('tab', valor === v && 'on')} onClick=${() => onChange(v)}>${l}${n ? html`<span class="n">${n}</span>` : ''}</button>`)}</div>`;
}

// ---------------------------------------------------------------- escolher cliente (busca no servidor)
export function ClientePicker({ valor, onChange, vendedorId, placeholder = 'Digite o nome do cliente…', permitirNovo = true, onNovo }) {
  const [txt, setTxt] = useState(valor?.nome || '');
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState([]);
  const d = useDebounced(txt, 250);
  useEffect(() => { if (valor?.nome !== undefined && valor.nome !== txt && !aberto) setTxt(valor?.nome || ''); }, [valor?.id]);
  useEffect(() => {
    if (!aberto) return undefined;
    let vivo = true;
    api(`/clientes${qs({ busca: d, limite: 8, vendedor_id: vendedorId })}`).then((r) => vivo && setLista(r.itens)).catch(() => {});
    return () => { vivo = false; };
  }, [d, aberto, vendedorId]);
  return html`<div class="rel">
    <input class="input" value=${txt} placeholder=${placeholder} autocomplete="off"
      onInput=${(e) => { setTxt(e.target.value); setAberto(true); if (valor) onChange(null); }} onFocus=${() => setAberto(true)} onBlur=${() => setTimeout(() => setAberto(false), 180)} />
    ${aberto && html`<div class="sug-list">
      ${lista.map((c) => html`<button type="button" key=${c.id} onMouseDown=${(e) => { e.preventDefault(); setTxt(c.nome); onChange(c); setAberto(false); }}>
        <b>${c.nome}</b> <span class="muted small">${c.cidade || ''} ${c.aberto_centavos > 0 ? `· deve ${fmtBRL(c.aberto_centavos)}` : ''}</span></button>`)}
      ${permitirNovo && txt.trim().length >= 2 && !lista.some((c) => c.nome.toLowerCase() === txt.trim().toLowerCase()) && html`<button type="button" onMouseDown=${(e) => { e.preventDefault(); onNovo?.(txt.trim()); setAberto(false); }}><${Icon} n="plus" s=${15} /> Cadastrar novo cliente "<b>${txt.trim()}</b>"</button>`}
      ${!lista.length && !permitirNovo && html`<div class="pad-s muted small">Nenhum cliente encontrado.</div>`}
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------- tabela responsiva
export function Tabela({ cols, linhas, onRow, vazio, rodape, chave = (r) => r.id, rowCls, stack = true }) {
  if (!linhas.length) return vazio || null;
  return html`<div class="tbl-wrap"><table class=${cx('tbl', stack && 'stack-m')}>
    <thead><tr>${cols.map((c) => html`<th class=${cx(c.num && 'num')} style=${c.w ? { width: c.w } : null}>${c.t}</th>`)}</tr></thead>
    <tbody>${linhas.map((r, i) => html`<tr key=${chave(r) ?? i} class=${cx(onRow && 'click', rowCls?.(r))} onClick=${onRow ? (e) => { if (!e.target.closest('button,a,input,select,label')) onRow(r); } : null}>
      ${cols.map((c, j) => html`<td class=${cx(c.num && 'num', j === 0 && 'first', c.acoes && 'acoes', c.cls)} data-l=${c.t}>${c.r(r)}</td>`)}</tr>`)}</tbody>
    ${rodape && html`<tfoot>${rodape}</tfoot>`}</table></div>`;
}

export function Pager({ pagina, limite, total, onPage }) {
  const paginas = Math.max(1, Math.ceil(total / limite));
  if (total <= limite) return null;
  return html`<div class="pager"><span class="muted small">${total} registros · página ${pagina} de ${paginas}</span>
    <div class="row gap-s"><${Btn} sm disabled=${pagina <= 1} onClick=${() => onPage(pagina - 1)}>Anterior<//><${Btn} sm disabled=${pagina >= paginas} onClick=${() => onPage(pagina + 1)}>Próxima<//></div></div>`;
}

export function KPI({ cor, rotulo, valor, sub, sub2, href, alerta }) {
  return html`<div class=${cx('card kpi', alerta && 'alerta')}>
    <div class="kpi-l"><span class="kpi-dot" style=${{ background: cor }}></span>${rotulo}</div>
    <div class="kpi-v">${valor}</div>
    ${sub && html`<div class="kpi-s">${sub}</div>`}${sub2 && html`<div class="kpi-s2">${sub2}</div>`}
    ${href && html`<a class="kpi-link" href=${href} aria-label=${rotulo}></a>`}</div>`;
}

export { tentar, fmtBR };
