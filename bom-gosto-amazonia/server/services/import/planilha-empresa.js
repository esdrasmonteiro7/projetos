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
import { numeroNorm, docNorm, docBase, docTemParcela, escolher, mudancasDoTitulo, criarDiarioDeAlteracoes } from './sync-comum.js';
import { estadoDeVendas, anotarNota, aplicarNota, acharProdutoDaNota } from './notas-sync.js';

export { numeroNorm, docNorm };

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
  const sv = estadoDeVendas();
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
  return { vendas: sv.porNumero, porNumero: sv.porNumero, porChave: sv.porChave, semNumero: sv.semNumero, titulos, movimentos };
}

/** Quanto falta para a venda ter dívidas somando o total dela (o que ainda cabe criar sem duplicar). */
function folgaDaVenda(venda) {
  const soma = db.get('SELECT COALESCE(SUM(valor_centavos), 0) AS s FROM titulos WHERE venda_id = ? AND cancelado = 0', venda.id).s;
  return venda.total_centavos - soma;
}

/**
 * O boleto não existe com este documento, mas a NOTA dele já está no painel com outra divisão de parcelas (ex.: a lista diz "851"
 * de R$ 19.200 e o painel tem "851-01" e "851-02" de R$ 9.600)? Criar de novo duplicaria a dívida: devolve o motivo para não criar.
 */
function motivoDeNaoCriarBoleto(r, est) {
  const base = docBase(r.documento);
  const venda = (est.porNumero.get(base) || [])[0];
  if (venda) {
    const atuais = db.all('SELECT documento, valor_centavos FROM titulos WHERE venda_id = ? AND cancelado = 0', venda.id);
    if (r.valor_centavos > folgaDaVenda(venda)) return `A NF ${base} já está no painel com ${atuais.length === 1 ? 'a dívida' : 'as dívidas'} ${atuais.map((t) => t.documento || '—').join(', ')} (${fmtBRL(atuais.reduce((a, t) => a + t.valor_centavos, 0))} de ${fmtBRL(venda.total_centavos)}): o boleto ${r.documento} não foi criado de novo para não duplicar a dívida.`;
    return null;
  }
  const outros = db.all('SELECT documento FROM titulos WHERE venda_id IS NULL AND cancelado = 0 AND documento IS NOT NULL').filter((t) => docBase(t.documento) === base && docTemParcela(t.documento) !== docTemParcela(r.documento));
  if (outros.length) return `A NF ${base} já tem dívida no painel com outra divisão de parcelas (${outros.map((t) => t.documento).join(', ')}): o boleto ${r.documento} não foi criado de novo para não duplicar.`;
  return null;
}

/**
 * Relatório de VENCIDOS do banco: dívidas que o painel tem em aberto, vencidas no período do relatório, e que o banco NÃO lista
 * (provavelmente já foram pagas — ou nunca foram boleto). Só avisa: quem decide se está paga é a pessoa.
 */
export function avisosDoBanco(rel) {
  if (!rel.periodo?.de || !/vencid/i.test(rel.consulta || '')) return [];
  const doBanco = new Set(rel.linhas.map((l) => docNorm(l.seu_numero)));
  const mesmaDivida = new Set(rel.linhas.map((l) => `${docBase(l.seu_numero)}|${l.valor_centavos}|${l.vencimento}`)); // "818" na lista × "0818-01" no banco
  const faltam = db.all(
    `SELECT t.documento, t.vencimento, t.valor_centavos - t.pago_centavos AS aberto, c.nome FROM v_titulos t LEFT JOIN clientes c ON c.id = t.cliente_id
     WHERE t.cancelado = 0 AND t.valor_centavos - t.pago_centavos > 0 AND t.vencimento >= ? AND t.vencimento <= ? ORDER BY t.vencimento, t.id`, rel.periodo.de, rel.periodo.ate,
  ).filter((t) => !doBanco.has(docNorm(t.documento)) && !mesmaDivida.has(`${docBase(t.documento)}|${t.aberto}|${t.vencimento}`));
  if (!faltam.length) return [];
  const lista = faltam.slice(0, 12).map((t) => `${t.documento || 'sem nº'} ${t.nome || ''} ${fmtBRL(t.aberto)}`.replace(/\s+/g, ' ').trim()).join('; ');
  return [`${faltam.length} ${faltam.length === 1 ? 'dívida em aberto' : 'dívidas em aberto'} no painel, com vencimento entre ${fmtBR(rel.periodo.de)} e ${fmtBR(rel.periodo.ate)}, NÃO ${faltam.length === 1 ? 'aparece' : 'aparecem'} na lista de vencidos do banco (talvez já ${faltam.length === 1 ? 'tenha sido paga' : 'tenham sido pagas'}, ou não ${faltam.length === 1 ? 'seja' : 'sejam'} boleto): ${lista}${faltam.length > 12 ? '…' : ''}. Confira e dê baixa se for o caso.`];
}

/** A mesma dívida escrita de outro jeito: mesma nota, mesmo valor e mesmo vencimento ("818" na lista × "0818-01" no banco). */
function tituloEquivalente(r) {
  const base = docBase(r.documento);
  return db.all('SELECT * FROM v_titulos WHERE cancelado = 0 AND documento IS NOT NULL AND valor_centavos = ? AND vencimento = ?', r.valor_centavos, r.vencimento).find((t) => docBase(t.documento) === base) || null;
}

/** Boleto do banco: guarda o "nosso número" nas observações da dívida (uma vez só). */
const nossoNumeroNovo = (t, r) => (r.nosso_numero && !String(t.observacoes || '').includes(r.nosso_numero) ? `Boleto Sicoob nº ${r.nosso_numero}` : null);

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
  let conferir = 0;
  for (const r of registros) {
    r._acao = 'igual';
    r._mudancas = [];
    if (r.op === 'cancelar' || (r.op === 'venda' && (r.fonte === 'nfe' || r.fonte === 'relatorio'))) {
      const a = anotarNota(r, est, pidx);
      r._acao = a.acao;
      r._mudancas = a.mudancas;
      r._avisos.push(...a.avisos);
    } else if (r.op === 'boleto') {
      const t = escolher(est.titulos.get(docNorm(r.documento)), r._cliente?.id, r.situacao === 'cancelado') || (r.situacao === 'aberto' ? tituloEquivalente(r) : null);
      if (!t) {
        const motivo = r.situacao === 'aberto' ? motivoDeNaoCriarBoleto(r, est) : null;
        if (motivo) { r._acao = 'conferir'; r._avisos.push(motivo); } else r._acao = 'criar';
      } else {
        r._mudancas = mudancasDoTitulo(t, r);
        if (r.fonte === 'banco' && nossoNumeroNovo(db.get('SELECT observacoes FROM titulos WHERE id = ?', t.id), r)) r._mudancas.push({ tipo: 'nosso_numero', texto: `guardar o nº do boleto no banco (${r.nosso_numero})` });
        r._acao = r._mudancas.length ? 'atualizar' : 'igual';
        if (t.valor_centavos !== r.valor_centavos && r.situacao === 'aberto') r._avisos.push(`O valor no arquivo (${fmtBRL(r.valor_centavos)}) é diferente do já cadastrado (${fmtBRL(t.valor_centavos)}); o valor cadastrado foi mantido.`);
        if (r.fonte === 'banco' && r.situacao === 'aberto' && !t.cancelado && t.valor_centavos - t.pago_centavos <= 0) r._avisos.push('O banco ainda lista este boleto como vencido, mas no painel ele consta como PAGO. Se o cliente pagou por fora do boleto, falta dar a baixa no banco; se não, confira no painel.');
        if (r.fonte === 'banco' && t.cancelado) r._avisos.push('O banco lista este boleto, mas no painel ele está cancelado.');
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
          if (!t) {
            if (p.valor_centavos > folgaDaVenda(ex)) r._avisos.push(`A parcela ${p.documento} (${fmtBRL(p.valor_centavos)}) não foi criada: esta nota já tem dívidas que somam o total dela (talvez dividida de outro jeito).`);
            else r._mudancas.push({ tipo: 'parcela_nova', texto: `parcela ${p.documento} não existia` });
            continue;
          }
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
    r._incluir = r._incluir_forcado !== undefined ? r._incluir_forcado : !r._nao_incluir && r._acao !== 'igual' && r._acao !== 'conferir';
    if (r._acao === 'igual') r._avisos.push('Já está igual no painel.');
    if (r._acao === 'criar') criar++; else if (r._acao === 'atualizar') atualizar++; else if (r._acao === 'conferir') conferir++; else iguais++;
  }
  const valorDe = (r) => (r.op === 'venda' ? r.total_centavos : r.op === 'boleto' ? r.valor_centavos : 0);
  return { criar, atualizar, iguais, conferir, valor_total_centavos: registros.filter((r) => r._incluir).reduce((s, r) => s + valorDe(r), 0) };
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
  const guardar = criarDiarioDeAlteracoes(resultado); // como estavam as coisas que esta importação altera (para o "Desfazer")
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
    d.valor_centavos, d.cancelado ? 1 : 0, d.origem || 'planilha', d.observacoes || null, imp.id, user.id,
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
      else if (m.tipo === 'cancelar') { guardar('titulos', t.id); db.run('UPDATE titulos SET cancelado = 1 WHERE id = ?', t.id); resultado.criados.canceladas++; mexeu = true; }
      else if (m.tipo === 'vencimento') { guardar('titulos', t.id); db.run('UPDATE titulos SET vencimento = ? WHERE id = ?', alvo.vencimento, t.id); mexeu = true; }
    }
    return mexeu;
  };

  // notas fiscais (XML) e relatório de vendas: cada um tem o seu jeito de reconhecer o que já existe (notas-sync.js)
  const clienteDaNota = (c, vend, { cortado = false } = {}) => {
    if (!c?.nome) return null;
    if (cortado) { // o relatório corta o nome na coluna: vale um cliente cujo nome COMEÇA assim, se houver um só
      const k = norm(c.nome);
      const cands = db.all('SELECT id, vendedor_id, nome_norm FROM clientes WHERE ativo = 1').filter((x) => x.nome_norm.startsWith(k));
      if (cands.length === 1) return { id: cands[0].id, vendedor_id: cands[0].vendedor_id };
    }
    return cliente(c, vend);
  };
  const produtoDaNota = (i) => {
    const p = acharProdutoDaNota(i, pidx);
    if (p) {
      if (i.codigo && !p.sku && !pidx.find({ sku: i.codigo })) { // guarda o código de barras: as próximas notas casam por ele
        db.run('UPDATE produtos SET sku = ? WHERE id = ?', String(i.codigo), p.id);
        pidx.add({ ...p, sku: String(i.codigo) });
      }
      return p.id;
    }
    const id = criarProduto({ nome: i.descricao, sku: i.codigo || null, unidade: i.unidade || 'cx', preco_centavos: i.preco_centavos || 0, importacao_id: imp.id });
    pidx.add({ id, nome: i.descricao, nome_norm: norm(i.descricao), sku: i.codigo || null, unidade: i.unidade || 'cx' });
    resultado.criados.produtos++;
    return id;
  };
  const ctxNotas = { imp, user, resultado, est, pidx, vendedorId, guardar, cliente: clienteDaNota, produto: produtoDaNota, novoTitulo, pagarTitulo: (t, a) => pagarTitulo(t, a, ctx) };

  function processar(r) {
    if (r.op === 'cancelar' || (r.op === 'venda' && (r.fonte === 'nfe' || r.fonte === 'relatorio'))) { aplicarNota(r, ctxNotas); return; }
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

    if (r.op === 'boleto') {
      const f = r.cliente?.nome ? cidx.find(r.cliente) : null; // só procura: o cliente só é cadastrado se o boleto for novo
      const t = achar(r.documento, f && (f.tipo !== 'parecido' || f.score >= 0.93) ? f.cliente.id : null, null, r.situacao === 'cancelado') || (r.situacao === 'aberto' ? tituloEquivalente(r) : null);
      if (t) {
        let mexeu = aplicarMudancas(t, r);
        const nota = r.fonte === 'banco' ? nossoNumeroNovo(db.get('SELECT observacoes FROM titulos WHERE id = ?', t.id), r) : null;
        if (nota) { guardar('titulos', t.id); db.run("UPDATE titulos SET observacoes = CASE WHEN COALESCE(observacoes, '') = '' THEN ? ELSE observacoes || ' · ' || ? END WHERE id = ?", nota, nota, t.id); mexeu = true; }
        if (mexeu) resultado.criados.atualizados++;
        return;
      }
      if (r.situacao === 'aberto' && motivoDeNaoCriarBoleto(r, est)) return; // a nota já está no painel com outra divisão de parcelas
      const cli = cliente(r.cliente, vend);
      const id = novoTitulo({
        cliente_id: cli?.id, vendedor_id: vend || cli?.vendedor_id, documento: r.documento, emissao: r.emissao, vencimento: r.vencimento, valor_centavos: r.valor_centavos,
        cancelado: r.situacao === 'cancelado', descricao: r.fonte === 'banco' ? 'Boleto do banco (Sicoob)' : 'Boleto da lista de devedores', observacoes: r.observacoes, origem: r.fonte === 'banco' ? 'pdf' : 'planilha',
      });
      resultado.criados.titulos++;
      if (r.situacao === 'pago') pagarTitulo({ id }, { data: r.data_pagamento, forma: r.forma, pagador_nome: r.cliente.nome }, ctx);
      return;
    }

    if (r.op === 'venda') {
      const cli = cliente(r.cliente, vend);
      const vs = est.vendas.get(numeroNorm(r.numero)) || [];
      const ex = vs.find((v) => !cli || v.cliente_id === cli.id) || vs[0];
      if (ex) {
        let mexeu = false;
        for (const p of r.parcelas) {
          const t = achar(p.documento, cli?.id, ex.id);
          if (!t) {
            if (p.valor_centavos > folgaDaVenda(ex)) continue; // a nota já tem dívidas somando o total (talvez divididas de outro jeito): não duplica
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
          guardar('titulos', adotavel.id);
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
