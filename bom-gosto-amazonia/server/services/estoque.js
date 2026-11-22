// Ajudantes do depósito.
import { db } from '../db.js';
import { round3 } from '../../shared/money.js';

/** Produção registrada sem escolher o plano entra no plano mais antigo ainda aberto do mesmo produto. */
export function ordemAbertaDoProduto(produtoId, data) {
  const o = db.get(
    `SELECT o.id FROM ordens_producao o
     WHERE o.produto_id = ? AND o.cancelada = 0 AND o.data <= ?
       AND o.planejado > COALESCE((SELECT SUM(m.quantidade) FROM estoque_movimentos m WHERE m.ordem_producao_id = o.id AND m.tipo = 'producao'),0)
     ORDER BY o.data, o.id LIMIT 1`,
    produtoId, data,
  );
  return o ? o.id : null;
}

export function saldoProduto(produtoId) {
  return round3(db.get('SELECT COALESCE(SUM(quantidade),0) AS s FROM estoque_movimentos WHERE produto_id = ?', produtoId).s);
}
