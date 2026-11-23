// Importação das planilhas da própria empresa (Lista de Devedores e Controle de vendedores/depósito/produção).
//
// Em vez de "só criar", esta importação SINCRONIZA: ao enviar a planilha atualizada de novo, o que já existe é reconhecido
// (pela nota fiscal / boleto) e só é atualizado — por exemplo, uma parcela que estava em aberto e agora está paga.
// Nada é duplicado e nada que já foi pago é "despago" por engano.
//
// Registros ("operações") deste tipo de importação:
//   op: 'venda'   — uma nota (com itens por produto, parcelas e situação de cada parcela)
//   op: 'boleto'  — um boleto da lista de devedores (vira/atualiza uma dívida; se a nota existir, atualiza a parcela dela)
//   op: 'estoque' — movimento do depósito (produção, entrada, retirada por vendedor, outras saídas)
import { db } from '../../db.js';
import { norm } from '../../../shared/text.js';
import { fmtBR } from '../../../shared/dates.js';
import { fmtBRL } from '../../../shared/money.js';
import { ClienteIndex, ProdutoIndex, acharVendedor, criarCliente, criarVendedor, criarProduto } from '../entities.js';
import { registrarRecebimento, registrarBaixa, SINAL_ESTOQUE } from '../finance.js';
import { ordemAbertaDoProduto } from '../estoque.js';
import { canonizarVendedores, datasNoTexto } from './perfis-bomgosto.js';

// ------------------------------------------------------------------ chaves de comparação
/** "0793" → "793" */
export const numeroNorm = (n) => String(n ?? '').trim().replace(/^0+(?=\d)/, '');
/** "0793-01" / "793-1" → "793-01" ; "821" → "821" */
export const docNorm = (d) => String(d ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '').replace(/-0*(\d+)$/, (_, n) => `-${String(n).padStart(2, '0')}`);

const formaDoTexto = (t, padrao = 'boleto') => {
  const s = norm(t);
  if (/dinheiro/.test(s)) return 'dinheiro';
  if (/pix/.test(s)) return 'pix';
  if (/boleto/.test(s)) return 'boleto';
  if (/cart/.test(s)) return 'cartao';
  if (/transf|ted/.test(s)) return 'transferencia';
  return padrao;
};
const centavosDoTexto = (t) => {
  const m = /R\$\s*([\d.]+,\d{2}|\d+(?:\.\d{2})?)/.exec(String(t || ''));
  if (!m) return null;
  const n = m[1].includes(',') ? Number(m[1].replace(/\./g, '').replace(',', '.')) : Number(m[1]);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const corta = (s, n) => (s ? String(s).slice(0, n) : null);

// ================================================================== 1) planilha → operações
/** Lista de Devedores → operações 'boleto'. */
export function operacoesDeDevedores({ boletos }, { vendedoresExistentes = [] } = {}) {
  const canon = canonizarVendedores(boletos.map((b) => b.vendedor), vendedoresExistentes);
  const registros = [];
  const avisos = [];
  for (const b of boletos) {
    const onde = `${b.aba}, linha ${b.linha}`;
    const padrao = ['pago', 'vencido', 'aberto', 'baixado', ''].includes(b.situacao);
    const situacao = b.situacao === 'pago' ? 'pago' : b.situacao === 'baixado' || !padrao ? 'cancelado' : 'aberto';
    let valor = situacao === 'aberto' ? (b.valor_centavos ?? b.pago_centavos) : (b.valor_centavos ?? b.pago_centavos ?? centavosDoTexto(b.observacao));
    if (!(valor > 0)) { avisos.push(`${onde}: ${b.cliente} (NF ${b.documento}) ${situacao === 'pago' ? 'consta como paga' : situacao === 'cancelado' ? 'foi baixada/cancelada' : 'está sem valor'}, mas a planilha não informa o valor — não importada.`); continue; }
    if (!b.vencimento) { avisos.push(`${onde}: ${b.cliente} (NF ${b.documento}) sem data de vencimento — não importada.`); continue; }
    const av = [];
    let dataPg = null;
    if (situacao === 'pago') {
      dataPg = b.data_pagamento || datasNoTexto(b.observacao, b.vencimento).at(-1) || null;
      if (!dataPg) { dataPg = b.vencimento; av.push('A planilha não informa quando foi paga: usei a data do vencimento.'); }
    }
    const nota = [!padrao ? b.situacao.toUpperCase() : '', b.observacao, b.boleto ? `Boleto ${b.boleto}` : ''].filter(Boolean).join(' · ');
    registros.push({
      op: 'boleto',
      _linha: `${b.aba}:${b.linha}`,
      documento: b.nf?.chave || b.documento,
      cliente: { nome: b.cliente },
      vendedor_nome: canon(b.vendedor),
      emissao: b.emissao,
      vencimento: b.vencimento,
      valor_centavos: valor,
      situacao,
      data_pagamento: dataPg,
      forma: formaDoTexto(b.observacao, 'boleto'),
      observacoes: corta(nota, 300),
      _avisos: av,
    });
  }
  return { registros, produtos: [], avisos };
}

/** Distribui o total da nota entre os produtos, proporcional ao preço de vendedor (a planilha só informa o total da nota). */
function itensComValor(itens, totalCentavos, precos) {
  if (!itens.length) return [];
  let pesos = itens.map((i) => i.quantidade * (precos[i.produto] || 0));
  let soma = pesos.reduce((a, b) => a + b, 0);
  if (!(soma > 0)) { pesos = itens.map((i) => i.quantidade); soma = pesos.reduce((a, b) => a + b, 0); }
  let acumulado = 0;
  return itens.map((i, k) => {
    const total = k === itens.length - 1 ? totalCentavos - acumulado : Math.round((totalCentavos * pesos[k]) / soma);
    acumulado += total;
    return { descricao: i.produto, quantidade: i.quantidade, unidade: 'cx', total_centavos: total, preco_centavos: Math.round(total / i.quantidade) };
  });
}

/** Controle → operações 'venda' (uma por nota) e 'estoque' (produção, entradas, retiradas). */
export function operacoesDeControle(ctl, { vendedoresExistentes = [] } = {}) {
  const todosVendedores = [...ctl.vendas.map((l) => l.vendedor), ...ctl.deposito.saidas.map((s) => s.vendedor)];
  const canon = canonizarVendedores(todosVendedores, vendedoresExistentes);
  const registros = [];
  const avisos = [...ctl.avisos];

  // ---- vendas: junta as linhas "900-01" e "900-02" na mesma nota
  const grupos = new Map();
  for (const l of ctl.vendas) {
    const k = `${l.nf.base}|${norm(l.cliente)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  }
  for (const linhas of grupos.values()) {
    linhas.sort((a, b) => (a.nf.suf || '').localeCompare(b.nf.suf || ''));
    const p = linhas[0];
    const qtd = new Map();
    for (const l of linhas) for (const i of l.itens) qtd.set(i.produto, (qtd.get(i.produto) || 0) + i.quantidade);
    const total = linhas.reduce((s, l) => s + l.valor_centavos, 0);
    const itens = itensComValor([...qtd.entries()].map(([produto, quantidade]) => ({ produto, quantidade })), total, ctl.precos);
    const data = linhas.map((l) => l.data).sort()[0];
    const parcelas = linhas.map((l) => {
      const pago = l.situacao === 'pago';
      const datas = datasNoTexto(l.recebimento, l.data);
      const dinheiro = /dinheiro/i.test(l.recebimento);
      return {
        documento: l.nf.chave,
        vencimento: l.vencimento || l.data,
        valor_centavos: l.valor_centavos,
        pago,
        data_pagamento: pago ? (dinheiro ? l.data : datas.at(-1) || l.vencimento || l.data) : null,
        forma: pago ? formaDoTexto(l.recebimento, dinheiro ? 'dinheiro' : 'boleto') : null,
      };
    });
    const aPrazo = linhas.some((l) => /prazo/i.test(l.recebimento));
    registros.push({
      op: 'venda',
      _linha: `${p.aba}:${linhas.map((l) => l.linha).join('+')}`,
      numero: p.nf.base,
      data,
      cliente: { nome: p.cliente },
      vendedor_nome: canon(p.vendedor),
      itens,
      total_centavos: total,
      forma_pagamento: aPrazo ? 'prazo' : 'dinheiro',
      parcelas,
      observacoes: corta([...new Set(linhas.map((l) => l.recebimento).filter(Boolean))].join(' | '), 300),
      _avisos: [],
    });
  }

  // ---- depósito: produção, entradas e saídas
  const precoDe = (nome) => ctl.precos[nome] || 0;
  const mov = [];
  for (const r of ctl.producao) mov.push({ op: 'estoque', _linha: `Produção:${r.linha}`, tipo: 'producao', data: r.data, produto_nome: r.produto, quantidade: r.quantidade, vendedor_nome: null, valor_unit_centavos: 0, observacoes: 'Aba de produção', _avisos: [] });
  for (const e of ctl.deposito.entradas) {
    const igualAProducao = ctl.producao.some((p) => p.produto === e.produto && p.quantidade === e.quantidade && Math.abs((Date.parse(p.data) - Date.parse(e.data)) / 86400000) <= 3);
    if (igualAProducao) { avisos.push(`Depósito, linha ${e.linha}: "${e.descricao || 'entrada'}" de ${e.quantidade} cx de ${e.produto} em ${fmtBR(e.data)} é a mesma produção já lançada na aba de produção — não contei duas vezes.`); continue; }
    mov.push({ op: 'estoque', _linha: `Depósito:${e.linha}`, tipo: 'entrada', data: e.data, produto_nome: e.produto, quantidade: e.quantidade, vendedor_nome: null, valor_unit_centavos: 0, observacoes: corta(e.descricao, 200), _avisos: [] });
  }
  for (const s of ctl.deposito.saidas) {
    const vend = canon(s.vendedor);
    mov.push({
      op: 'estoque', _linha: `Depósito:${s.linha}`, tipo: vend ? 'retirada' : 'saida', data: s.data, produto_nome: s.produto, quantidade: s.quantidade,
      vendedor_nome: vend, valor_unit_centavos: vend ? precoDe(s.produto) : 0, observacoes: corta(s.destino ? `Destino: ${s.destino}` : null, 200), _avisos: [],
    });
  }
  registros.push(...mov);

  const produtos = ctl.produtos.map((nome) => ({ nome, unidade: 'cx', preco_centavos: ctl.precos[nome] || 0 }));
  return { registros, produtos, avisos };
}

// ================================================================== 2) pré-visualização (o que seria feito)
function estado() {
  const vendas = new Map();
  for (const v of db.all("SELECT id, numero, cliente_id FROM vendas WHERE status = 'ativa' AND numero IS NOT NULL")) {
    const k = numeroNorm(v.numero);
    if (!vendas.has(k)) vendas.set(k, []);
    vendas.get(k).push(v);
  }
  const titulos = new Map();
  for (const t of db.all('SELECT id, venda_id, cliente_id, documento, vencimento, valor_centavos, cancelado, pago_centavos FROM v_titulos WHERE documento IS NOT NULL')) {
    const k = docNorm(t.documento);
    if (!titulos.has(k)) titulos.set(k, []);
    titulos.get(k).push(t);
  }
  const movimentos = new Map();
  for (const m of db.all('SELECT data, produto_id, tipo, quantidade, vendedor_id FROM estoque_movimentos')) {
    const k = `${m.data}|${m.produto_id}|${m.tipo}|${m.vendedor_id || 0}|${Math.abs(m.quantidade)}`;
    movimentos.set(k, (movimentos.get(k) || 0) + 1);
  }
  return { vendas, titulos, movimentos };
}

/** Acha a dívida certa entre as de mesmo documento. Cancelada só conta quando a planilha também a mostra como cancelada. */
const escolher = (lista, clienteId, incluirCancelados = false) => {
  const l = (lista || []).filter((t) => incluirCancelados || !t.cancelado);
  return l.find((t) => clienteId && t.cliente_id === clienteId) || l[0] || null;
};

/** O que mudaria numa dívida/parcela existente `t` se aplicássemos "alvo" (situação vinda da planilha). */
function mudancasDoTitulo(t, alvo) {
  const m = [];
  const aberto = t.valor_centavos - (t.pago_centavos || 0);
  if (alvo.situacao === 'pago' && aberto > 0) m.push({ tipo: 'pagar', texto: `marcar como paga em ${fmtBR(alvo.data_pagamento)}` });
  if (alvo.situacao === 'cancelado' && !t.cancelado && !(t.pago_centavos > 0)) m.push({ tipo: 'cancelar', texto: 'cancelar (baixa a pedido do cedente)' });
  if (t.cancelado) return m; // dívida já cancelada no painel: nada mais a mudar
  if (alvo.situacao === 'aberto' && aberto > 0 && alvo.vencimento && alvo.vencimento !== t.vencimento) m.push({ tipo: 'vencimento', texto: `vencimento ${fmtBR(t.vencimento)} → ${fmtBR(alvo.vencimento)}` });
  return m;
}

/**
 * Marca cada operação com a ação ('criar' | 'atualizar' | 'igual') e os avisos. Chamada a cada vez que a prévia é salva.
 * Os campos _vendedor/_cliente já foram preenchidos pelo reconhecimento geral de nomes (analisar.js).
 */
export function anotarPlanilha(registros) {
  const est = estado();
  const pidx = new ProdutoIndex();
  const usados = new Map(); // contagem de movimentos iguais dentro da própria planilha
  let criar = 0;
  let atualizar = 0;
  let iguais = 0;
  for (const r of registros) {
    r._acao = 'igual';
    r._mudancas = [];
    if (r.op === 'boleto') {
      const t = escolher(est.titulos.get(docNorm(r.documento)), r._cliente?.id, r.situacao === 'cancelado');
      if (!t) { r._acao = 'criar'; }
      else {
        r._mudancas = mudancasDoTitulo(t, r);
        r._acao = r._mudancas.length ? 'atualizar' : 'igual';
        if (t.valor_centavos !== r.valor_centavos && r.situacao === 'aberto') r._avisos.push(`O valor na planilha (${fmtBRL(r.valor_centavos)}) é diferente do já cadastrado (${fmtBRL(t.valor_centavos)}); o valor cadastrado foi mantido.`);
      }
    } else if (r.op === 'venda') {
      const vs = est.vendas.get(numeroNorm(r.numero));
      const ex = (vs || []).find((v) => !r._cliente?.id || v.cliente_id === r._cliente.id) || (vs || [])[0];
      let adota = 0;
      if (!ex) {
        r._acao = 'criar';
        for (const p of r.parcelas) if ((est.titulos.get(docNorm(p.documento)) || []).some((t) => !t.venda_id && !t.cancelado)) adota++;
        if (adota) r._avisos.push(`${adota === 1 ? 'Já existe 1 boleto' : `Já existem ${adota} boletos`} desta nota na lista de devedores: ${adota === 1 ? 'ele passa' : 'eles passam'} a fazer parte desta venda.`);
      } else {
        for (const p of r.parcelas) {
          const t = escolher((est.titulos.get(docNorm(p.documento)) || []).filter((x) => x.venda_id === ex.id || !x.venda_id), r._cliente?.id);
          if (!t) { r._mudancas.push({ tipo: 'parcela_nova', texto: `parcela ${p.documento} não existia` }); continue; }
          r._mudancas.push(...mudancasDoTitulo(t, { situacao: p.pago ? 'pago' : 'aberto', data_pagamento: p.data_pagamento, vencimento: p.vencimento }).map((m) => ({ ...m, texto: `${p.documento}: ${m.texto}` })));
        }
        r._acao = r._mudancas.length ? 'atualizar' : 'igual';
      }
    } else if (r.op === 'estoque') {
      const p = pidx.find({ nome: r.produto_nome });
      const vend = r.vendedor_nome ? acharVendedor(r.vendedor_nome) : null;
      r._produto = p ? { id: p.id, nome: p.nome } : null;
      if (p && (!r.vendedor_nome || vend)) {
        const k = `${r.data}|${p.id}|${r.tipo}|${vend?.id || 0}|${Math.abs(r.quantidade)}`;
        const n = (usados.get(k) || 0) + 1;
        usados.set(k, n);
        if ((est.movimentos.get(k) || 0) >= n) r._acao = 'igual'; else r._acao = 'criar';
      } else r._acao = 'criar';
    }
    if (r._mudancas.length) r._avisos.push(`Atualiza: ${r._mudancas.map((m) => m.texto).join('; ')}`);
    r._incluir = r._incluir_forcado !== undefined ? r._incluir_forcado : r._acao !== 'igual';
    if (r._acao === 'igual') r._avisos.push('Já está igual no painel.');
    if (r._acao === 'criar') criar++; else if (r._acao === 'atualizar') atualizar++; else iguais++;
  }
  const valorDe = (r) => (r.op === 'venda' ? r.total_centavos : r.op === 'boleto' ? r.valor_centavos : 0);
  return { criar, atualizar, iguais, valor_total_centavos: registros.filter((r) => r._incluir).reduce((s, r) => s + valorDe(r), 0) };
}

// ================================================================== 3) aplicar no banco
function recarregarTitulo(id) { return db.get('SELECT * FROM v_titulos WHERE id = ?', id); }

/** Registra o pagamento (ou o que falta dele) de uma dívida: cria o recebimento e a baixa. */
function pagarTitulo(t, { data, forma, valor_centavos = null, pagador_nome = null, observacoes = null }, ctx) {
  const atual = recarregarTitulo(t.id);
  const aberto = atual.valor_centavos - (atual.pago_centavos || 0);
  if (aberto <= 0 || atual.cancelado) return false;
  const valor = Math.min(aberto, valor_centavos ?? aberto);
  const rid = registrarRecebimento({
    data, valor_centavos: valor, forma: forma || 'boleto', pagador_nome, cliente_id: atual.cliente_id, vendedor_id: atual.vendedor_id,
    origem: 'baixa', importacao_id: ctx.imp.id, user_id: ctx.user.id, observacoes: observacoes || 'Baixa vinda da planilha',
  });
  registrarBaixa({ titulo_id: atual.id, recebimento_id: rid, valor_centavos: valor, data, user_id: ctx.user.id });
  ctx.resultado.criados.recebimentos++;
  return true;
}

/**
 * Aplica as operações marcadas. Mesmo formato de retorno do importador comum
 * ({ criados, ignoradas, erros }) mais "atualizados".
 */
export function aplicarPlanilha(imp, dados, pedido, user) {
  const registros = dados.registros;
  const excluir = new Set((pedido.excluir || []).map(String));
  const incluirEsc = pedido.incluir ? new Set(pedido.incluir.map(String)) : null;
  const resultado = { criados: { vendas: 0, titulos: 0, recebimentos: 0, clientes: 0, produtos: 0, vendedores: 0, movimentos: 0, baixas_automaticas: 0, canceladas: 0, atualizados: 0 }, ignoradas: [], erros: [] };
  const ctx = { imp, user, resultado };
  const mapaV = pedido.mapa_vendedores || {};
  const mapaC = pedido.mapa_clientes || {};
  const contados = new Map(); // movimentos iguais já tratados nesta importação
  const vendedores = db.all('SELECT id, nome, nome_norm, ativo FROM vendedores');
  const cidx = new ClienteIndex();
  const pidx = new ProdutoIndex();
  const infoProduto = new Map((dados.produtos || []).map((p) => [norm(p.nome), p]));
  const est = estado();

  const novoVendedor = (nome) => {
    const k = norm(nome);
    const ex = vendedores.find((v) => v.nome_norm === k);
    if (ex) return ex.id;
    const id = criarVendedor({ nome });
    vendedores.push({ id, nome, nome_norm: k, ativo: 1 });
    resultado.criados.vendedores++;
    return id;
  };
  const vendedorId = (nome) => {
    if (!nome) return null;
    const k = norm(nome);
    if (Object.prototype.hasOwnProperty.call(mapaV, k)) { const v = mapaV[k]; return v === 'novo' ? novoVendedor(nome) : v ? Number(v) : null; }
    const m = acharVendedor(nome, vendedores);
    return m ? m.id : novoVendedor(nome);
  };
  const cliente = (c, vend) => {
    if (!c?.nome) return null;
    const escolha = mapaC[norm(c.nome)];
    if (escolha && escolha !== 'novo') { const ex = db.get('SELECT id, vendedor_id FROM clientes WHERE id = ?', Number(escolha)); if (ex) return ex; }
    const f = escolha === 'novo' ? null : cidx.find(c);
    if (f && (f.tipo !== 'parecido' || f.score >= 0.93)) return db.get('SELECT id, vendedor_id FROM clientes WHERE id = ?', f.cliente.id);
    const id = criarCliente({ nome: c.nome, documento: c.documento, vendedor_id: vend, importacao_id: imp.id });
    cidx.add({ id, nome: c.nome, nome_norm: norm(c.nome), documento: c.documento, ativo: 1 });
    resultado.criados.clientes++;
    return { id, vendedor_id: vend };
  };
  const produto = (nome) => {
    const p = pidx.find({ nome });
    if (p) return p.id;
    const info = infoProduto.get(norm(nome));
    const id = criarProduto({ nome, unidade: info?.unidade || 'cx', preco_centavos: info?.preco_centavos || 0, importacao_id: imp.id });
    pidx.add({ id, nome, nome_norm: norm(nome), unidade: info?.unidade || 'cx' });
    resultado.criados.produtos++;
    return id;
  };
  const novoTitulo = (d) => db.run(
    `INSERT INTO titulos (venda_id, cliente_id, vendedor_id, documento, parcela, descricao, emissao, vencimento, valor_centavos, cancelado, origem, observacoes, importacao_id, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    d.venda_id || null, d.cliente_id || null, d.vendedor_id || null, d.documento, d.parcela || null, d.descricao || null, d.emissao || null, d.vencimento,
    d.valor_centavos, d.cancelado ? 1 : 0, 'planilha', d.observacoes || null, imp.id, user.id,
  ).id;
  const achar = (documento, clienteId, soDaVenda = null, incluirCancelados = false) => {
    const lista = (est.titulos.get(docNorm(documento)) || []).map((t) => recarregarTitulo(t.id)).filter(Boolean).filter((t) => soDaVenda === null || t.venda_id === soDaVenda || !t.venda_id);
    return escolher(lista, clienteId, incluirCancelados);
  };
  const aplicarMudancas = (t, alvo) => {
    let mexeu = false;
    const ms = mudancasDoTitulo(recarregarTitulo(t.id), alvo);
    for (const m of ms) {
      if (m.tipo === 'pagar') { if (pagarTitulo(t, { data: alvo.data_pagamento || alvo.vencimento, forma: alvo.forma }, ctx)) mexeu = true; }
      else if (m.tipo === 'cancelar') { db.run('UPDATE titulos SET cancelado = 1 WHERE id = ?', t.id); resultado.criados.canceladas++; mexeu = true; }
      else if (m.tipo === 'vencimento') { db.run('UPDATE titulos SET vencimento = ? WHERE id = ?', alvo.vencimento, t.id); mexeu = true; }
    }
    return mexeu;
  };

  function processar(r) {
    const vend = vendedorId(r.vendedor_nome);
    if (r.op === 'estoque') {
      const pid = produto(r.produto_nome);
      const k = `${r.data}|${pid}|${r.tipo}|${vend || 0}|${Math.abs(r.quantidade)}`;
      const faltam = (contados.get(k) || 0) + 1;
      contados.set(k, faltam);
      if ((est.movimentos.get(k) || 0) >= faltam) return; // já existia
      const sinal = SINAL_ESTOQUE[r.tipo] ?? 1;
      db.run(
        `INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, vendedor_id, valor_unit_centavos, ordem_producao_id, observacoes, importacao_id, criado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        r.data, pid, r.tipo, sinal * Math.abs(r.quantidade), vend, r.valor_unit_centavos || 0, r.tipo === 'producao' ? ordemAbertaDoProduto(pid, r.data) : null, r.observacoes || null, imp.id, user.id,
      );
      resultado.criados.movimentos++;
      return;
    }

    const cli = cliente(r.cliente, vend);
    if (r.op === 'boleto') {
      const t = achar(r.documento, cli?.id, null, r.situacao === 'cancelado');
      if (t) { if (aplicarMudancas(t, r)) resultado.criados.atualizados++; return; }
      const id = novoTitulo({
        cliente_id: cli?.id, vendedor_id: vend || cli?.vendedor_id, documento: r.documento, emissao: r.emissao, vencimento: r.vencimento, valor_centavos: r.valor_centavos,
        cancelado: r.situacao === 'cancelado', descricao: 'Boleto da lista de devedores', observacoes: r.observacoes,
      });
      resultado.criados.titulos++;
      if (r.situacao === 'pago') pagarTitulo({ id }, { data: r.data_pagamento, forma: r.forma, pagador_nome: r.cliente.nome }, ctx);
      return;
    }

    if (r.op === 'venda') {
      const vs = est.vendas.get(numeroNorm(r.numero)) || [];
      const ex = vs.find((v) => !cli || v.cliente_id === cli.id) || vs[0];
      if (ex) {
        let mexeu = false;
        for (const p of r.parcelas) {
          const t = achar(p.documento, cli?.id, ex.id);
          if (!t) {
            const id = novoTitulo({ venda_id: ex.id, cliente_id: cli?.id, vendedor_id: vend, documento: p.documento, parcela: null, emissao: r.data, vencimento: p.vencimento, valor_centavos: p.valor_centavos });
            resultado.criados.titulos++; mexeu = true;
            if (p.pago) pagarTitulo({ id }, { data: p.data_pagamento, forma: p.forma, pagador_nome: r.cliente.nome }, ctx);
          } else if (aplicarMudancas(t, { situacao: p.pago ? 'pago' : 'aberto', data_pagamento: p.data_pagamento, vencimento: p.vencimento, forma: p.forma })) mexeu = true;
        }
        if (mexeu) resultado.criados.atualizados++;
        return;
      }
      const vendaId = db.run(
        `INSERT INTO vendas (numero, data, cliente_id, vendedor_id, total_centavos, desconto_centavos, forma_pagamento, origem, observacoes, importacao_id, criado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        numeroNorm(r.numero), r.data, cli?.id || null, vend || cli?.vendedor_id || null, r.total_centavos, 0, r.forma_pagamento || null, 'planilha', r.observacoes || null, imp.id, user.id,
      ).id;
      for (const i of r.itens) {
        db.run(
          'INSERT INTO venda_itens (venda_id, produto_id, descricao, quantidade, unidade, preco_centavos, total_centavos) VALUES (?,?,?,?,?,?,?)',
          vendaId, produto(i.descricao), i.descricao, i.quantidade, i.unidade || 'cx', i.preco_centavos, i.total_centavos,
        );
      }
      const n = r.parcelas.length;
      r.parcelas.forEach((p, idx) => {
        const parcela = n > 1 ? `${idx + 1}/${n}` : null;
        const adotavel = achar(p.documento, cli?.id, null);
        let tid;
        if (adotavel && !adotavel.venda_id) {
          db.run('UPDATE titulos SET venda_id = ?, parcela = COALESCE(parcela, ?), cliente_id = COALESCE(cliente_id, ?), vendedor_id = COALESCE(vendedor_id, ?), emissao = COALESCE(emissao, ?) WHERE id = ?', vendaId, parcela, cli?.id || null, vend || null, r.data, adotavel.id);
          tid = adotavel.id;
        } else {
          tid = novoTitulo({ venda_id: vendaId, cliente_id: cli?.id, vendedor_id: vend || cli?.vendedor_id, documento: p.documento, parcela, emissao: r.data, vencimento: p.vencimento, valor_centavos: p.valor_centavos });
          resultado.criados.titulos++;
        }
        aplicarMudancas({ id: tid }, { situacao: p.pago ? 'pago' : 'aberto', data_pagamento: p.data_pagamento, vencimento: p.vencimento, forma: p.forma });
      });
      resultado.criados.vendas++;
    }
  }

  db.tx(() => {
    registros.forEach((r, i) => {
      const k = String(r._id ?? i);
      const marcado = incluirEsc ? incluirEsc.has(k) : r._incluir !== false;
      if (!marcado || excluir.has(k)) { resultado.ignoradas.push({ linha: r._linha, motivo: r._acao === 'igual' ? 'já estava igual' : 'não marcado' }); return; }
      try {
        db.tx(() => processar(r));
      } catch (e) {
        resultado.erros.push({ linha: r._linha, erro: e.message });
      }
    });
  });
  return resultado;
}
