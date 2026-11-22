// Depósito: movimentação de estoque (entrada/saída/retirada/perda), produção planejada x produzida.
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, scopeOf, audit } from '../auth.js';
import { bad, notFound, str, int, num, cents, date, oneOf, paging, ym as ymParam } from '../lib/http.js';
import { monthBounds } from '../../shared/dates.js';
import { round3 } from '../../shared/money.js';
import { TIPOS_ESTOQUE, SINAL_ESTOQUE } from '../services/finance.js';
import { hojeEmpresa, resumoDeposito, saldosEstoque, movimentoPorProduto } from '../services/metrics.js';
import { ordemAbertaDoProduto } from '../services/estoque.js';

export const router = Router();
router.use(requireAuth);

const mesAtualOuParam = (req) => ymParam(req.query.mes, hojeEmpresa().slice(0, 7));

// ---------- resumo do mês + tabela por produto ----------
router.get('/estoque/resumo', requireAdmin, (req, res) => {
  const ym = mesAtualOuParam(req);
  res.json({ mes: ym, resumo: resumoDeposito(ym), por_produto: movimentoPorProduto(ym) });
});

router.get('/estoque/saldos', requireAdmin, (_req, res) => res.json(saldosEstoque()));

// ---------- movimentações ----------
router.get('/estoque/movimentos', (req, res) => {
  const sc = scopeOf(req);
  const { limite, offset, pagina } = paging(req.query, { max: 500, def: 100 });
  const where = [];
  const params = [];
  if (!sc.admin) { where.push('m.vendedor_id = ?'); params.push(sc.vendedorId); }
  else if (sc.vendedorId) { where.push('m.vendedor_id = ?'); params.push(sc.vendedorId); }
  if (req.query.mes) {
    const { inicio, fim } = monthBounds(ymParam(req.query.mes));
    where.push('m.data BETWEEN ? AND ?');
    params.push(inicio, fim);
  }
  if (req.query.produto_id) { where.push('m.produto_id = ?'); params.push(int(req.query.produto_id)); }
  if (req.query.tipo) { where.push('m.tipo = ?'); params.push(oneOf(req.query.tipo, TIPOS_ESTOQUE)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM estoque_movimentos m ${w}`, ...params).n;
  const itens = db.all(
    `SELECT m.*, p.nome AS produto_nome, p.unidade, ve.nome AS vendedor_nome
     FROM estoque_movimentos m JOIN produtos p ON p.id = m.produto_id LEFT JOIN vendedores ve ON ve.id = m.vendedor_id
     ${w} ORDER BY m.data DESC, m.id DESC LIMIT ? OFFSET ?`,
    ...params, limite, offset,
  );
  res.json({ itens, total, pagina, limite });
});

router.post('/estoque/movimentos', requireAdmin, (req, res) => {
  const b = req.body || {};
  const tipo = oneOf(b.tipo, TIPOS_ESTOQUE, { required: true, name: 'tipo de movimentação' });
  const produtoId = int(b.produto_id, { required: true, name: 'produto' });
  const produto = db.get('SELECT * FROM produtos WHERE id = ?', produtoId);
  if (!produto) throw bad('Produto não encontrado.');
  const q = num(b.quantidade, { min: 0.001, required: true, name: 'quantidade' });
  let sinal = SINAL_ESTOQUE[tipo];
  if (tipo === 'ajuste') sinal = b.sinal === '-' ? -1 : 1;
  const vendedorId = int(b.vendedor_id, { name: 'vendedor' });
  if (tipo === 'retirada' && !vendedorId) throw bad('Escolha o vendedor que está retirando.');
  if (vendedorId && !db.get('SELECT 1 FROM vendedores WHERE id = ?', vendedorId)) throw bad('Vendedor não encontrado.');
  const delta = round3(sinal * q);
  const antes = db.get('SELECT COALESCE(SUM(quantidade),0) AS s FROM estoque_movimentos WHERE produto_id = ?', produtoId).s;
  const dataMov = date(b.data || hojeEmpresa(), { required: true, name: 'data' });
  let ordemId = int(b.ordem_producao_id);
  if (tipo === 'producao' && !ordemId) ordemId = ordemAbertaDoProduto(produtoId, dataMov);
  if (tipo !== 'producao') ordemId = null;
  const id = db.run(
    `INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, vendedor_id, valor_unit_centavos, ordem_producao_id, observacoes, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    dataMov, produtoId, tipo, delta, vendedorId,
    cents(b.valor_unit_centavos ?? produto.preco_centavos, { name: 'valor unitário' }) ?? 0, ordemId, str(b.observacoes, { max: 300 }), req.user.id,
  ).id;
  audit(req, `Movimentou estoque (${tipo})`, 'estoque', id, { produto: produto.nome, quantidade: delta });
  const saldo = round3(antes + delta);
  res.status(201).json({ id, saldo, aviso: saldo < 0 ? `Atenção: o estoque de "${produto.nome}" ficou negativo (${saldo}).` : null });
});

router.delete('/estoque/movimentos/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  if (!db.run('DELETE FROM estoque_movimentos WHERE id = ?', id).changes) throw notFound('Movimentação não encontrada.');
  audit(req, 'Excluiu movimentação de estoque', 'estoque', id);
  res.json({ ok: true });
});

// ---------- retiradas por vendedor ----------
router.get('/estoque/retiradas', (req, res) => {
  const sc = scopeOf(req);
  const ym = mesAtualOuParam(req);
  const { inicio, fim } = monthBounds(ym);
  const filtro = sc.vendedorId ? 'WHERE ve.id = @v' : 'WHERE ve.ativo = 1 OR EXISTS (SELECT 1 FROM estoque_movimentos x WHERE x.vendedor_id = ve.id)';
  const params = { ini: inicio, fim, ...(sc.vendedorId ? { v: sc.vendedorId } : {}) };
  const itens = db.all(
    `SELECT ve.id AS vendedor_id, ve.nome,
      COALESCE(SUM(CASE WHEN m.tipo='retirada' AND m.data BETWEEN @ini AND @fim THEN -m.quantidade END),0) AS retirado_mes,
      COALESCE(SUM(CASE WHEN m.tipo='retirada' AND m.data BETWEEN @ini AND @fim THEN -m.quantidade * m.valor_unit_centavos END),0) AS valor_mes_centavos,
      COUNT(DISTINCT CASE WHEN m.tipo='retirada' AND m.data BETWEEN @ini AND @fim THEN m.id END) AS retiradas_qtd,
      COALESCE(SUM(CASE WHEN m.tipo='devolucao' AND m.data BETWEEN @ini AND @fim THEN m.quantidade END),0) AS devolvido_mes,
      COALESCE(SUM(CASE WHEN m.tipo IN ('retirada','devolucao') THEN -m.quantidade END),0) AS em_maos
     FROM vendedores ve LEFT JOIN estoque_movimentos m ON m.vendedor_id = ve.id AND m.tipo IN ('retirada','devolucao')
     ${filtro} GROUP BY ve.id ORDER BY retirado_mes DESC, ve.nome COLLATE NOCASE`,
    params,
  ).map((r) => ({ ...r, retirado_mes: round3(r.retirado_mes), devolvido_mes: round3(r.devolvido_mes), em_maos: round3(r.em_maos) }));
  res.json({ mes: ym, itens });
});

// ---------- produção ----------
function statusOrdem(o, hoje) {
  if (o.cancelada) return 'cancelada';
  if (o.produzido >= o.planejado) return 'concluida';
  if (o.produzido > 0) return 'parcial';
  return o.data < hoje ? 'nao_produzida' : 'planejada';
}

router.get('/producao', requireAdmin, (req, res) => {
  const ym = mesAtualOuParam(req);
  const { inicio, fim } = monthBounds(ym);
  const hoje = hojeEmpresa();
  const itens = db.all(
    `SELECT o.*, p.nome AS produto_nome, p.unidade,
      COALESCE((SELECT SUM(m.quantidade) FROM estoque_movimentos m WHERE m.ordem_producao_id = o.id AND m.tipo = 'producao'),0) AS produzido
     FROM ordens_producao o JOIN produtos p ON p.id = o.produto_id
     WHERE o.data BETWEEN ? AND ? ORDER BY o.data DESC, o.id DESC`,
    inicio, fim,
  ).map((o) => ({ ...o, produzido: round3(o.produzido), faltou: o.cancelada ? 0 : round3(Math.max(o.planejado - o.produzido, 0)), status: statusOrdem({ ...o, produzido: round3(o.produzido) }, hoje) }));
  res.json({ mes: ym, itens });
});

router.post('/producao', requireAdmin, (req, res) => {
  const b = req.body || {};
  const produtoId = int(b.produto_id, { required: true, name: 'produto' });
  if (!db.get('SELECT 1 FROM produtos WHERE id = ?', produtoId)) throw bad('Produto não encontrado.');
  const id = db.run(
    'INSERT INTO ordens_producao (data, produto_id, planejado, observacoes, criado_por) VALUES (?,?,?,?,?)',
    date(b.data || hojeEmpresa(), { required: true, name: 'data' }), produtoId, num(b.planejado, { min: 0.001, required: true, name: 'quantidade planejada' }),
    str(b.observacoes, { max: 300 }), req.user.id,
  ).id;
  audit(req, 'Planejou produção', 'producao', id);
  res.status(201).json({ id });
});

router.put('/producao/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const o = db.get('SELECT * FROM ordens_producao WHERE id = ?', id);
  if (!o) throw notFound('Ordem de produção não encontrada.');
  const b = req.body || {};
  db.run(
    'UPDATE ordens_producao SET data=?, produto_id=?, planejado=?, observacoes=? WHERE id=?',
    date(b.data ?? o.data, { required: true }), int(b.produto_id ?? o.produto_id), num(b.planejado ?? o.planejado, { min: 0.001, name: 'quantidade planejada' }), str(b.observacoes ?? o.observacoes, { max: 300 }), id,
  );
  audit(req, 'Alterou produção planejada', 'producao', id);
  res.json({ ok: true });
});

router.post('/producao/:id/produzir', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const o = db.get('SELECT * FROM ordens_producao WHERE id = ?', id);
  if (!o) throw notFound('Ordem de produção não encontrada.');
  if (o.cancelada) throw bad('Esta produção foi cancelada.');
  const q = num(req.body.quantidade, { min: 0.001, required: true, name: 'quantidade produzida' });
  const mid = db.run(
    `INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, ordem_producao_id, observacoes, criado_por)
     VALUES (?,?,?,?,?,?,?)`,
    date(req.body.data || hojeEmpresa(), { required: true, name: 'data' }), o.produto_id, 'producao', q, id, str(req.body.observacoes, { max: 300 }), req.user.id,
  ).id;
  audit(req, 'Registrou produção realizada', 'producao', id, { quantidade: q });
  res.status(201).json({ id: mid });
});

router.post('/producao/:id/cancelar', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  if (!db.run('UPDATE ordens_producao SET cancelada = 1 WHERE id = ?', id).changes) throw notFound('Ordem de produção não encontrada.');
  audit(req, 'Cancelou produção planejada', 'producao', id);
  res.json({ ok: true });
});

router.delete('/producao/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  db.tx(() => {
    db.run('DELETE FROM estoque_movimentos WHERE ordem_producao_id = ? AND tipo = \'producao\'', id);
    db.run('DELETE FROM ordens_producao WHERE id = ?', id);
  });
  audit(req, 'Excluiu produção planejada', 'producao', id);
  res.json({ ok: true });
});
