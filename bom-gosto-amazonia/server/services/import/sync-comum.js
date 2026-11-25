// Peças comuns da sincronização (planilhas, notas fiscais, relatórios): como reconhecer a "mesma" nota ou o "mesmo" boleto.
import { db } from '../../db.js';
import { fmtBR } from '../../../shared/dates.js';

/** "0793" → "793" */
export const numeroNorm = (n) => String(n ?? '').trim().replace(/^0+(?=\d)/, '');
/** "0793-01" / "793-1" → "793-01" ; "821" → "821" */
export const docNorm = (d) => String(d ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '').replace(/-0*(\d+)$/, (_, n) => `-${String(n).padStart(2, '0')}`);
/** "851-01" → "851" (o número da nota que está por trás do boleto) */
export const docBase = (d) => docNorm(d).replace(/-\d+$/, '');
/** "851-01" → true ; "851" → false */
export const docTemParcela = (d) => /-\d+$/.test(docNorm(d));

/** Acha a dívida certa entre as de mesmo documento. Cancelada só conta quando a planilha também a mostra como cancelada. */
export const escolher = (lista, clienteId, incluirCancelados = false) => {
  const l = (lista || []).filter((t) => incluirCancelados || !t.cancelado);
  return l.find((t) => clienteId && t.cliente_id === clienteId) || l[0] || null;
};

/** O que mudaria numa dívida/parcela existente `t` se aplicássemos "alvo" (situação vinda do arquivo). */
export function mudancasDoTitulo(t, alvo) {
  const m = [];
  const aberto = t.valor_centavos - (t.pago_centavos || 0);
  if (alvo.situacao === 'pago' && aberto > 0) m.push({ tipo: 'pagar', texto: `marcar como paga em ${fmtBR(alvo.data_pagamento)}` });
  if (alvo.situacao === 'cancelado' && !t.cancelado && !(t.pago_centavos > 0)) m.push({ tipo: 'cancelar', texto: 'cancelar (baixa a pedido do cedente)' });
  if (t.cancelado) return m; // dívida já cancelada no painel: nada mais a mudar
  if (alvo.situacao === 'aberto' && aberto > 0 && alvo.vencimento && alvo.vencimento !== t.vencimento) m.push({ tipo: 'vencimento', texto: `vencimento ${fmtBR(t.vencimento)} → ${fmtBR(alvo.vencimento)}` });
  return m;
}

/** Anotador das alterações: guarda como a linha estava ANTES da primeira mudança nesta importação (uma vez por registro). */
export function criarDiarioDeAlteracoes(resultado) {
  resultado.alteracoes = [];
  const vistos = new Set();
  return (tabela, id) => {
    const k = `${tabela}:${id}`;
    if (!id || vistos.has(k)) return;
    vistos.add(k);
    const linha = db.get(`SELECT * FROM ${tabela} WHERE id = ?`, id);
    if (!linha) return;
    const reg = { tabela, id, antes: linha };
    if (tabela === 'vendas') reg.itens = db.all('SELECT * FROM venda_itens WHERE venda_id = ?', id);
    resultado.alteracoes.push(reg);
  };
}
