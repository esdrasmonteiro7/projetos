// Base do front-end: Preact + htm (sem build), chamadas à API, formatação e utilidades.
import { html, render, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, useReducer, Component, h } from '/vendor/preact-htm.js';
import { parseMoney, fmtBRL, fmtNum, fmtQtd, fmtCompact } from '/shared/money.js';
import { fmtBR, ymLabel, ymAdd, ymMonthName, todayISO, addDays, parseDate } from '/shared/dates.js';

export { html, render, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, useReducer, Component, h };
export { parseMoney, fmtBRL, fmtNum, fmtQtd, fmtCompact, fmtBR, ymLabel, ymAdd, ymMonthName, todayISO, addDays, parseDate };

// ---------------------------------------------------------------- API
let csrf = null;
export const setCsrf = (t) => { csrf = t; };

export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const headers = {};
  if (csrf) headers['x-csrf-token'] = csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let r;
  try {
    r = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  let data = null;
  if ((r.headers.get('content-type') || '').includes('application/json')) data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(data?.erro || `Erro ${r.status}`);
    err.status = r.status;
    err.data = data;
    if (r.status === 401) window.dispatchEvent(new CustomEvent('sessao-expirada'));
    throw err;
  }
  return data;
}
export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, v === true ? '1' : v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Carrega dados e mantém o resultado anterior enquanto recarrega (sem "piscar"). */
export function useApi(path, deps = []) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (path === null) { setSt({ loading: false, data: null, error: null }); return undefined; }
    let vivo = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    api(path).then((data) => vivo && setSt({ loading: false, data, error: null })).catch((error) => vivo && setSt((s) => ({ loading: false, data: s.data, error })));
    return () => { vivo = false; };
  }, [path, n, ...deps]);
  return { ...st, reload: () => setN((x) => x + 1) };
}

// ---------------------------------------------------------------- rotas (#/pagina?filtro=1)
export function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  const [path, q = ''] = hash.replace(/^#/, '').split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(q)) };
}
export const go = (path, query) => { location.hash = `${path}${qs(query)}`; };

// ---------------------------------------------------------------- mês de trabalho (compartilhado entre telas)
const ouvintes = new Set();
let mesAtual = (() => {
  try { const v = localStorage.getItem('bg_mes'); if (/^\d{4}-\d{2}$/.test(v || '')) return v; } catch { /* sem storage */ }
  return todayISO().slice(0, 7);
})();
export function useMes() {
  const [, forca] = useState(0);
  useEffect(() => { const f = () => forca((x) => x + 1); ouvintes.add(f); return () => ouvintes.delete(f); }, []);
  const set = (m) => {
    mesAtual = m;
    try { localStorage.setItem('bg_mes', m); } catch { /* ignora */ }
    ouvintes.forEach((f) => f());
  };
  return [mesAtual, set];
}

// ---------------------------------------------------------------- avisos
export const toast = (msg, tipo = 'ok') => window.dispatchEvent(new CustomEvent('toast', { detail: { msg, tipo, id: Math.random() } }));
export const confirmar = (opts) => new Promise((resolve) => window.dispatchEvent(new CustomEvent('confirmar', { detail: { ...opts, resolve } })));
export const erroMsg = (e) => (e && e.message) || 'Algo deu errado.';

/** Executa uma ação com aviso de erro automático. Retorna o resultado ou undefined. */
export async function tentar(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r === undefined ? true : r;
  } catch (e) {
    if (e.name !== 'AbortError') toast(erroMsg(e), 'erro');
    return undefined;
  }
}

// ---------------------------------------------------------------- formatação
export const FORMAS = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', boleto: 'Boleto', transferencia: 'Transferência', cheque: 'Cheque', prazo: 'A prazo', outro: 'Outro' };
export const TIPOS_MOV = { entrada: 'Entrada', producao: 'Produção', devolucao: 'Devolução', ajuste: 'Ajuste', saida: 'Saída', venda: 'Venda', retirada: 'Retirada', perda: 'Perda' };
export const fmtDataHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
export const cx = (...a) => a.filter(Boolean).join(' ');
export const baixarUrl = (url) => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function useDebounced(valor, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}
