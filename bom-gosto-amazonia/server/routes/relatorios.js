// PDF do resumo do mês e exportações em CSV (abre direto no Excel brasileiro).
import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { requireAuth, scopeOf, audit } from '../auth.js';
import { flag, ym as ymParam, notFound } from '../lib/http.js';
import { csvCell } from '../../shared/text.js';
import { fmtBR, daysBetween } from '../../shared/dates.js';
import { resumo, hojeEmpresa, movimentoPorProduto } from '../services/metrics.js';
import { statusTitulo } from '../services/finance.js';
import { gerarResumoPDF } from '../services/relatorio-pdf.js';
import { filtroVendas, filtroTitulos, filtroReceb } from './financeiro.js';

export const router = Router();
router.use(requireAuth);

function agoraBR() {
  const tz = db.get("SELECT valor FROM configuracoes WHERE chave = 'fuso_horario'")?.valor || 'America/Manaus';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date()).replace(',', ' às');
}

router.get('/relatorios/resumo.pdf', (req, res) => {
  const sc = scopeOf(req);
  const ym = ymParam(req.query.mes, hojeEmpresa().slice(0, 7));
  const dados = resumo({ ym, vendedorId: sc.vendedorId, admin: sc.admin });
  const cfg = getSettings();
  const empresa = cfg.empresa_nome || 'Bom Gosto da Amazônia';
  let escopo = 'Todos os vendedores';
  if (sc.vendedorId) escopo = `Vendedor: ${db.get('SELECT nome FROM vendedores WHERE id = ?', sc.vendedorId)?.nome || ''}`;
  const opcoes = { vendedores: flag(req.query.vendedores ?? '1'), deposito: flag(req.query.deposito ?? '1') };
  const completo = sc.admin && !sc.vendedorId;
  const doc = gerarResumoPDF({
    dados, empresa, escopo, admin: completo, opcoes, geradoEm: agoraBR(),
    porProduto: completo && opcoes.deposito ? movimentoPorProduto(ym).filter((p) => p.entrou || p.produzido || p.saiu || p.retirado || p.perdido || p.saldo) : [],
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'"); // permite a pré-visualização dentro do painel
  res.setHeader('Content-Disposition', `${flag(req.query.baixar) ? 'attachment' : 'inline'}; filename="resumo-${ym}${sc.vendedorId ? `-vendedor-${sc.vendedorId}` : ''}.pdf"`);
  audit(req, 'Gerou relatório PDF', 'relatorio', null, { mes: ym, escopo });
  doc.pipe(res);
  doc.end();
});

// ---------------- CSV ----------------
const dec = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');

function enviarCSV(res, nome, cabecalho, linhas) {
  const corpo = [cabecalho, ...linhas].map((l) => l.map(csvCell).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}-${hojeEmpresa()}.csv"`);
  res.send(`﻿${corpo}\r\n`);
}

router.get('/exportar/:entidade.csv', (req, res) => {
  const hoje = hojeEmpresa();
  const ent = req.params.entidade;
  const sc = scopeOf(req);
  const LIM = 50000;

  if (ent === 'vendas') {
    const f = filtroVendas(req);
    const rows = db.all(
      `SELECT v.*, c.nome AS cliente_nome, ve.nome AS vendedor_nome FROM vendas v
       LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN vendedores ve ON ve.id = v.vendedor_id ${f.where} ORDER BY v.data DESC, v.id DESC LIMIT ${LIM}`, ...f.params,
    );
    return enviarCSV(res, 'vendas', ['Data', 'Nº', 'Cliente', 'Vendedor', 'Total', 'Forma de pagamento', 'Situação', 'Origem', 'Observações'],
      rows.map((v) => [fmtBR(v.data), v.numero, v.cliente_nome, v.vendedor_nome, dec(v.total_centavos), v.forma_pagamento, v.status, v.origem, v.observacoes]));
  }
  if (ent === 'a-receber' || ent === 'devedores') {
    const f = filtroTitulos(req, hoje);
    const rows = db.all(
      `SELECT t.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, ve.nome AS vendedor_nome
       FROM v_titulos t LEFT JOIN clientes c ON c.id = t.cliente_id LEFT JOIN vendedores ve ON ve.id = t.vendedor_id ${f.where} ORDER BY t.vencimento, t.id LIMIT ${LIM}`, ...f.params,
    );
    return enviarCSV(res, 'a-receber', ['Cliente', 'Telefone', 'Vendedor', 'Documento', 'Parcela', 'Emissão', 'Vencimento', 'Valor', 'Pago', 'Em aberto', 'Situação', 'Dias de atraso'],
      rows.map((t) => {
        const st = statusTitulo(t, hoje);
        return [t.cliente_nome, t.cliente_telefone, t.vendedor_nome, t.documento, t.parcela, fmtBR(t.emissao), fmtBR(t.vencimento), dec(t.valor_centavos), dec(t.pago_centavos),
          dec(Math.max(t.valor_centavos - t.pago_centavos, 0)), st, st === 'vencido' ? daysBetween(t.vencimento, hoje) : 0];
      }));
  }
  if (ent === 'recebimentos') {
    const f = filtroReceb(req);
    const rows = db.all(
      `SELECT r.*, c.nome AS cliente_nome, ve.nome AS vendedor_nome FROM v_recebimentos r
       LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vendedores ve ON ve.id = r.vendedor_id ${f.where} ORDER BY r.data DESC, r.id DESC LIMIT ${LIM}`, ...f.params,
    );
    return enviarCSV(res, 'recebimentos', ['Data', 'Valor', 'Forma', 'Pagador', 'Cliente', 'Vendedor', 'Banco', 'Código da transação', 'Situação', 'Sem baixa'],
      rows.map((r) => [fmtBR(r.data), dec(r.valor_centavos), r.forma, r.pagador_nome, r.cliente_nome, r.vendedor_nome, r.banco, r.ref_externa,
        r.status === 'confirmado' ? (r.alocado_centavos >= r.valor_centavos ? 'com baixa' : 'sem baixa') : r.status, dec(Math.max(r.valor_centavos - r.alocado_centavos, 0))]));
  }
  if (ent === 'clientes') {
    const where = sc.vendedorId ? 'WHERE c.vendedor_id = ?' : '';
    const rows = db.all(
      `SELECT c.*, v.nome AS vendedor_nome,
        COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos t WHERE t.cliente_id = c.id AND t.cancelado = 0 AND t.valor_centavos > t.pago_centavos),0) AS aberto,
        COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos t WHERE t.cliente_id = c.id AND t.cancelado = 0 AND t.valor_centavos > t.pago_centavos AND t.vencimento < ?),0) AS vencido,
        (SELECT MAX(data) FROM vendas WHERE cliente_id = c.id AND status = 'ativa') AS ultima
       FROM clientes c LEFT JOIN vendedores v ON v.id = c.vendedor_id ${where} ORDER BY c.nome_norm LIMIT ${LIM}`,
      hoje, ...(sc.vendedorId ? [sc.vendedorId] : []),
    );
    return enviarCSV(res, 'clientes', ['Nome', 'CPF/CNPJ', 'Telefone', 'Cidade', 'Vendedor', 'Em aberto', 'Vencido', 'Última compra'],
      rows.map((c) => [c.nome, c.documento, c.telefone, c.cidade, c.vendedor_nome, dec(c.aberto), dec(c.vencido), fmtBR(c.ultima)]));
  }
  if (ent === 'estoque') {
    if (!sc.admin) throw notFound('Relatório não disponível.');
    const rows = db.all(
      `SELECT m.*, p.nome AS produto_nome, p.unidade, ve.nome AS vendedor_nome FROM estoque_movimentos m
       JOIN produtos p ON p.id = m.produto_id LEFT JOIN vendedores ve ON ve.id = m.vendedor_id
       ${req.query.mes ? 'WHERE substr(m.data,1,7) = ?' : ''} ORDER BY m.data DESC, m.id DESC LIMIT ${LIM}`, ...(req.query.mes ? [ymParam(req.query.mes)] : []),
    );
    return enviarCSV(res, 'deposito', ['Data', 'Produto', 'Tipo', 'Quantidade', 'Unidade', 'Vendedor', 'Observações'],
      rows.map((m) => [fmtBR(m.data), m.produto_nome, m.tipo, String(m.quantidade).replace('.', ','), m.unidade, m.vendedor_nome, m.observacoes]));
  }
  throw notFound('Exportação não encontrada.');
});
