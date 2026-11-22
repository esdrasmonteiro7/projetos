// Erros HTTP e validação simples de entrada (mensagens em português).
import { parseDate, isYM } from '../../shared/dates.js';
import { parseMoney } from '../../shared/money.js';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (m, extra) => new HttpError(400, m, extra);
export const forbidden = (m = 'Você não tem permissão para fazer isso.') => new HttpError(403, m);
export const notFound = (m = 'Não encontrado.') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

export function str(v, { max = 200, required = false, name = 'campo' } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw bad(`Preencha: ${name}.`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw bad(`"${name}" está muito longo (máximo ${max} caracteres).`);
  return s;
}
export function int(v, { min = -Infinity, max = Infinity, required = false, name = 'campo' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Preencha: ${name}.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`Valor inválido em "${name}".`);
  return n;
}
export function num(v, { min = -Infinity, max = Infinity, required = false, name = 'campo' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Preencha: ${name}.`);
    return null;
  }
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`Valor inválido em "${name}".`);
  return n;
}
/** Dinheiro: aceita centavos (inteiro) ou texto "1.234,56" */
export function cents(v, { min = 0, required = false, name = 'valor' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Preencha: ${name}.`);
    return null;
  }
  // número inteiro (ou texto só com dígitos, como vem em formulários) = centavos; texto como "1.234,56" é lido como dinheiro
  const c = typeof v === 'number' ? Math.round(v) : /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : parseMoney(v);
  if (c === null || !Number.isFinite(c) || c < min) throw bad(`Valor inválido em "${name}".`);
  if (c > 99_999_999_999) throw bad(`"${name}" é grande demais.`);
  return c;
}
export function date(v, { required = false, name = 'data' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Preencha: ${name}.`);
    return null;
  }
  const d = parseDate(v);
  if (!d) throw bad(`Data inválida em "${name}".`);
  return d;
}
export function oneOf(v, list, { required = false, name = 'campo' } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Preencha: ${name}.`);
    return null;
  }
  if (!list.includes(v)) throw bad(`Valor inválido em "${name}".`);
  return v;
}
export function ym(v, fallback) {
  if (!v) return fallback;
  if (!isYM(v)) throw bad('Mês inválido (use AAAA-MM).');
  return v;
}
export const flag = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'sim';

export function paging(query, { max = 200, def = 50 } = {}) {
  const limite = Math.min(Math.max(parseInt(query.limite, 10) || def, 1), max);
  const pagina = Math.max(parseInt(query.pagina, 10) || 1, 1);
  return { limite, pagina, offset: (pagina - 1) * limite };
}
/** escapa % e _ para LIKE */
export const likeTerm = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
