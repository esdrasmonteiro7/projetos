// Regras financeiras: vendas, contas a receber (títulos), recebimentos (Pix etc.) e baixas.
import { db } from '../db.js';
import { bad, conflict, notFound } from '../lib/http.js';
import { norm, digits } from '../../shared/text.js';
import { addDays } from '../../shared/dates.js';

export const FORMAS_RECEBIMENTO = ['pix', 'dinheiro', 'cartao', 'boleto', 'transferencia', 'cheque', 'outro'];
export const FORMAS_VENDA = [...FORMAS_RECEBIMENTO, 'prazo'];
export const FORMAS_AVISTA = ['pix', 'dinheiro', 'cartao', 'transferencia'];
export const TIPOS_ESTOQUE = ['entrada', 'producao', 'devolucao', 'ajuste', 'saida', 'venda', 'retirada', 'perda'];
export const SINAL_ESTOQUE = { entrada: 1, producao: 1, devolucao: 1, ajuste: 0, saida: -1, venda: -1, retirada: -1, perda: -1 };

export function statusTitulo(t, hoje) {
  if (t.cancelado) return 'cancelado';
  if (t.valor_centavos - t.pago_centavos <= 0) return 'pago';
  if (t.vencimento < hoje) return 'vencido';
  if (t.pago_centavos > 0) return 'parcial';
  return 'aberto';
}

export function carregarTitulo(id) {
  const t = db.get('SELECT * FROM v_titulos WHERE id = ?', id);
  if (!t) throw notFound('Título não encontrado.');
  return t;
}

// ---------------- Recebimentos ----------------
export function registrarRecebimento(r) {
  if (!(r.valor_centavos > 0)) throw bad('O valor recebido precisa ser maior que zero.');
  try {
    return db.run(
      `INSERT INTO recebimentos (data, valor_centavos, forma, pagador_nome, pagador_norm, pagador_documento, banco, ref_externa,
         cliente_id, vendedor_id, titulo_informado_id, arquivo_id, status, origem, observacoes, importacao_id, criado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.data, r.valor_centavos, r.forma || 'pix', r.pagador_nome || null, norm(r.pagador_nome), digits(r.pagador_documento) || r.pagador_documento || null,
      r.banco || null, r.ref_externa || null, r.cliente_id || null, r.vendedor_id || null, r.titulo_informado_id || null,
      r.arquivo_id || null, r.status || 'confirmado', r.origem || 'manual', r.observacoes || null, r.importacao_id || null, r.user_id || null,
    ).id;
  } catch (e) {
    if (String(e.message).includes('UNIQUE') && String(e.message).includes('ref_externa')) throw conflict('Este pagamento já foi registrado antes (mesmo código de transação).');
    throw e;
  }
}

export function saldoRecebimento(id) {
  const r = db.get('SELECT * FROM v_recebimentos WHERE id = ?', id);
  if (!r) throw notFound('Recebimento não encontrado.');
  return { ...r, saldo_centavos: r.valor_centavos - r.alocado_centavos };
}

/** Aplica (parte de) um recebimento a um título. */
export function registrarBaixa({ titulo_id, recebimento_id, valor_centavos, data, user_id }) {
  const t = carregarTitulo(titulo_id);
  if (t.cancelado) throw bad('Este título está cancelado.');
  const aberto = t.valor_centavos - t.pago_centavos;
  if (aberto <= 0) throw bad('Este título já está pago.');
  const r = saldoRecebimento(recebimento_id);
  if (r.status === 'cancelado') throw bad('Este recebimento foi cancelado.');
  const valor = valor_centavos ?? Math.min(aberto, r.saldo_centavos);
  if (!(valor > 0)) throw bad('Valor da baixa inválido.');
  if (valor > aberto) throw bad(`O valor (${(valor / 100).toFixed(2).replace('.', ',')}) é maior que o saldo em aberto do título (${(aberto / 100).toFixed(2).replace('.', ',')}).`);
  if (valor > r.saldo_centavos) throw bad('O valor é maior que o saldo disponível deste recebimento.');
  return db.run(
    'INSERT INTO baixas (titulo_id, recebimento_id, valor_centavos, data, criado_por) VALUES (?,?,?,?,?)',
    titulo_id, recebimento_id, valor, data || r.data, user_id || null,
  ).id;
}

/** Dar baixa direto: cria o recebimento e já aplica ao título. */
export function baixarDireto({ titulo_id, valor_centavos, data, forma = 'pix', pagador_nome, observacoes, arquivo_id, user_id, origem = 'baixa', ref_externa }) {
  return db.tx(() => {
    const t = carregarTitulo(titulo_id);
    if (t.cancelado) throw bad('Este título está cancelado.');
    const aberto = t.valor_centavos - t.pago_centavos;
    if (aberto <= 0) throw bad('Este título já está pago.');
    const valor = valor_centavos ?? aberto;
    if (valor > aberto) throw bad('O valor é maior que o saldo em aberto do título.');
    const cli = t.cliente_id ? db.get('SELECT nome FROM clientes WHERE id = ?', t.cliente_id) : null;
    const rid = registrarRecebimento({
      data, valor_centavos: valor, forma, pagador_nome: pagador_nome || cli?.nome || null, cliente_id: t.cliente_id,
      vendedor_id: t.vendedor_id, arquivo_id, observacoes, origem, user_id, ref_externa, status: 'confirmado',
    });
    const bid = registrarBaixa({ titulo_id, recebimento_id: rid, valor_centavos: valor, data, user_id });
    return { recebimento_id: rid, baixa_id: bid, valor_centavos: valor };
  });
}

/** Aplica um recebimento já existente a vários títulos. */
export function alocarRecebimento(recebimento_id, alocacoes, user_id) {
  if (!Array.isArray(alocacoes) || !alocacoes.length) throw bad('Escolha pelo menos um título.');
  return db.tx(() => {
    const r = saldoRecebimento(recebimento_id);
    if (r.status === 'pendente') throw bad('Confirme o recebimento antes de dar baixa.');
    let restante = r.saldo_centavos;
    const ids = [];
    for (const a of alocacoes) {
      const t = carregarTitulo(a.titulo_id);
      const aberto = t.valor_centavos - t.pago_centavos;
      const valor = a.valor_centavos ?? Math.min(aberto, restante);
      if (valor <= 0) continue;
      if (valor > restante) throw bad('A soma das baixas passa do valor recebido.');
      ids.push(registrarBaixa({ titulo_id: a.titulo_id, recebimento_id, valor_centavos: valor, data: r.data, user_id }));
      restante -= valor;
    }
    if (!ids.length) throw bad('Nada para baixar.');
    // o recebimento passa a pertencer ao cliente/vendedor dos títulos quando ainda não tem
    const t0 = carregarTitulo(alocacoes[0].titulo_id);
    db.run('UPDATE recebimentos SET cliente_id = COALESCE(cliente_id, ?), vendedor_id = COALESCE(vendedor_id, ?) WHERE id = ?', t0.cliente_id, t0.vendedor_id, recebimento_id);
    return ids;
  });
}

/** Desfaz uma baixa (estorno). Se o recebimento foi criado só para ela, remove também. */
export function estornarBaixa(baixa_id) {
  return db.tx(() => {
    const b = db.get('SELECT * FROM baixas WHERE id = ?', baixa_id);
    if (!b) throw notFound('Baixa não encontrada.');
    db.run('DELETE FROM baixas WHERE id = ?', baixa_id);
    const r = db.get('SELECT * FROM v_recebimentos WHERE id = ?', b.recebimento_id);
    if (r && r.origem === 'baixa' && r.alocado_centavos === 0) db.run('DELETE FROM recebimentos WHERE id = ?', r.id);
    return b;
  });
}

/** Admin confirma um pagamento informado pelo vendedor (e dá baixa no título indicado). */
export function confirmarPendente(recebimento_id, user_id) {
  return db.tx(() => {
    const r = db.get('SELECT * FROM v_recebimentos WHERE id = ?', recebimento_id);
    if (!r) throw notFound('Recebimento não encontrado.');
    if (r.status !== 'pendente') throw bad('Este pagamento não está pendente.');
    db.run("UPDATE recebimentos SET status = 'confirmado' WHERE id = ?", recebimento_id);
    if (r.titulo_informado_id) {
      const t = db.get('SELECT * FROM v_titulos WHERE id = ?', r.titulo_informado_id);
      if (t && !t.cancelado && t.valor_centavos > t.pago_centavos) {
        registrarBaixa({
          titulo_id: t.id, recebimento_id, valor_centavos: Math.min(r.valor_centavos, t.valor_centavos - t.pago_centavos), data: r.data, user_id,
        });
      }
    }
    return true;
  });
}

// ---------------- Vendas ----------------
export function criarVenda(inp, ctx = {}) {
  const itens = (inp.itens || []).map((i, idx) => {
    const quantidade = Number(i.quantidade);
    if (!(quantidade > 0)) throw bad(`Item ${idx + 1}: informe a quantidade.`);
    const preco = Math.round(Number(i.preco_centavos) || 0);
    if (!i.descricao || !String(i.descricao).trim()) throw bad(`Item ${idx + 1}: informe o produto.`);
    return {
      produto_id: i.produto_id || null,
      descricao: String(i.descricao).trim().slice(0, 200),
      quantidade,
      unidade: i.unidade || null,
      preco_centavos: preco,
      total_centavos: i.total_centavos != null ? Math.round(i.total_centavos) : Math.round(quantidade * preco),
    };
  });
  const subtotal = itens.reduce((s, i) => s + i.total_centavos, 0);
  const desconto = Math.round(inp.desconto_centavos || 0);
  const total = inp.total_centavos != null ? Math.round(inp.total_centavos) : subtotal - desconto;
  if (!(total > 0)) throw bad('O total da venda precisa ser maior que zero.');

  let parcelas = (inp.parcelas || []).map((p) => ({ vencimento: p.vencimento, valor_centavos: Math.round(p.valor_centavos), documento: p.documento || null }));
  if (!parcelas.length) {
    const venc = inp.vencimento || (inp.forma_pagamento === 'prazo' ? addDays(inp.data, 30) : inp.data);
    parcelas = [{ vencimento: venc, valor_centavos: total, documento: null }];
  } else if (inp.validar_parcelas !== false) {
    const soma = parcelas.reduce((s, p) => s + p.valor_centavos, 0);
    if (soma !== total) throw bad('A soma das parcelas é diferente do total da venda.');
  }
  for (const p of parcelas) if (!p.vencimento || !(p.valor_centavos > 0)) throw bad('Há parcela com vencimento ou valor inválido.');

  return db.tx(() => {
    let vendaId;
    try {
      vendaId = db.run(
        `INSERT INTO vendas (numero, data, cliente_id, vendedor_id, total_centavos, desconto_centavos, forma_pagamento, origem, chave_nfe, observacoes, importacao_id, criado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        inp.numero || null, inp.data, inp.cliente_id || null, inp.vendedor_id || null, total, desconto, inp.forma_pagamento || null,
        inp.origem || 'manual', inp.chave_nfe || null, inp.observacoes || null, inp.importacao_id || null, ctx.user_id || null,
      ).id;
    } catch (e) {
      if (String(e.message).includes('chave_nfe')) throw conflict('Esta nota fiscal já foi lançada.');
      throw e;
    }
    for (const i of itens) {
      db.run(
        'INSERT INTO venda_itens (venda_id, produto_id, descricao, quantidade, unidade, preco_centavos, total_centavos) VALUES (?,?,?,?,?,?,?)',
        vendaId, i.produto_id, i.descricao, i.quantidade, i.unidade, i.preco_centavos, i.total_centavos,
      );
      if (inp.baixar_estoque && i.produto_id) {
        db.run(
          `INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, vendedor_id, valor_unit_centavos, venda_id, criado_por, importacao_id)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          inp.data, i.produto_id, 'venda', -i.quantidade, inp.vendedor_id || null, i.preco_centavos, vendaId, ctx.user_id || null, inp.importacao_id || null,
        );
      }
    }
    const titulos = [];
    parcelas.forEach((p, idx) => {
      titulos.push(
        db.run(
          `INSERT INTO titulos (venda_id, cliente_id, vendedor_id, documento, parcela, descricao, emissao, vencimento, valor_centavos, origem, importacao_id, criado_por)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          vendaId, inp.cliente_id || null, inp.vendedor_id || null, p.documento || inp.numero || null,
          parcelas.length > 1 ? `${idx + 1}/${parcelas.length}` : null, inp.descricao_titulo || null, inp.data, p.vencimento,
          p.valor_centavos, inp.origem || 'manual', inp.importacao_id || null, ctx.user_id || null,
        ).id,
      );
    });

    let recebimentoId = null;
    const somaParcelas = parcelas.reduce((s, p) => s + p.valor_centavos, 0);
    const valorPago = inp.pago ? somaParcelas : Math.min(Math.max(Math.round(inp.pago_centavos || 0), 0), somaParcelas);
    if (valorPago > 0) {
      const dataPg = inp.data_pagamento || inp.data;
      const forma = FORMAS_RECEBIMENTO.includes(inp.forma_pagamento) ? inp.forma_pagamento : 'outro';
      const cli = inp.cliente_id ? db.get('SELECT nome FROM clientes WHERE id = ?', inp.cliente_id) : null;
      recebimentoId = registrarRecebimento({
        data: dataPg, valor_centavos: valorPago, forma, pagador_nome: cli?.nome || null, cliente_id: inp.cliente_id, vendedor_id: inp.vendedor_id,
        origem: 'baixa', importacao_id: inp.importacao_id, user_id: ctx.user_id, observacoes: inp.numero ? `Venda ${inp.numero}` : null,
      });
      let resto = valorPago; // aplica do primeiro vencimento para o último
      titulos.forEach((tid, idx) => {
        const v = Math.min(resto, parcelas[idx].valor_centavos);
        if (v > 0) registrarBaixa({ titulo_id: tid, recebimento_id: recebimentoId, valor_centavos: v, data: dataPg, user_id: ctx.user_id });
        resto -= v;
      });
    }
    return { venda_id: vendaId, titulos, recebimento_id: recebimentoId, total_centavos: total };
  });
}

/** Cancela uma venda e seus títulos (os recebimentos continuam, ficando sem baixa). */
export function cancelarVenda(id) {
  return db.tx(() => {
    const v = db.get('SELECT * FROM vendas WHERE id = ?', id);
    if (!v) throw notFound('Venda não encontrada.');
    if (v.status === 'cancelada') throw bad('Esta venda já está cancelada.');
    const recs = db.all(
      'SELECT DISTINCT recebimento_id AS id FROM baixas WHERE titulo_id IN (SELECT id FROM titulos WHERE venda_id = ?)', id,
    );
    db.run("UPDATE vendas SET status = 'cancelada' WHERE id = ?", id);
    db.run('UPDATE titulos SET cancelado = 1 WHERE venda_id = ?', id);
    db.run('DELETE FROM baixas WHERE titulo_id IN (SELECT id FROM titulos WHERE venda_id = ?)', id);
    // recebimentos criados automaticamente só para pagar esta venda saem junto; os demais (ex.: Pix real) ficam para conciliar
    for (const r of recs) {
      db.run("DELETE FROM recebimentos WHERE id = ? AND origem = 'baixa' AND NOT EXISTS (SELECT 1 FROM baixas WHERE recebimento_id = ?)", r.id, r.id);
    }
    return v;
  });
}
