// Normalização e comparação de nomes (acentos, maiúsculas, "LTDA", "da/de" etc.)

/** minúsculo, sem acento, só letras/números separados por espaço */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'epp', 'eireli', 'sa', 'mei', 'cia', 'ss']);

export function tokensOf(normalized) {
  return normalized.split(' ').filter((t) => t && !STOP.has(t));
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length > 80) a = a.slice(0, 80);
  if (b.length > 80) b = b.slice(0, 80);
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Similaridade entre dois nomes de 0 a 1. */
export function nameScore(a, b) {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ta = tokensOf(A);
  const tb = tokensOf(B);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  const jacc = inter / union;
  const minSize = Math.min(sa.size, sb.size);
  const maxSize = Math.max(sa.size, sb.size);
  let subset = 0;
  if (inter === minSize) subset = minSize >= 2 ? 0.82 + 0.15 * (minSize / maxSize) : 0.55;
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  const lev = 1 - levenshtein(ja, jb) / Math.max(ja.length, jb.length);
  return Math.max(jacc, subset, lev * 0.97);
}

export const digits = (s) => String(s ?? '').replace(/\D+/g, '');

export function titleCase(s) {
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function formatDoc(d) {
  const x = digits(d);
  if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d || '';
}

/** Escapa um campo para CSV brasileiro (separador ;). */
export function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
