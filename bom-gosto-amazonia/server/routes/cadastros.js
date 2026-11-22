// Cadastros: vendedores, clientes e produtos.
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, scopeOf, audit, hashPassword, checkPasswordRules, destroyUserSessions } from '../auth.js';
import { bad, conflict, notFound, str, int, num, cents, flag, paging, likeTerm } from '../lib/http.js';
import { norm, digits } from '../../shared/text.js';
import { criarCliente, criarProduto } from '../services/entities.js';
import { saldosEstoque, hojeEmpresa } from '../services/metrics.js';

export const router = Router();
router.use(requireAuth);

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ======================= VENDEDORES =======================
router.get('/vendedores', (req, res) => {
  if (req.user.papel !== 'admin') {
    return res.json(db.all('SELECT id, nome, telefone, email, comissao_pct, ativo FROM vendedores WHERE id = ?', req.user.vendedor_id));
  }
  const hoje = hojeEmpresa();
  res.json(
    db.all(
      `SELECT v.*, u.id AS usuario_id, u.email AS usuario_email, u.ativo AS usuario_ativo, u.ultimo_login,
        (SELECT COUNT(*) FROM clientes c WHERE c.vendedor_id = v.id AND c.ativo = 1) AS clientes,
        COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos t WHERE t.vendedor_id = v.id AND t.cancelado = 0 AND t.valor_centavos > t.pago_centavos),0) AS em_aberto_centavos,
        COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos t WHERE t.vendedor_id = v.id AND t.cancelado = 0 AND t.valor_centavos > t.pago_centavos AND t.vencimento < ?),0) AS vencido_centavos
       FROM vendedores v LEFT JOIN usuarios u ON u.vendedor_id = v.id
       ORDER BY v.ativo DESC, v.nome COLLATE NOCASE`,
      hoje,
    ),
  );
});

router.post('/vendedores', requireAdmin, async (req, res) => {
  const nome = str(req.body.nome, { required: true, name: 'nome', max: 120 });
  const telefone = str(req.body.telefone, { max: 30 });
  const email = str(req.body.email, { max: 160 })?.toLowerCase() || null;
  const comissao = num(req.body.comissao_pct ?? 0, { min: 0, max: 100, name: 'comissão' }) ?? 0;
  const criarAcesso = flag(req.body.criar_acesso);
  if (criarAcesso) {
    if (!email || !emailOk(email)) throw bad('Para criar o acesso, informe um e-mail válido.');
    checkPasswordRules(req.body.senha);
    if (db.get('SELECT 1 FROM usuarios WHERE email = ?', email)) throw conflict('Já existe um usuário com este e-mail.');
  }
  const senhaHash = criarAcesso ? await hashPassword(req.body.senha) : null;
  const vendedorId = db.tx(() => {
    const v = db.run(
      'INSERT INTO vendedores (nome, nome_norm, telefone, email, comissao_pct, observacoes) VALUES (?,?,?,?,?,?)',
      nome, norm(nome), telefone, email, comissao, str(req.body.observacoes, { max: 500 }),
    ).id;
    if (criarAcesso) db.run('INSERT INTO usuarios (nome, email, senha_hash, papel, vendedor_id, trocar_senha) VALUES (?,?,?,?,?,1)', nome, email, senhaHash, 'vendedor', v);
    return v;
  });
  audit(req, 'Cadastrou vendedor', 'vendedor', vendedorId, { nome, acesso: criarAcesso });
  res.status(201).json({ id: vendedorId });
});

router.put('/vendedores/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const v = db.get('SELECT * FROM vendedores WHERE id = ?', id);
  if (!v) throw notFound('Vendedor não encontrado.');
  const nome = str(req.body.nome ?? v.nome, { required: true, name: 'nome', max: 120 });
  const ativo = req.body.ativo === undefined ? v.ativo : flag(req.body.ativo) ? 1 : 0;
  db.tx(() => {
    db.run(
      'UPDATE vendedores SET nome=?, nome_norm=?, telefone=?, email=?, comissao_pct=?, ativo=?, observacoes=? WHERE id=?',
      nome, norm(nome), str(req.body.telefone ?? v.telefone, { max: 30 }), str(req.body.email ?? v.email, { max: 160 })?.toLowerCase() || null,
      num(req.body.comissao_pct ?? v.comissao_pct, { min: 0, max: 100, name: 'comissão' }), ativo, str(req.body.observacoes ?? v.observacoes, { max: 500 }), id,
    );
    if (!ativo) {
      db.run('UPDATE usuarios SET ativo = 0 WHERE vendedor_id = ?', id);
      for (const u of db.all('SELECT id FROM usuarios WHERE vendedor_id = ?', id)) destroyUserSessions(u.id);
    }
  });
  audit(req, 'Alterou vendedor', 'vendedor', id, { nome, ativo });
  res.json({ ok: true });
});

router.delete('/vendedores/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const usado = db.get(
    `SELECT (SELECT COUNT(*) FROM vendas WHERE vendedor_id=@i) + (SELECT COUNT(*) FROM titulos WHERE vendedor_id=@i) + (SELECT COUNT(*) FROM clientes WHERE vendedor_id=@i)
          + (SELECT COUNT(*) FROM recebimentos WHERE vendedor_id=@i) + (SELECT COUNT(*) FROM estoque_movimentos WHERE vendedor_id=@i) AS n`,
    { i: id },
  ).n;
  if (usado > 0) throw conflict('Este vendedor tem histórico (vendas, clientes ou retiradas). Em vez de excluir, desative-o.');
  db.tx(() => {
    db.run('DELETE FROM usuarios WHERE vendedor_id = ?', id);
    db.run('DELETE FROM vendedores WHERE id = ?', id);
  });
  audit(req, 'Excluiu vendedor', 'vendedor', id);
  res.json({ ok: true });
});

// ======================= CLIENTES =======================
const SQL_CLIENTES = (hojeParam) => `
  SELECT c.*, v.nome AS vendedor_nome,
    COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos t WHERE t.cliente_id = c.id AND t.cancelado = 0 AND t.valor_centavos > t.pago_centavos),0) AS aberto_centavos,
    COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos t WHERE t.cliente_id = c.id AND t.cancelado = 0 AND t.valor_centavos > t.pago_centavos AND t.vencimento < ${hojeParam}),0) AS vencido_centavos,
    (SELECT MAX(data) FROM vendas WHERE cliente_id = c.id AND status = 'ativa') AS ultima_compra
  FROM clientes c LEFT JOIN vendedores v ON v.id = c.vendedor_id`;

router.get('/clientes', (req, res) => {
  const sc = scopeOf(req);
  const { limite, offset, pagina } = paging(req.query);
  const where = [];
  const params = [];
  if (sc.vendedorId) { where.push('vendedor_id = ?'); params.push(sc.vendedorId); }
  if (!flag(req.query.inativos)) where.push('ativo = 1');
  if (req.query.busca) {
    const n = norm(req.query.busca);
    const d = digits(req.query.busca);
    const parts = ["nome_norm LIKE ? ESCAPE '\\'"];
    params.push(likeTerm(n));
    if (d.length >= 3) { parts.push("documento LIKE ? ESCAPE '\\'", "REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(telefone,''),'(',''),')',''),'-',''),' ','') LIKE ? ESCAPE '\\'"); params.push(likeTerm(d), likeTerm(d)); }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (flag(req.query.devedores)) where.push('aberto_centavos > 0');
  const ordem = { nome: 'nome_norm', aberto: 'aberto_centavos DESC', ultima_compra: 'ultima_compra DESC' }[req.query.ordem] || 'nome_norm';
  const base = `SELECT * FROM (${SQL_CLIENTES('?')}) ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const hoje = hojeEmpresa();
  const total = db.get(`SELECT COUNT(*) AS n FROM (${base})`, hoje, ...params).n;
  const itens = db.all(`${base} ORDER BY ${ordem} LIMIT ? OFFSET ?`, hoje, ...params, limite, offset);
  res.json({ itens, total, pagina, limite });
});

function clienteVisivel(req, id) {
  const c = db.get('SELECT * FROM clientes WHERE id = ?', id);
  if (!c) throw notFound('Cliente não encontrado.');
  if (req.user.papel !== 'admin' && c.vendedor_id !== req.user.vendedor_id) throw notFound('Cliente não encontrado.');
  return c;
}

router.get('/clientes/:id', (req, res) => {
  const c = clienteVisivel(req, int(req.params.id, { required: true }));
  const hoje = hojeEmpresa();
  const titulos = db.all('SELECT * FROM v_titulos WHERE cliente_id = ? AND cancelado = 0 ORDER BY vencimento DESC LIMIT 200', c.id);
  const aberto = titulos.reduce((s, t) => s + Math.max(t.valor_centavos - t.pago_centavos, 0), 0);
  const vencido = titulos.filter((t) => t.vencimento < hoje).reduce((s, t) => s + Math.max(t.valor_centavos - t.pago_centavos, 0), 0);
  res.json({
    cliente: c,
    vendedor_nome: c.vendedor_id ? db.get('SELECT nome FROM vendedores WHERE id = ?', c.vendedor_id)?.nome : null,
    totais: { aberto_centavos: aberto, vencido_centavos: vencido, comprado_centavos: db.get("SELECT COALESCE(SUM(total_centavos),0) AS t FROM vendas WHERE cliente_id = ? AND status='ativa'", c.id).t },
    vendas: db.all("SELECT id, numero, data, total_centavos, forma_pagamento, status FROM vendas WHERE cliente_id = ? ORDER BY data DESC, id DESC LIMIT 30", c.id),
    titulos,
    recebimentos: db.all('SELECT id, data, valor_centavos, forma, status FROM recebimentos WHERE cliente_id = ? ORDER BY data DESC, id DESC LIMIT 30', c.id),
  });
});

function dadosCliente(body, atual = {}) {
  return {
    nome: str(body.nome ?? atual.nome, { required: true, name: 'nome', max: 160 }),
    documento: digits(body.documento ?? atual.documento) || null,
    telefone: str(body.telefone ?? atual.telefone, { max: 30 }),
    email: str(body.email ?? atual.email, { max: 160 }),
    endereco: str(body.endereco ?? atual.endereco, { max: 250 }),
    cidade: str(body.cidade ?? atual.cidade, { max: 100 }),
    observacoes: str(body.observacoes ?? atual.observacoes, { max: 500 }),
  };
}

router.post('/clientes', (req, res) => {
  const d = dadosCliente(req.body);
  let vendedorId = int(req.body.vendedor_id, { name: 'vendedor' });
  if (req.user.papel !== 'admin') vendedorId = req.user.vendedor_id;
  if (vendedorId && !db.get('SELECT 1 FROM vendedores WHERE id = ?', vendedorId)) throw bad('Vendedor não encontrado.');
  const id = criarCliente({ ...d, vendedor_id: vendedorId });
  audit(req, 'Cadastrou cliente', 'cliente', id, { nome: d.nome });
  res.status(201).json({ id });
});

router.put('/clientes/:id', (req, res) => {
  const id = int(req.params.id, { required: true });
  const c = clienteVisivel(req, id);
  const d = dadosCliente(req.body, c);
  let vendedorId = req.body.vendedor_id === undefined ? c.vendedor_id : int(req.body.vendedor_id, { name: 'vendedor' });
  if (req.user.papel !== 'admin') vendedorId = c.vendedor_id; // vendedor não troca a carteira
  const ativo = req.body.ativo === undefined || req.user.papel !== 'admin' ? c.ativo : flag(req.body.ativo) ? 1 : 0;
  db.run(
    'UPDATE clientes SET nome=?, nome_norm=?, documento=?, telefone=?, email=?, endereco=?, cidade=?, vendedor_id=?, observacoes=?, ativo=? WHERE id=?',
    d.nome, norm(d.nome), d.documento, d.telefone, d.email, d.endereco, d.cidade, vendedorId, d.observacoes, ativo, id,
  );
  audit(req, 'Alterou cliente', 'cliente', id, { nome: d.nome });
  res.json({ ok: true });
});

router.delete('/clientes/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const usado = db.get(
    'SELECT (SELECT COUNT(*) FROM vendas WHERE cliente_id=@i) + (SELECT COUNT(*) FROM titulos WHERE cliente_id=@i) + (SELECT COUNT(*) FROM recebimentos WHERE cliente_id=@i) AS n',
    { i: id },
  ).n;
  if (usado > 0) throw conflict('Este cliente tem vendas ou títulos. Desative-o ou use "Mesclar" para juntar com outro cadastro.');
  db.run('DELETE FROM clientes WHERE id = ?', id);
  audit(req, 'Excluiu cliente', 'cliente', id);
  res.json({ ok: true });
});

router.post('/clientes/:id/mesclar', requireAdmin, (req, res) => {
  const origem = int(req.params.id, { required: true });
  const destino = int(req.body.destino_id, { required: true, name: 'cliente de destino' });
  if (origem === destino) throw bad('Escolha um cliente diferente.');
  const a = db.get('SELECT * FROM clientes WHERE id = ?', origem);
  const b = db.get('SELECT * FROM clientes WHERE id = ?', destino);
  if (!a || !b) throw notFound('Cliente não encontrado.');
  db.tx(() => {
    for (const t of ['vendas', 'titulos', 'recebimentos']) db.run(`UPDATE ${t} SET cliente_id = ? WHERE cliente_id = ?`, destino, origem);
    db.run(
      `UPDATE clientes SET documento = COALESCE(documento, ?), telefone = COALESCE(telefone, ?), email = COALESCE(email, ?),
         endereco = COALESCE(endereco, ?), cidade = COALESCE(cidade, ?), vendedor_id = COALESCE(vendedor_id, ?) WHERE id = ?`,
      a.documento, a.telefone, a.email, a.endereco, a.cidade, a.vendedor_id, destino,
    );
    db.run('DELETE FROM clientes WHERE id = ?', origem);
  });
  audit(req, 'Mesclou clientes', 'cliente', destino, { de: a.nome, para: b.nome });
  res.json({ ok: true });
});

// ======================= PRODUTOS =======================
router.get('/produtos', (req, res) => {
  let lista = saldosEstoque();
  if (!flag(req.query.inativos)) lista = lista.filter((p) => p.ativo);
  if (req.query.busca) {
    const n = norm(req.query.busca);
    lista = lista.filter((p) => norm(p.nome).includes(n) || (p.sku && norm(p.sku).includes(n)));
  }
  if (req.user.papel !== 'admin') lista = lista.map(({ custo_centavos, ...p }) => p); // vendedor não vê custo
  res.json(lista);
});

function dadosProduto(body, atual = {}) {
  return {
    nome: str(body.nome ?? atual.nome, { required: true, name: 'nome', max: 160 }),
    sku: str(body.sku ?? atual.sku, { max: 60 }),
    unidade: str(body.unidade ?? atual.unidade ?? 'un', { max: 12 }) || 'un',
    preco_centavos: cents(body.preco_centavos ?? atual.preco_centavos ?? 0, { name: 'preço' }) ?? 0,
    custo_centavos: cents(body.custo_centavos ?? atual.custo_centavos ?? 0, { name: 'custo' }) ?? 0,
    categoria: str(body.categoria ?? atual.categoria, { max: 60 }),
    estoque_minimo: num(body.estoque_minimo ?? atual.estoque_minimo ?? 0, { min: 0, name: 'estoque mínimo' }) ?? 0,
  };
}

router.post('/produtos', requireAdmin, (req, res) => {
  const d = dadosProduto(req.body);
  const id = criarProduto(d);
  audit(req, 'Cadastrou produto', 'produto', id, { nome: d.nome });
  res.status(201).json({ id });
});

router.put('/produtos/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const p = db.get('SELECT * FROM produtos WHERE id = ?', id);
  if (!p) throw notFound('Produto não encontrado.');
  const d = dadosProduto(req.body, p);
  const ativo = req.body.ativo === undefined ? p.ativo : flag(req.body.ativo) ? 1 : 0;
  db.run(
    'UPDATE produtos SET nome=?, nome_norm=?, sku=?, unidade=?, preco_centavos=?, custo_centavos=?, categoria=?, estoque_minimo=?, ativo=? WHERE id=?',
    d.nome, norm(d.nome), d.sku, d.unidade, d.preco_centavos, d.custo_centavos, d.categoria, d.estoque_minimo, ativo, id,
  );
  audit(req, 'Alterou produto', 'produto', id, { nome: d.nome });
  res.json({ ok: true });
});

router.delete('/produtos/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const usado = db.get(
    'SELECT (SELECT COUNT(*) FROM venda_itens WHERE produto_id=@i) + (SELECT COUNT(*) FROM estoque_movimentos WHERE produto_id=@i) + (SELECT COUNT(*) FROM ordens_producao WHERE produto_id=@i) AS n',
    { i: id },
  ).n;
  if (usado > 0) throw conflict('Este produto já tem movimentação ou vendas. Desative-o em vez de excluir.');
  db.run('DELETE FROM produtos WHERE id = ?', id);
  audit(req, 'Excluiu produto', 'produto', id);
  res.json({ ok: true });
});
