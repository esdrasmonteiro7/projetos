// Vendas, contas a receber (devedores), recebimentos (Pix) e conciliação.
import { Router } from 'express';
import multer from 'multer';
import { db, getSettings } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin, scopeOf, audit } from '../auth.js';
import {
  bad, forbidden, notFound, str, int, cents, date, oneOf, flag, paging, likeTerm, ym as ymParam,
} from '../lib/http.js';
import { norm } from '../../shared/text.js';
import { fmtBRL } from '../../shared/money.js';
import { addDays, daysBetween, fmtBR, monthBounds } from '../../shared/dates.js';
import { hojeEmpresa } from '../services/metrics.js';
import { criarCliente } from '../services/entities.js';
import { salvarArquivo, abrirArquivo, enviarArquivo, exigirComprovante } from '../services/arquivos.js';
import { sugerir } from '../services/conciliacao.js';
import {
  FORMAS_RECEBIMENTO, FORMAS_VENDA, statusTitulo, carregarTitulo, criarVenda, cancelarVenda, registrarRecebimento,
  baixarDireto, alocarRecebimento, estornarBaixa, confirmarPendente, saldoRecebimento,
} from '../services/finance.js';

export const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 1 } });
const isAdmin = (req) => req.user.papel === 'admin';

// ============================== VENDAS ==============================
export function filtroVendas(req) {
  const sc = scopeOf(req);
  const where = [];
  const params = [];
  const status = req.query.status || 'ativa';
  if (status !== 'todas') { where.push('v.status = ?'); params.push(status === 'cancelada' ? 'cancelada' : 'ativa'); }
  if (sc.vendedorId) { where.push('v.vendedor_id = ?'); params.push(sc.vendedorId); }
  if (req.query.mes) {
    const { inicio, fim } = monthBounds(ymParam(req.query.mes));
    where.push('v.data BETWEEN ? AND ?');
    params.push(inicio, fim);
  } else {
    if (req.query.de) { where.push('v.data >= ?'); params.push(date(req.query.de, { name: 'data inicial' })); }
    if (req.query.ate) { where.push('v.data <= ?'); params.push(date(req.query.ate, { name: 'data final' })); }
  }
  const cid = int(req.query.cliente_id, { name: 'cliente' });
  if (cid) { where.push('v.cliente_id = ?'); params.push(cid); }
  if (req.query.busca) {
    where.push("(c.nome_norm LIKE ? ESCAPE '\\' OR v.numero LIKE ? ESCAPE '\\')");
    params.push(likeTerm(norm(req.query.busca)), likeTerm(req.query.busca));
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/vendas', (req, res) => {
  const { limite, offset, pagina } = paging(req.query);
  const f = filtroVendas(req);
  const from = 'FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN vendedores ve ON ve.id = v.vendedor_id';
  const tot = db.get(`SELECT COALESCE(SUM(CASE WHEN v.status='ativa' THEN v.total_centavos END),0) AS total, COUNT(*) AS qtd ${from} ${f.where}`, ...f.params);
  const itens = db.all(
    `SELECT v.*, c.nome AS cliente_nome, ve.nome AS vendedor_nome,
      (SELECT COALESCE(SUM(valor_centavos),0) FROM v_titulos t WHERE t.venda_id = v.id AND t.cancelado = 0) AS titulos_centavos,
      (SELECT COALESCE(SUM(pago_centavos),0) FROM v_titulos t WHERE t.venda_id = v.id AND t.cancelado = 0) AS pago_centavos
     ${from} ${f.where} ORDER BY v.data DESC, v.id DESC LIMIT ? OFFSET ?`,
    ...f.params, limite, offset,
  ).map((v) => ({
    ...v,
    situacao: v.status === 'cancelada' ? 'cancelada' : v.pago_centavos >= v.titulos_centavos ? 'paga' : v.pago_centavos > 0 ? 'parcial' : 'aberta',
  }));
  res.json({ itens, total: tot.qtd, soma_centavos: tot.total, pagina, limite });
});

router.get('/vendas/:id', (req, res) => {
  const id = int(req.params.id, { required: true });
  const v = db.get(
    `SELECT v.*, c.nome AS cliente_nome, ve.nome AS vendedor_nome FROM vendas v
     LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN vendedores ve ON ve.id = v.vendedor_id WHERE v.id = ?`, id,
  );
  if (!v || (!isAdmin(req) && v.vendedor_id !== req.user.vendedor_id)) throw notFound('Venda não encontrada.');
  const hoje = hojeEmpresa();
  res.json({
    venda: v,
    itens: db.all('SELECT * FROM venda_itens WHERE venda_id = ? ORDER BY id', id),
    titulos: db.all('SELECT * FROM v_titulos WHERE venda_id = ? ORDER BY vencimento, id', id).map((t) => ({ ...t, status: statusTitulo(t, hoje) })),
  });
});

router.post('/vendas', (req, res) => {
  const b = req.body || {};
  const admin = isAdmin(req);
  const data = date(b.data, { required: true, name: 'data da venda' });
  let vendedorId = int(b.vendedor_id, { name: 'vendedor' });
  if (!admin) vendedorId = req.user.vendedor_id;
  if (!vendedorId) throw bad('Escolha o vendedor.');
  if (!db.get('SELECT 1 FROM vendedores WHERE id = ?', vendedorId)) throw bad('Vendedor não encontrado.');

  const forma = oneOf(b.forma_pagamento || 'pix', FORMAS_VENDA, { name: 'forma de pagamento' });
  const pago = flag(b.pago);
  let clienteId = int(b.cliente_id, { name: 'cliente' });
  const result = db.tx(() => {
    if (!clienteId && b.cliente_novo?.nome) {
      clienteId = criarCliente({ nome: str(b.cliente_novo.nome, { max: 160 }), telefone: str(b.cliente_novo.telefone, { max: 30 }), vendedor_id: vendedorId });
    }
    if (clienteId) {
      const c = db.get('SELECT vendedor_id FROM clientes WHERE id = ?', clienteId);
      if (!c) throw bad('Cliente não encontrado.');
      if (!admin && c.vendedor_id !== req.user.vendedor_id) throw forbidden('Este cliente não é da sua carteira.');
    } else if (!pago || forma === 'prazo') {
      throw bad('Escolha o cliente (venda a prazo ou ainda não paga precisa de cliente).');
    }
    const itens = (Array.isArray(b.itens) ? b.itens : []).map((i) => {
      let produto = null;
      if (i.produto_id) {
        produto = db.get('SELECT id, nome, unidade, preco_centavos FROM produtos WHERE id = ?', int(i.produto_id));
        if (!produto) throw bad('Produto não encontrado.');
      }
      return {
        produto_id: produto?.id || null,
        descricao: str(i.descricao || produto?.nome, { max: 200 }),
        quantidade: Number(String(i.quantidade).replace(',', '.')),
        unidade: produto?.unidade || str(i.unidade, { max: 12 }),
        preco_centavos: cents(i.preco_centavos ?? produto?.preco_centavos ?? 0, { name: 'preço' }) ?? 0,
      };
    });
    if (!itens.length && b.total_centavos == null) throw bad('Adicione pelo menos um item.');

    let parcelas = Array.isArray(b.parcelas) ? b.parcelas.map((p) => ({ vencimento: date(p.vencimento, { required: true, name: 'vencimento' }), valor_centavos: cents(p.valor_centavos, { required: true, name: 'parcela' }) })) : [];
    const n = int(b.n_parcelas, { min: 1, max: 48 }) || 1;
    if (!parcelas.length && n > 1) {
      const total = itens.reduce((s, i) => s + Math.round(i.quantidade * i.preco_centavos), 0) - (cents(b.desconto_centavos ?? 0) || 0);
      const primeiro = date(b.primeiro_vencimento, { required: true, name: 'primeiro vencimento' });
      const dias = int(b.intervalo_dias, { min: 1, max: 365 }) || 30;
      const base = Math.floor(total / n);
      parcelas = Array.from({ length: n }, (_, k) => ({ vencimento: addDays(primeiro, dias * k), valor_centavos: k === n - 1 ? total - base * (n - 1) : base }));
    }
    const vencimento = b.vencimento ? date(b.vencimento, { name: 'vencimento' }) : b.primeiro_vencimento ? date(b.primeiro_vencimento) : null;
    return criarVenda(
      {
        numero: str(b.numero, { max: 40 }), data, cliente_id: clienteId, vendedor_id: vendedorId, itens,
        desconto_centavos: cents(b.desconto_centavos ?? 0, { name: 'desconto' }) || 0, forma_pagamento: forma, pago,
        data_pagamento: b.data_pagamento ? date(b.data_pagamento) : null, parcelas, vencimento,
        observacoes: str(b.observacoes, { max: 500 }), origem: 'manual', baixar_estoque: admin && flag(b.baixar_estoque),
      },
      { user_id: req.user.id },
    );
  });
  audit(req, 'Lançou venda', 'venda', result.venda_id, { total: result.total_centavos });
  res.status(201).json(result);
});

router.put('/vendas/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const v = db.get('SELECT * FROM vendas WHERE id = ?', id);
  if (!v) throw notFound('Venda não encontrada.');
  const b = req.body || {};
  const clienteId = b.cliente_id === undefined ? v.cliente_id : int(b.cliente_id);
  const vendedorId = b.vendedor_id === undefined ? v.vendedor_id : int(b.vendedor_id);
  db.tx(() => {
    db.run(
      'UPDATE vendas SET numero=?, data=?, cliente_id=?, vendedor_id=?, observacoes=?, forma_pagamento=? WHERE id=?',
      str(b.numero ?? v.numero, { max: 40 }), date(b.data ?? v.data, { required: true }), clienteId, vendedorId,
      str(b.observacoes ?? v.observacoes, { max: 500 }), b.forma_pagamento ? oneOf(b.forma_pagamento, FORMAS_VENDA) : v.forma_pagamento, id,
    );
    db.run('UPDATE titulos SET cliente_id = ?, vendedor_id = ? WHERE venda_id = ?', clienteId, vendedorId, id);
  });
  audit(req, 'Alterou venda', 'venda', id);
  res.json({ ok: true });
});

router.post('/vendas/:id/cancelar', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  cancelarVenda(id);
  audit(req, 'Cancelou venda', 'venda', id);
  res.json({ ok: true });
});

router.delete('/vendas/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const baixas = db.get('SELECT COUNT(*) AS n FROM baixas WHERE titulo_id IN (SELECT id FROM titulos WHERE venda_id = ?)', id).n;
  if (baixas > 0) throw bad('Esta venda já tem pagamentos baixados. Cancele-a em vez de excluir.');
  db.run('DELETE FROM vendas WHERE id = ?', id);
  audit(req, 'Excluiu venda', 'venda', id);
  res.json({ ok: true });
});

// ============================== TÍTULOS (A RECEBER) ==============================
export function filtroTitulos(req, hoje) {
  const sc = scopeOf(req);
  const where = ['t.cancelado = 0'];
  const params = [];
  if (sc.vendedorId) { where.push('t.vendedor_id = ?'); params.push(sc.vendedorId); }
  const status = req.query.status || 'abertos';
  if (status === 'abertos') where.push('t.valor_centavos > t.pago_centavos');
  else if (status === 'vencidos') { where.push('t.valor_centavos > t.pago_centavos AND t.vencimento < ?'); params.push(hoje); }
  else if (status === 'a_vencer') { where.push('t.valor_centavos > t.pago_centavos AND t.vencimento >= ?'); params.push(hoje); }
  else if (status === 'pagos') where.push('t.valor_centavos <= t.pago_centavos');
  else if (status !== 'todos') throw bad('Filtro de status inválido.');
  const cid = int(req.query.cliente_id, { name: 'cliente' });
  if (cid) { where.push('t.cliente_id = ?'); params.push(cid); }
  if (req.query.mes) {
    const { inicio, fim } = monthBounds(ymParam(req.query.mes));
    where.push('t.vencimento BETWEEN ? AND ?');
    params.push(inicio, fim);
  }
  if (req.query.venc_de) { where.push('t.vencimento >= ?'); params.push(date(req.query.venc_de)); }
  if (req.query.venc_ate) { where.push('t.vencimento <= ?'); params.push(date(req.query.venc_ate)); }
  if (req.query.busca) {
    where.push("(c.nome_norm LIKE ? ESCAPE '\\' OR t.documento LIKE ? ESCAPE '\\')");
    params.push(likeTerm(norm(req.query.busca)), likeTerm(req.query.busca));
  }
  return { where: `WHERE ${where.join(' AND ')}`, params };
}

router.get('/titulos', (req, res) => {
  const hoje = hojeEmpresa();
  const { limite, offset, pagina } = paging(req.query, { max: 500, def: 100 });
  const f = filtroTitulos(req, hoje);
  const from = 'FROM v_titulos t LEFT JOIN clientes c ON c.id = t.cliente_id LEFT JOIN vendedores ve ON ve.id = t.vendedor_id';
  const ordem = { vencimento: 't.vencimento, t.id', valor: 'aberto_centavos DESC', cliente: 'c.nome_norm, t.vencimento', recente: 't.id DESC' }[req.query.ordem] || 't.vencimento, t.id';
  const totais = db.get(
    `SELECT COUNT(*) AS qtd, COALESCE(SUM(t.valor_centavos),0) AS valor_total, COALESCE(SUM(t.pago_centavos),0) AS pago_total,
            COALESCE(SUM(MAX(t.valor_centavos - t.pago_centavos, 0)),0) AS aberto_total,
            COALESCE(SUM(CASE WHEN t.vencimento < ? THEN MAX(t.valor_centavos - t.pago_centavos, 0) ELSE 0 END),0) AS vencido_total,
            COUNT(DISTINCT t.cliente_id) AS clientes
     ${from} ${f.where}`,
    hoje, ...f.params,
  );
  const itens = db.all(
    `SELECT t.*, t.valor_centavos - t.pago_centavos AS aberto_centavos, c.nome AS cliente_nome, c.telefone AS cliente_telefone, ve.nome AS vendedor_nome
     ${from} ${f.where} ORDER BY ${ordem} LIMIT ? OFFSET ?`,
    ...f.params, limite, offset,
  ).map((t) => {
    const status = statusTitulo(t, hoje);
    return { ...t, status, dias_atraso: status === 'vencido' ? daysBetween(t.vencimento, hoje) : 0 };
  });
  res.json({ itens, totais, pagina, limite, hoje });
});

function tituloVisivel(req, id) {
  const t = carregarTitulo(id);
  if (!isAdmin(req) && t.vendedor_id !== req.user.vendedor_id) throw notFound('Título não encontrado.');
  return t;
}

router.get('/titulos/:id', (req, res) => {
  const t = tituloVisivel(req, int(req.params.id, { required: true }));
  const hoje = hojeEmpresa();
  res.json({
    titulo: { ...t, status: statusTitulo(t, hoje), aberto_centavos: t.valor_centavos - t.pago_centavos, dias_atraso: t.vencimento < hoje ? daysBetween(t.vencimento, hoje) : 0 },
    cliente: t.cliente_id ? db.get('SELECT id, nome, telefone FROM clientes WHERE id = ?', t.cliente_id) : null,
    baixas: db.all(
      `SELECT b.id, b.valor_centavos, b.data, r.forma, r.pagador_nome, r.status, r.id AS recebimento_id, r.ref_externa
       FROM baixas b JOIN recebimentos r ON r.id = b.recebimento_id WHERE b.titulo_id = ? ORDER BY b.data, b.id`, t.id,
    ),
  });
});

router.post('/titulos', requireAdmin, (req, res) => {
  const b = req.body || {};
  const clienteId = int(b.cliente_id, { required: true, name: 'cliente' });
  if (!db.get('SELECT 1 FROM clientes WHERE id = ?', clienteId)) throw bad('Cliente não encontrado.');
  let vendedorId = int(b.vendedor_id, { name: 'vendedor' });
  if (!vendedorId) vendedorId = db.get('SELECT vendedor_id FROM clientes WHERE id = ?', clienteId)?.vendedor_id || null;
  const emissao = date(b.emissao, { name: 'data da compra' });
  const id = db.run(
    `INSERT INTO titulos (cliente_id, vendedor_id, documento, descricao, emissao, vencimento, valor_centavos, origem, observacoes, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    clienteId, vendedorId, str(b.documento, { max: 40 }), str(b.descricao, { max: 200 }), emissao,
    date(b.vencimento, { required: true, name: 'vencimento' }), cents(b.valor_centavos, { required: true, name: 'valor' }),
    'manual', str(b.observacoes, { max: 500 }), req.user.id,
  ).id;
  audit(req, 'Lançou dívida (título)', 'titulo', id, { valor: b.valor_centavos });
  res.status(201).json({ id });
});

router.put('/titulos/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const t = carregarTitulo(id);
  const b = req.body || {};
  const valor = b.valor_centavos === undefined ? t.valor_centavos : cents(b.valor_centavos, { required: true, name: 'valor' });
  if (valor < t.pago_centavos) throw bad('O valor não pode ser menor que o que já foi pago.');
  db.run(
    'UPDATE titulos SET cliente_id=?, vendedor_id=?, documento=?, descricao=?, vencimento=?, valor_centavos=?, observacoes=? WHERE id=?',
    b.cliente_id === undefined ? t.cliente_id : int(b.cliente_id), b.vendedor_id === undefined ? t.vendedor_id : int(b.vendedor_id),
    str(b.documento ?? t.documento, { max: 40 }), str(b.descricao ?? t.descricao, { max: 200 }),
    date(b.vencimento ?? t.vencimento, { required: true, name: 'vencimento' }), valor, str(b.observacoes ?? t.observacoes, { max: 500 }), id,
  );
  audit(req, 'Alterou título', 'titulo', id);
  res.json({ ok: true });
});

router.post('/titulos/:id/cancelar', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const t = carregarTitulo(id);
  if (t.pago_centavos > 0) throw bad('Este título já recebeu pagamento. Desfaça as baixas antes de cancelar.');
  db.run('UPDATE titulos SET cancelado = 1 WHERE id = ?', id);
  audit(req, 'Cancelou título', 'titulo', id);
  res.json({ ok: true });
});

router.delete('/titulos/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const t = carregarTitulo(id);
  if (t.pago_centavos > 0 || db.get('SELECT 1 FROM baixas WHERE titulo_id = ?', id)) throw bad('Este título tem baixas. Desfaça-as antes de excluir.');
  db.run('DELETE FROM titulos WHERE id = ?', id);
  audit(req, 'Excluiu título', 'titulo', id);
  res.json({ ok: true });
});

router.post('/titulos/:id/baixar', requireAdmin, (req, res) => {
  const b = req.body || {};
  const id = int(req.params.id, { required: true });
  const r = baixarDireto({
    titulo_id: id,
    valor_centavos: b.valor_centavos === undefined || b.valor_centavos === '' ? null : cents(b.valor_centavos, { name: 'valor' }),
    data: date(b.data || hojeEmpresa(), { required: true, name: 'data do pagamento' }),
    forma: oneOf(b.forma || 'pix', FORMAS_RECEBIMENTO, { name: 'forma' }),
    pagador_nome: str(b.pagador_nome, { max: 160 }), observacoes: str(b.observacoes, { max: 300 }), user_id: req.user.id,
  });
  audit(req, 'Deu baixa em título', 'titulo', id, { valor: r.valor_centavos, forma: b.forma || 'pix' });
  res.json({ ok: true, ...r });
});

router.post('/titulos/baixar-lote', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body.titulo_ids) ? req.body.titulo_ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) throw bad('Selecione pelo menos um título.');
  if (ids.length > 500) throw bad('Selecione no máximo 500 títulos por vez.');
  const data = date(req.body.data || hojeEmpresa(), { required: true, name: 'data do pagamento' });
  const forma = oneOf(req.body.forma || 'pix', FORMAS_RECEBIMENTO, { name: 'forma' });
  let feitos = 0;
  let total = 0;
  db.tx(() => {
    for (const id of ids) {
      const t = carregarTitulo(id);
      if (t.cancelado || t.valor_centavos <= t.pago_centavos) continue;
      const r = baixarDireto({ titulo_id: id, data, forma, user_id: req.user.id });
      feitos++;
      total += r.valor_centavos;
    }
  });
  audit(req, 'Baixa em lote', 'titulo', null, { feitos, total });
  res.json({ ok: true, feitos, total_centavos: total });
});

/** Vendedor (ou admin) avisa que o cliente pagou; o administrador confirma depois. */
router.post('/titulos/:id/informar-pagamento', upload.single('comprovante'), (req, res) => {
  const id = int(req.params.id, { required: true });
  const t = tituloVisivel(req, id);
  const aberto = t.valor_centavos - t.pago_centavos;
  if (t.cancelado || aberto <= 0) throw bad('Este título não está em aberto.');
  const valor = req.body.valor_centavos ? cents(req.body.valor_centavos, { name: 'valor' }) : aberto;
  if (valor > aberto) throw bad('O valor informado é maior que o saldo em aberto.');
  if (req.file) exigirComprovante(req.file);
  const arq = req.file ? salvarArquivo({ buffer: req.file.buffer, nome: req.file.originalname, mime: req.file.mimetype, user_id: req.user.id }) : null;
  const cli = t.cliente_id ? db.get('SELECT nome FROM clientes WHERE id = ?', t.cliente_id) : null;
  const rid = registrarRecebimento({
    data: date(req.body.data || hojeEmpresa(), { required: true }), valor_centavos: valor, forma: oneOf(req.body.forma || 'pix', FORMAS_RECEBIMENTO),
    pagador_nome: cli?.nome || null, cliente_id: t.cliente_id, vendedor_id: t.vendedor_id, titulo_informado_id: id,
    arquivo_id: arq?.id, status: isAdmin(req) ? 'confirmado' : 'pendente', origem: 'informado', observacoes: str(req.body.observacoes, { max: 300 }), user_id: req.user.id,
  });
  if (isAdmin(req)) alocarRecebimento(rid, [{ titulo_id: id, valor_centavos: valor }], req.user.id); // administrador já dá a baixa direto
  audit(req, isAdmin(req) ? 'Registrou pagamento de título' : 'Informou pagamento (aguarda confirmação)', 'titulo', id, { valor });
  res.status(201).json({ ok: true, recebimento_id: rid, pendente: !isAdmin(req) });
});

router.delete('/baixas/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  estornarBaixa(id);
  audit(req, 'Desfez baixa (estorno)', 'baixa', id);
  res.json({ ok: true });
});

// -------- cobrança por WhatsApp --------
function telefoneWhats(tel) {
  let d = String(tel || '').replace(/\D+/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length <= 11) d = `55${d}`;
  return d;
}
function montarMensagem(cfg, cliente, titulos) {
  const aberto = titulos.reduce((s, t) => s + (t.valor_centavos - t.pago_centavos), 0);
  const mais = [...titulos].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
  const venc = titulos.length === 1 ? fmtBR(mais.vencimento) : `${fmtBR(mais.vencimento)} (e outros)`;
  return String(cfg.msg_cobranca || '')
    .replaceAll('{cliente}', cliente?.nome || '')
    .replaceAll('{valor}', fmtBRL(aberto))
    .replaceAll('{vencimento}', venc)
    .replaceAll('{empresa}', cfg.empresa_nome || '')
    .replaceAll('{documento}', titulos.map((t) => t.documento).filter(Boolean).join(', '));
}
router.get('/titulos/:id/cobranca', (req, res) => {
  const t = tituloVisivel(req, int(req.params.id, { required: true }));
  const cli = t.cliente_id ? db.get('SELECT nome, telefone FROM clientes WHERE id = ?', t.cliente_id) : null;
  const mensagem = montarMensagem(getSettings(), cli, [t]);
  const fone = telefoneWhats(cli?.telefone);
  res.json({ mensagem, telefone: fone, link: `https://wa.me/${fone || ''}?text=${encodeURIComponent(mensagem)}` });
});
router.get('/clientes/:id/cobranca', (req, res) => {
  const id = int(req.params.id, { required: true });
  const cli = db.get('SELECT * FROM clientes WHERE id = ?', id);
  if (!cli || (!isAdmin(req) && cli.vendedor_id !== req.user.vendedor_id)) throw notFound('Cliente não encontrado.');
  const abertos = db.all('SELECT * FROM v_titulos WHERE cliente_id = ? AND cancelado = 0 AND valor_centavos > pago_centavos ORDER BY vencimento', id);
  if (!abertos.length) throw bad('Este cliente não tem nada em aberto.');
  const mensagem = montarMensagem(getSettings(), cli, abertos);
  const fone = telefoneWhats(cli.telefone);
  res.json({ mensagem, telefone: fone, link: `https://wa.me/${fone || ''}?text=${encodeURIComponent(mensagem)}` });
});

// ============================== RECEBIMENTOS (PIX) ==============================
export function filtroReceb(req) {
  const sc = scopeOf(req);
  const where = [];
  const params = [];
  if (sc.vendedorId) {
    where.push('(r.vendedor_id = ? OR r.id IN (SELECT b.recebimento_id FROM baixas b JOIN titulos t ON t.id = b.titulo_id WHERE t.vendedor_id = ?))');
    params.push(sc.vendedorId, sc.vendedorId);
  }
  const st = req.query.status || 'todos';
  if (st === 'nao_conciliados') where.push("r.status = 'confirmado' AND r.valor_centavos > r.alocado_centavos");
  else if (st === 'conciliados') where.push("r.status = 'confirmado' AND r.valor_centavos <= r.alocado_centavos");
  else if (st === 'pendentes') where.push("r.status = 'pendente'");
  else if (st === 'cancelados') where.push("r.status = 'cancelado'");
  else where.push("r.status <> 'cancelado'");
  if (req.query.mes) {
    const { inicio, fim } = monthBounds(ymParam(req.query.mes));
    where.push('r.data BETWEEN ? AND ?');
    params.push(inicio, fim);
  }
  if (req.query.forma) { where.push('r.forma = ?'); params.push(oneOf(req.query.forma, FORMAS_RECEBIMENTO)); }
  if (req.query.busca) {
    where.push("(r.pagador_norm LIKE ? ESCAPE '\\' OR c.nome_norm LIKE ? ESCAPE '\\' OR r.ref_externa LIKE ? ESCAPE '\\')");
    params.push(likeTerm(norm(req.query.busca)), likeTerm(norm(req.query.busca)), likeTerm(req.query.busca));
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/recebimentos', (req, res) => {
  const { limite, offset, pagina } = paging(req.query, { max: 500, def: 100 });
  const f = filtroReceb(req);
  const from = 'FROM v_recebimentos r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vendedores ve ON ve.id = r.vendedor_id';
  const totais = db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(r.valor_centavos),0) AS total, COALESCE(SUM(MAX(r.valor_centavos - r.alocado_centavos,0)),0) AS sem_baixa ${from} ${f.where}`, ...f.params);
  const itens = db.all(
    `SELECT r.*, r.valor_centavos - r.alocado_centavos AS saldo_centavos, c.nome AS cliente_nome, ve.nome AS vendedor_nome,
            (SELECT a.nome_original FROM arquivos a WHERE a.id = r.arquivo_id) AS comprovante_nome
     ${from} ${f.where} ORDER BY r.data DESC, r.id DESC LIMIT ? OFFSET ?`,
    ...f.params, limite, offset,
  );
  res.json({ itens, totais, pagina, limite });
});

router.get('/recebimentos/sugestoes', requireAdmin, (req, res) => {
  const lista = db.all(
    `SELECT r.*, r.valor_centavos - r.alocado_centavos AS saldo_centavos, c.nome AS cliente_nome
     FROM v_recebimentos r LEFT JOIN clientes c ON c.id = r.cliente_id
     WHERE r.status = 'confirmado' AND r.valor_centavos > r.alocado_centavos ORDER BY r.data DESC, r.id DESC LIMIT 300`,
  );
  const sugs = sugerir(lista);
  const nomes = new Map(db.all('SELECT id, documento, parcela, vencimento FROM titulos').map((t) => [t.id, t]));
  res.json(
    lista.map((r) => ({
      recebimento: r,
      sugestoes: (sugs.get(r.id) || []).map((s) => ({ ...s, titulos: s.titulo_ids.map((id) => nomes.get(id)).filter(Boolean) })),
    })),
  );
});

router.post('/recebimentos', requireAdmin, upload.single('comprovante'), (req, res) => {
  const b = req.body || {};
  if (req.file) exigirComprovante(req.file);
  const arq = req.file ? salvarArquivo({ buffer: req.file.buffer, nome: req.file.originalname, mime: req.file.mimetype, user_id: req.user.id }) : null;
  const tituloIds = Array.isArray(b.titulo_ids) ? b.titulo_ids.map(Number).filter(Number.isInteger) : typeof b.titulo_ids === 'string' && b.titulo_ids ? b.titulo_ids.split(',').map(Number).filter(Number.isInteger) : [];
  const out = db.tx(() => {
    const id = registrarRecebimento({
      data: date(b.data || hojeEmpresa(), { required: true, name: 'data' }), valor_centavos: cents(b.valor_centavos, { required: true, name: 'valor' }),
      forma: oneOf(b.forma || 'pix', FORMAS_RECEBIMENTO, { name: 'forma' }), pagador_nome: str(b.pagador_nome, { max: 160 }),
      pagador_documento: str(b.pagador_documento, { max: 30 }), banco: str(b.banco, { max: 80 }), ref_externa: str(b.ref_externa, { max: 80 }),
      cliente_id: int(b.cliente_id, { name: 'cliente' }), vendedor_id: int(b.vendedor_id, { name: 'vendedor' }), arquivo_id: arq?.id,
      observacoes: str(b.observacoes, { max: 300 }), origem: 'manual', user_id: req.user.id,
    });
    let baixas = [];
    if (tituloIds.length) baixas = alocarRecebimento(id, tituloIds.map((t) => ({ titulo_id: t })), req.user.id);
    return { id, baixas };
  });
  audit(req, 'Registrou recebimento', 'recebimento', out.id, { valor: b.valor_centavos });
  res.status(201).json(out);
});

router.put('/recebimentos/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const r = saldoRecebimento(id);
  const b = req.body || {};
  db.run(
    'UPDATE recebimentos SET pagador_nome=?, pagador_norm=?, cliente_id=?, vendedor_id=?, observacoes=?, data=?, forma=? WHERE id=?',
    str(b.pagador_nome ?? r.pagador_nome, { max: 160 }), norm(b.pagador_nome ?? r.pagador_nome),
    b.cliente_id === undefined ? r.cliente_id : int(b.cliente_id), b.vendedor_id === undefined ? r.vendedor_id : int(b.vendedor_id),
    str(b.observacoes ?? r.observacoes, { max: 300 }), date(b.data ?? r.data, { required: true }), oneOf(b.forma ?? r.forma, FORMAS_RECEBIMENTO), id,
  );
  audit(req, 'Alterou recebimento', 'recebimento', id);
  res.json({ ok: true });
});

router.post('/recebimentos/:id/conciliar', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const aloc = (Array.isArray(req.body.alocacoes) ? req.body.alocacoes : []).map((a) => ({
    titulo_id: int(a.titulo_id, { required: true }), valor_centavos: a.valor_centavos == null || a.valor_centavos === '' ? undefined : cents(a.valor_centavos),
  }));
  const baixas = alocarRecebimento(id, aloc, req.user.id);
  audit(req, 'Conciliou recebimento com título(s)', 'recebimento', id, { titulos: aloc.map((a) => a.titulo_id) });
  res.json({ ok: true, baixas });
});

router.post('/recebimentos/conciliar-lote', requireAdmin, (req, res) => {
  const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
  if (!itens.length) throw bad('Nada para conciliar.');
  if (itens.length > 300) throw bad('Concilie no máximo 300 por vez.');
  let feitos = 0;
  db.tx(() => {
    for (const it of itens) {
      const ids = (it.titulo_ids || []).map(Number).filter(Number.isInteger);
      if (!ids.length) continue;
      alocarRecebimento(int(it.recebimento_id, { required: true }), ids.map((t) => ({ titulo_id: t })), req.user.id);
      feitos++;
    }
  });
  audit(req, 'Conciliação em lote', 'recebimento', null, { feitos });
  res.json({ ok: true, feitos });
});

router.post('/recebimentos/:id/confirmar', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  confirmarPendente(id, req.user.id);
  audit(req, 'Confirmou pagamento informado', 'recebimento', id);
  res.json({ ok: true });
});

router.post('/recebimentos/:id/rejeitar', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const r = saldoRecebimento(id);
  if (r.status !== 'pendente') throw bad('Só dá para rejeitar pagamentos pendentes.');
  db.run("UPDATE recebimentos SET status = 'cancelado', observacoes = COALESCE(?, observacoes) WHERE id = ?", str(req.body.motivo, { max: 300 }), id);
  audit(req, 'Rejeitou pagamento informado', 'recebimento', id);
  res.json({ ok: true });
});

router.delete('/recebimentos/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  saldoRecebimento(id);
  db.run('DELETE FROM recebimentos WHERE id = ?', id); // baixas saem em cascata
  audit(req, 'Excluiu recebimento', 'recebimento', id);
  res.json({ ok: true });
});

router.get('/recebimentos/:id/comprovante', (req, res) => {
  const r = db.get('SELECT * FROM recebimentos WHERE id = ?', int(req.params.id, { required: true }));
  if (!r || !r.arquivo_id) throw notFound('Sem comprovante.');
  if (!isAdmin(req) && r.vendedor_id !== req.user.vendedor_id) throw notFound('Sem comprovante.');
  const a = abrirArquivo(r.arquivo_id);
  if (!a) throw notFound('Arquivo não encontrado.');
  enviarArquivo(res, a);
});
