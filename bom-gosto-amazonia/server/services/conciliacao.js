// Conciliação: sugere em qual título (conta a receber) cada Pix/recebimento deve dar baixa.
import { db } from '../db.js';
import { nameScore } from '../../shared/text.js';
import { daysBetween } from '../../shared/dates.js';

const fmt = (c) => (c / 100).toFixed(2).replace('.', ',');

/** Todas as combinações de até 3 títulos (lista pequena) cuja soma é exatamente o valor. */
function combinacaoExata(titulos, valor) {
  const n = Math.min(titulos.length, 14);
  for (let i = 0; i < n; i++) {
    if (titulos[i].aberto === valor) return [titulos[i]];
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (titulos[i].aberto + titulos[j].aberto === valor) return [titulos[i], titulos[j]];
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        if (titulos[i].aberto + titulos[j].aberto + titulos[k].aberto === valor) return [titulos[i], titulos[j], titulos[k]];
      }
    }
  }
  return null;
}

/**
 * @param recebimentos  lista de recebimentos com saldo_centavos > 0
 * @returns Map<recebimento_id, sugestao[]>
 */
export function sugerir(recebimentos) {
  const abertos = db.all(
    `SELECT t.id, t.cliente_id, t.vendedor_id, t.documento, t.parcela, t.vencimento, t.valor_centavos - t.pago_centavos AS aberto,
            c.nome AS cliente_nome
     FROM v_titulos t LEFT JOIN clientes c ON c.id = t.cliente_id
     WHERE t.cancelado = 0 AND t.valor_centavos > t.pago_centavos
     ORDER BY t.vencimento, t.id`,
  );
  const porCliente = new Map();
  for (const t of abertos) {
    const k = t.cliente_id || 0;
    if (!porCliente.has(k)) porCliente.set(k, { nome: t.cliente_nome || '', titulos: [] });
    porCliente.get(k).titulos.push(t);
  }
  const clientes = [...porCliente.entries()].filter(([k]) => k !== 0);
  const porValor = new Map();
  for (const t of abertos) {
    if (!porValor.has(t.aberto)) porValor.set(t.aberto, []);
    porValor.get(t.aberto).push(t);
  }

  const out = new Map();
  for (const r of recebimentos) {
    const saldo = r.saldo_centavos;
    const sugs = [];
    // 1) clientes cujo nome parece o do pagador (ou já ligados ao recebimento)
    const candidatos = [];
    for (const [cid, info] of clientes) {
      let score = r.pagador_nome ? nameScore(r.pagador_nome, info.nome) : 0;
      if (r.cliente_id && r.cliente_id === cid) score = 1;
      if (score >= 0.72) candidatos.push({ cid, info, score });
    }
    candidatos.sort((a, b) => b.score - a.score);
    for (const { info, score } of candidatos.slice(0, 3)) {
      const lista = info.titulos;
      const total = lista.reduce((s, t) => s + t.aberto, 0);
      const forte = score >= 0.88;
      const exato = combinacaoExata(lista, saldo);
      if (exato) {
        sugs.push({
          titulo_ids: exato.map((t) => t.id), valor_centavos: saldo, cliente_id: exato[0].cliente_id, cliente_nome: info.nome,
          confianca: forte ? 'alta' : 'media',
          motivo: exato.length === 1 ? 'Nome e valor batem com o título' : `Nome e valor batem com ${exato.length} títulos juntos`,
        });
        continue;
      }
      if (total === saldo) {
        sugs.push({
          titulo_ids: lista.map((t) => t.id), valor_centavos: saldo, cliente_id: lista[0].cliente_id, cliente_nome: info.nome,
          confianca: forte ? 'alta' : 'media', motivo: 'Paga todo o saldo em aberto do cliente',
        });
        continue;
      }
      // valor diferente: aplica do mais antigo para o mais novo (abatimento/parcial)
      let restante = Math.min(saldo, total);
      const ids = [];
      for (const t of lista) {
        if (restante <= 0) break;
        ids.push(t.id);
        restante -= Math.min(restante, t.aberto);
      }
      sugs.push({
        titulo_ids: ids, valor_centavos: Math.min(saldo, total), cliente_id: lista[0].cliente_id, cliente_nome: info.nome, confianca: 'baixa',
        motivo: saldo > total ? `Cliente deve ${fmt(total)} e pagou ${fmt(saldo)} (sobra ${fmt(saldo - total)})` : `Valor menor que o devido: abate do título mais antigo`,
      });
    }
    // 2) sem nome parecido: só um título no sistema tem exatamente esse valor
    if (!sugs.length) {
      const iguais = porValor.get(saldo) || [];
      if (iguais.length === 1) {
        const t = iguais[0];
        const perto = Math.abs(daysBetween(t.vencimento, r.data)) <= 20;
        sugs.push({
          titulo_ids: [t.id], valor_centavos: saldo, cliente_id: t.cliente_id, cliente_nome: t.cliente_nome,
          confianca: 'baixa', motivo: perto ? 'Único título com exatamente este valor (vencimento próximo)' : 'Único título com exatamente este valor',
        });
      }
    }
    out.set(r.id, sugs.slice(0, 3));
  }
  return out;
}
