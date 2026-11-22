// Datas como texto ISO "AAAA-MM-DD" (sem horário) para evitar problema de fuso.
import { norm } from './text.js';

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
export const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function valid(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m))) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Hoje (AAAA-MM-DD) no fuso da empresa. */
export function todayISO(tz = 'America/Manaus') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Lê datas em vários formatos brasileiros. Retorna "AAAA-MM-DD" ou null. */
export function parseDate(v, opts = {}) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // serial do Excel
    return null;
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{4,6})?$/)) && s.length >= 8) return valid(+m[1], +m[2], +m[3]); // 20261105 / 20261105120000
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\D.*)?$/))) {
    let y = +m[3];
    if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    return valid(y, +m[2], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})\s*(?:de\s+)?([A-Za-zÀ-ú]{3,})\.?\s*(?:de\s+)?(\d{4})/))) {
    const mes = MESES[norm(m[2]).slice(0, 3)];
    if (mes) return valid(+m[3], mes, +m[1]);
  }
  if (opts.refYear && (m = s.match(/^(\d{1,2})[/\-](\d{1,2})$/))) return valid(opts.refYear, +m[2], +m[1]);
  return null;
}

export const ymOf = (iso) => String(iso).slice(0, 7);
export const isYM = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysIn(ny, nm)))}`;
}
export function ymAdd(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
/** { inicio, fim } do mês (fim inclusive). */
export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { inicio: `${y}-${pad(m)}-01`, fim: `${y}-${pad(m)}-${pad(daysIn(y, m))}` };
}
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
/** "22/11/2026" */
export function fmtBR(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
/** "Novembro/2026" */
export function ymLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const n = MESES_NOME[m - 1];
  return `${n[0].toUpperCase()}${n.slice(1)}/${y}`;
}
/** "novembro" */
export function ymMonthName(ym) {
  return MESES_NOME[Number(ym.split('-')[1]) - 1];
}
