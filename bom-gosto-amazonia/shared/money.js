// Dinheiro sempre em CENTAVOS (inteiro) para nunca ter erro de arredondamento.

/** Converte texto/número em centavos. Entende "R$ 1.234,56", "1234,56", "1.234", "(50,00)", "1.250,00 D", etc. */
export function parseMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  if (/^[^\d]*-/.test(s)) neg = true;
  if (/\d\s*D$/.test(s)) neg = true; // sufixo "D" de débito em extratos
  s = s.replace(/R\$|\s|[A-Za-z]/g, '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart;
  let decPart = '';
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = Math.max(lastComma, lastDot);
    intPart = s.slice(0, dec).replace(/[.,]/g, '');
    decPart = s.slice(dec + 1);
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    if (parts.length > 2) intPart = parts.join('');
    else { intPart = parts[0]; decPart = parts[1]; }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2) intPart = parts.join('');
    else if (parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3 && parts[0] !== '0') intPart = parts.join(''); // 1.234 = mil duzentos e trinta e quatro
    else { intPart = parts[0]; decPart = parts[1]; }
  } else {
    intPart = s;
  }
  if (!intPart) intPart = '0';
  const value = Math.round(parseFloat(`${intPart}.${decPart || '0'}`) * 100);
  if (!Number.isFinite(value)) return null;
  return neg ? -Math.abs(value) : value;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "R$ 1.234,56" */
export function fmtBRL(cents) {
  return brl.format((Number(cents) || 0) / 100).replace(/ /g, ' ');
}
/** "1.234,56" (sem símbolo) */
export function fmtNum(cents) {
  return num.format((Number(cents) || 0) / 100);
}
/** Quantidade: até 3 casas, sem zeros sobrando. */
export function fmtQtd(q) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(q) || 0);
}
/** Valor curto para gráficos: 1,2 mil / 3,4 mi */
export function fmtCompact(cents) {
  const v = (Number(cents) || 0) / 100;
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toFixed(1).replace('.', ',')} mi`;
  if (a >= 1e4) return `R$ ${(v / 1e3).toFixed(0)} mil`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toFixed(1).replace('.', ',')} mil`;
  return fmtBRL(cents);
}
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
