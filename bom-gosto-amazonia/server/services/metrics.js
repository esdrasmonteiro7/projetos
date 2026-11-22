// Números do painel e do relatório PDF (uma única fonte da verdade).
import { db, getTZ } from '../db.js';
import { monthBounds, ymAdd, todayISO } from '../../shared/dates.js';
import { round3 } from '../../shared/money.js';

const ABERTO = 'cancelado = 0 AND valor_centavos > pago_centavos';

export function hojeEmpresa() {
  return todayISO(getTZ());
}

export function saldosEstoque() {
  return db.all(
    `SELECT p.id, p.nome, p.sku, p.unidade, p.estoque_minimo, p.preco_centavos, p.custo_centavos, p.ativo,
            COALESCE(SUM(m.quantidade), 0) AS saldo
     FROM produtos p LEFT JOIN estoque_movimentos m ON m.produto_id = p.id
     GROUP BY p.id ORDER BY p.nome COLLATE NOCASE`,
  ).map((r) => ({ ...r, saldo: round3(r.saldo) }));
}

/** Resumo do depósito no mês: entrou, saiu, produzido, planejado x produzido. */
export function resumoDeposito(ym) {
  const { inicio, fim } = monthBounds(ym);
  const soma = (tipos, sinal = 1) =>
    round3(
      sinal *
        db.get(
          `SELECT COALESCE(SUM(quantidade),0) AS q FROM estoque_movimentos WHERE data BETWEEN ? AND ? AND tipo IN (${tipos.map(() => '?').join(',')})`,
          inicio, fim, ...tipos,
        ).q,
    );
  const ajustePos = round3(db.get("SELECT COALESCE(SUM(quantidade),0) q FROM estoque_movimentos WHERE data BETWEEN ? AND ? AND tipo='ajuste' AND quantidade>0", inicio, fim).q);
  const ajusteNeg = round3(-db.get("SELECT COALESCE(SUM(quantidade),0) q FROM estoque_movimentos WHERE data BETWEEN ? AND ? AND tipo='ajuste' AND quantidade<0", inicio, fim).q);

  const entradas = round3(soma(['entrada', 'devolucao']) + ajustePos);
  const produzido = soma(['producao']);
  const vendas = soma(['venda', 'saida'], -1);
  const retiradas = soma(['retirada'], -1);
  const perdas = round3(soma(['perda'], -1) + ajusteNeg);

  const ordens = db.get(
    `SELECT COUNT(*) AS qtd, COALESCE(SUM(o.planejado),0) AS planejado,
            COALESCE(SUM(MIN(o.planejado, COALESCE((SELECT SUM(m.quantidade) FROM estoque_movimentos m WHERE m.ordem_producao_id = o.id AND m.tipo='producao'),0))),0) AS produzido_plano,
            COALESCE(SUM(CASE WHEN COALESCE((SELECT SUM(m.quantidade) FROM estoque_movimentos m WHERE m.ordem_producao_id = o.id AND m.tipo='producao'),0) >= o.planejado THEN 1 ELSE 0 END),0) AS concluidas
     FROM ordens_producao o WHERE o.cancelada = 0 AND o.data BETWEEN ? AND ?`,
    inicio, fim,
  );
  const planejado = round3(ordens.planejado);
  const produzidoPlano = round3(ordens.produzido_plano);
  const estoque = saldosEstoque().filter((p) => p.ativo);
  const totalUn = round3(estoque.reduce((s, p) => s + p.saldo, 0));
  const valor = Math.round(estoque.reduce((s, p) => s + Math.max(p.saldo, 0) * (p.custo_centavos || p.preco_centavos || 0), 0));
  return {
    entradas,
    produzido,
    vendas_saidas: vendas,
    retiradas,
    perdas,
    saiu_total: round3(vendas + retiradas + perdas),
    producao: {
      planejado,
      produzido_do_plano: produzidoPlano,
      nao_produzido: round3(Math.max(planejado - produzidoPlano, 0)),
      ordens: ordens.qtd,
      ordens_concluidas: ordens.concluidas,
      produzido_total: produzido,
    },
    estoque: {
      total_unidades: totalUn,
      valor_centavos: valor,
      abaixo_minimo: estoque.filter((p) => p.estoque_minimo > 0 && p.saldo < p.estoque_minimo).map((p) => ({ id: p.id, nome: p.nome, saldo: p.saldo, minimo: p.estoque_minimo, unidade: p.unidade })),
    },
  };
}

export function resumo({ ym, vendedorId = null, admin = true }) {
  const hoje = hojeEmpresa();
  const { inicio, fim } = monthBounds(ym);
  const prox = ymAdd(ym, 1);
  const pb = monthBounds(prox);
  const V = vendedorId ? ' AND vendedor_id = ?' : '';
  const vp = vendedorId ? [vendedorId] : [];

  const vendido = db.get(
    `SELECT COALESCE(SUM(total_centavos),0) AS total, COUNT(*) AS qtd FROM vendas WHERE status='ativa' AND data BETWEEN ? AND ?${V}`,
    inicio, fim, ...vp,
  );

  let recebido;
  if (vendedorId) {
    recebido = db.get(
      `SELECT COALESCE(SUM(b.valor_centavos),0) AS total, COUNT(DISTINCT b.recebimento_id) AS qtd,
              COALESCE(SUM(CASE WHEN r.forma='pix' THEN b.valor_centavos END),0) AS pix
       FROM baixas b JOIN recebimentos r ON r.id = b.recebimento_id JOIN titulos t ON t.id = b.titulo_id
       WHERE r.status='confirmado' AND b.data BETWEEN ? AND ? AND t.vendedor_id = ?`,
      inicio, fim, vendedorId,
    );
  } else {
    recebido = db.get(
      `SELECT COALESCE(SUM(valor_centavos),0) AS total, COUNT(*) AS qtd,
              COALESCE(SUM(CASE WHEN forma='pix' THEN valor_centavos END),0) AS pix
       FROM recebimentos WHERE status='confirmado' AND data BETWEEN ? AND ?`,
      inicio, fim,
    );
  }
  const semBaixa = vendedorId
    ? { total: 0, qtd: 0 }
    : db.get("SELECT COALESCE(SUM(valor_centavos - alocado_centavos),0) AS total, COUNT(*) AS qtd FROM v_recebimentos WHERE status='confirmado' AND valor_centavos > alocado_centavos");
  const pendentes = db.get(
    `SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_centavos),0) AS total FROM recebimentos WHERE status='pendente'${V}`,
    ...vp,
  );

  const q = (extra = '', ...params) =>
    db.get(
      `SELECT COALESCE(SUM(valor_centavos - pago_centavos),0) AS total, COUNT(*) AS qtd, COUNT(DISTINCT cliente_id) AS clientes
       FROM v_titulos WHERE ${ABERTO}${V}${extra}`,
      ...vp, ...params,
    );
  const aberto = q();
  const vencido = q(' AND vencimento < ?', hoje);
  const venceMes = q(' AND vencimento BETWEEN ? AND ?', inicio, fim);
  const proximoMes = q(' AND vencimento BETWEEN ? AND ?', pb.inicio, pb.fim);

  const previsaoIni = pb.inicio;
  const previsaoFim = monthBounds(ymAdd(ym, 4)).fim;
  const prevRows = db.all(
    `SELECT substr(vencimento,1,7) AS ym, SUM(valor_centavos - pago_centavos) AS total
     FROM v_titulos WHERE ${ABERTO}${V} AND vencimento BETWEEN ? AND ? GROUP BY ym`,
    ...vp, previsaoIni, previsaoFim,
  );
  const previsao = [1, 2, 3, 4].map((n) => {
    const k = ymAdd(ym, n);
    return { ym: k, total: prevRows.find((r) => r.ym === k)?.total || 0 };
  });

  const retiradas = db.get(
    `SELECT COUNT(*) AS qtd, COALESCE(SUM(-quantidade),0) AS unidades, COALESCE(SUM(-quantidade * valor_unit_centavos),0) AS valor
     FROM estoque_movimentos WHERE tipo='retirada' AND data BETWEEN ? AND ?${V}`,
    inicio, fim, ...vp,
  );
  const devolucoes = db.get(
    `SELECT COALESCE(SUM(quantidade),0) AS unidades FROM estoque_movimentos WHERE tipo='devolucao' AND vendedor_id IS NOT NULL AND data BETWEEN ? AND ?${V}`,
    inicio, fim, ...vp,
  );

  const ini6 = monthBounds(ymAdd(ym, -5)).inicio;
  const vm = db.all(
    `SELECT substr(data,1,7) AS ym, SUM(total_centavos) AS total FROM vendas WHERE status='ativa' AND data BETWEEN ? AND ?${V} GROUP BY ym`,
    ini6, fim, ...vp,
  );
  const rm = vendedorId
    ? db.all(
        `SELECT substr(b.data,1,7) AS ym, SUM(b.valor_centavos) AS total FROM baixas b JOIN recebimentos r ON r.id=b.recebimento_id JOIN titulos t ON t.id=b.titulo_id
         WHERE r.status='confirmado' AND t.vendedor_id = ? AND b.data BETWEEN ? AND ? GROUP BY ym`,
        vendedorId, ini6, fim,
      )
    : db.all("SELECT substr(data,1,7) AS ym, SUM(valor_centavos) AS total FROM recebimentos WHERE status='confirmado' AND data BETWEEN ? AND ? GROUP BY ym", ini6, fim);
  const meses = [-5, -4, -3, -2, -1, 0].map((n) => {
    const k = ymAdd(ym, n);
    return { ym: k, vendido: vm.find((r) => r.ym === k)?.total || 0, recebido: rm.find((r) => r.ym === k)?.total || 0 };
  });

  const topDevedores = db.all(
    `SELECT c.id, c.nome, SUM(t.valor_centavos - t.pago_centavos) AS aberto, MIN(t.vencimento) AS mais_antigo,
            SUM(CASE WHEN t.vencimento < ? THEN t.valor_centavos - t.pago_centavos ELSE 0 END) AS vencido
     FROM v_titulos t JOIN clientes c ON c.id = t.cliente_id
     WHERE t.cancelado = 0 AND t.valor_centavos > t.pago_centavos${V.replace('vendedor_id', 't.vendedor_id')}
     GROUP BY c.id ORDER BY aberto DESC LIMIT 6`,
    hoje, ...vp,
  );

  let porVendedor = [];
  if (admin && !vendedorId) {
    porVendedor = db.all(
      `SELECT v.id, v.nome, v.comissao_pct, v.ativo,
        COALESCE((SELECT SUM(total_centavos) FROM vendas WHERE vendedor_id = v.id AND status='ativa' AND data BETWEEN ? AND ?),0) AS vendido,
        COALESCE((SELECT SUM(b.valor_centavos) FROM baixas b JOIN recebimentos r ON r.id=b.recebimento_id JOIN titulos t ON t.id=b.titulo_id
                  WHERE t.vendedor_id = v.id AND r.status='confirmado' AND b.data BETWEEN ? AND ?),0) AS recebido,
        COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos WHERE vendedor_id = v.id AND ${ABERTO}),0) AS em_aberto,
        COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos WHERE vendedor_id = v.id AND ${ABERTO} AND vencimento < ?),0) AS vencido,
        COALESCE((SELECT SUM(-quantidade) FROM estoque_movimentos WHERE vendedor_id = v.id AND tipo='retirada' AND data BETWEEN ? AND ?),0) AS retiradas_un
       FROM vendedores v`,
      inicio, fim, inicio, fim, hoje, inicio, fim,
    ).filter((v) => v.ativo || v.vendido || v.recebido || v.em_aberto || v.retiradas_un);
    const semV = db.get(
      `SELECT COALESCE((SELECT SUM(total_centavos) FROM vendas WHERE vendedor_id IS NULL AND status='ativa' AND data BETWEEN ? AND ?),0) AS vendido,
              COALESCE((SELECT SUM(valor_centavos - pago_centavos) FROM v_titulos WHERE vendedor_id IS NULL AND ${ABERTO}),0) AS em_aberto`,
      inicio, fim,
    );
    if (semV.vendido || semV.em_aberto) porVendedor.push({ id: null, nome: 'Sem vendedor', comissao_pct: 0, vendido: semV.vendido, recebido: 0, em_aberto: semV.em_aberto, vencido: 0, retiradas_un: 0 });
    porVendedor.sort((a, b) => b.vendido - a.vendido || b.em_aberto - a.em_aberto);
    for (const v of porVendedor) v.comissao_centavos = Math.round((v.recebido * (v.comissao_pct || 0)) / 100);
  }

  return {
    mes: ym,
    proximo_mes: prox,
    hoje,
    vendido: { ...vendido, ticket_medio: vendido.qtd ? Math.round(vendido.total / vendido.qtd) : 0 },
    recebido: { ...recebido, sem_baixa_total: semBaixa.total, sem_baixa_qtd: semBaixa.qtd },
    pendentes,
    em_aberto: aberto,
    vencido,
    vence_no_mes: venceMes,
    a_receber_proximo_mes: proximoMes,
    previsao,
    retiradas: { ...retiradas, unidades: round3(retiradas.unidades), devolvidas: round3(devolucoes.unidades) },
    meses,
    top_devedores: topDevedores,
    por_vendedor: porVendedor,
    deposito: admin && !vendedorId ? resumoDeposito(ym) : null,
  };
}

/** Tabela do mês por produto: entrou, produzido, saiu, retirado, perdido, saldo, planejado. */
export function movimentoPorProduto(ym) {
  const { inicio, fim } = monthBounds(ym);
  return db.all(
    `SELECT p.id, p.nome, p.unidade, p.estoque_minimo,
      COALESCE(SUM(CASE WHEN m.data BETWEEN @ini AND @fim AND (m.tipo IN ('entrada','devolucao') OR (m.tipo='ajuste' AND m.quantidade>0)) THEN m.quantidade END),0) AS entrou,
      COALESCE(SUM(CASE WHEN m.data BETWEEN @ini AND @fim AND m.tipo='producao' THEN m.quantidade END),0) AS produzido,
      COALESCE(SUM(CASE WHEN m.data BETWEEN @ini AND @fim AND m.tipo IN ('venda','saida') THEN -m.quantidade END),0) AS saiu,
      COALESCE(SUM(CASE WHEN m.data BETWEEN @ini AND @fim AND m.tipo='retirada' THEN -m.quantidade END),0) AS retirado,
      COALESCE(SUM(CASE WHEN m.data BETWEEN @ini AND @fim AND (m.tipo='perda' OR (m.tipo='ajuste' AND m.quantidade<0)) THEN -m.quantidade END),0) AS perdido,
      COALESCE(SUM(m.quantidade),0) AS saldo,
      COALESCE((SELECT SUM(planejado) FROM ordens_producao o WHERE o.produto_id = p.id AND o.cancelada = 0 AND o.data BETWEEN @ini AND @fim),0) AS planejado
     FROM produtos p LEFT JOIN estoque_movimentos m ON m.produto_id = p.id WHERE p.ativo = 1 GROUP BY p.id ORDER BY p.nome COLLATE NOCASE`,
    { ini: inicio, fim },
  ).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' && !['id', 'estoque_minimo'].includes(k) ? round3(v) : v])));
}
