// Extrato bancário em OFX (Itaú, Bradesco, Banco do Brasil, Caixa, Inter, Nubank, Sicoob, Sicredi...).
import { parseDate } from '../../../shared/dates.js';

function tag(bloco, nome) {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

/** Tira "PIX RECEBIDO -", "TRANSF PIX" etc. do começo do histórico, ficando só com o nome de quem pagou. */
export function limparHistorico(s) {
  return String(s || '')
    .replace(/\b(pix|ted|doc|transf(?:er[eê]ncia)?|cr[eé]d(?:ito)?|receb(?:ido|imento)?|dep[oó]sito|pagamento|pgto|de|via|qr\s*code|cobran[cç]a|din[aâ]mico|est[aá]tico)\b[\s:.\-–/]*/gi, ' ')
    .replace(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/[-–:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lerOFX(texto) {
  if (!/<OFX>/i.test(texto) && !/<STMTTRN>/i.test(texto)) return { ok: false, motivo: 'Arquivo OFX inválido.' };
  const banco = tag(texto, 'ORG') || tag(texto, 'BANKID') || null;
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const transacoes = [];
  for (const b of blocos) {
    const valor = Number(tag(b, 'TRNAMT').replace(',', '.'));
    if (!Number.isFinite(valor)) continue;
    const data = parseDate(tag(b, 'DTPOSTED').slice(0, 8));
    const memo = tag(b, 'MEMO') || tag(b, 'NAME');
    transacoes.push({ data, valor_centavos: Math.round(valor * 100), fitid: tag(b, 'FITID'), historico: memo, tipo: tag(b, 'TRNTYPE') });
  }
  return { ok: true, banco, transacoes };
}
