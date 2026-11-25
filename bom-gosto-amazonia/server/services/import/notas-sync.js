// Sincronização das NOTAS FISCAIS (XML) e do relatório de vendas do sistema com o que já existe no painel.
//
// A regra de ouro é "a mesma nota é a mesma venda": a nota é reconhecida pela chave de acesso ou pelo NÚMERO, mesmo que a venda
// tenha vindo antes de uma planilha. Nesse caso a venda é COMPLETADA (chave, CNPJ do cliente, itens e valores exatos, parcelas
// certas, vendedor) e nunca duplicada. Parcelas já pagas nunca são mexidas.
import { db } from '../../db.js';
import { norm, digits, nameScore } from '../../../shared/text.js';
import { fmtBR, daysBetween } from '../../../shared/dates.js';
import { fmtBRL } from '../../../shared/money.js';
import { cancelarVenda } from '../finance.js';
import { PRODUTOS_DA_NOTA } from './perfis-bomgosto.js';
import { numeroNorm, docNorm } from './sync-comum.js';

// ------------------------------------------------------------------ o que já existe
/** Vendas ativas do painel, por chave da nota, por número e as que ainda não têm número (ex.: venda do relatório sem nota). */
export function estadoDeVendas() {
  const rows = db.all(
    `SELECT v.id, v.numero, v.data, v.total_centavos, v.cliente_id, v.vendedor_id, v.chave_nfe, v.origem,
            c.nome AS cliente_nome, c.documento AS cliente_documento
     FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.status = 'ativa'`,
  );
  const porNumero = new Map();
  const porChave = new Map();
  const semNumero = [];
  for (const v of rows) {
    if (v.chave_nfe) porChave.set(v.chave_nfe, v);
    if (v.numero) {
      const k = numeroNorm(v.numero);
      if (!porNumero.has(k)) porNumero.set(k, []);
      porNumero.get(k).push(v);
    } else semNumero.push(v);
  }
  return { porNumero, porChave, semNumero };
}

function clienteCompativel(v, c) {
  if (!c?.nome && !c?.documento) return true;
  const d1 = digits(v.cliente_documento);
  const d2 = digits(c.documento);
  if (d1.length >= 11 && d2.length >= 11) return d1 === d2;
  const a = norm(v.cliente_nome);
  const b = norm(c.nome);
  if (!a || !b) return false;
  if (a === b) return true;
  const [curto, longo] = a.length < b.length ? [a, b] : [b, a];
  if (curto.length >= 8 && longo.startsWith(curto)) return true; // o relatório corta o nome do cliente
  return nameScore(a, b) >= 0.85;
}

/** A venda do painel que corresponde a esta nota: pela chave, pelo número, ou (nota recém-emitida) por uma venda sem número igual. */
export function acharVenda(r, est) {
  if (r.chave_nfe && est.porChave.has(r.chave_nfe)) return est.porChave.get(r.chave_nfe);
  const n = r.numero ? numeroNorm(r.numero) : null;
  if (n && est.porNumero.has(n)) {
    const lista = est.porNumero.get(n);
    return lista.find((v) => clienteCompativel(v, r.cliente)) || lista[0];
  }
  const folga = n ? 7 : 0; // venda sem nota que agora ganhou número: a nota pode sair alguns dias depois
  const cand = est.semNumero.filter((v) => v.total_centavos === r.total_centavos && r.data && v.data && Math.abs(daysBetween(v.data, r.data)) <= folga && clienteCompativel(v, r.cliente));
  return cand.length === 1 ? cand[0] : null;
}

/** Marca na memória (e no mapa) uma venda que acabou de ser criada nesta importação. */
const registrarNoEstado = (est, v) => {
  if (v.chave_nfe) est.porChave.set(v.chave_nfe, v);
  if (v.numero) {
    const k = numeroNorm(v.numero);
    if (!est.porNumero.has(k)) est.porNumero.set(k, []);
    est.porNumero.get(k).push(v);
  } else est.semNumero.push(v);
};

// ------------------------------------------------------------------ produtos
/** O produto do painel que corresponde ao item da nota: pelo código de barras, pelo nome curto das planilhas ou pelo nome da nota. */
export function acharProdutoDaNota(item, pidx) {
  return (item.codigo && pidx.find({ sku: item.codigo }))
    || (PRODUTOS_DA_NOTA[item.codigo] && pidx.find({ nome: PRODUTOS_DA_NOTA[item.codigo] }))
    || pidx.find({ nome: item.descricao })
    || null;
}

const assinaturaItens = (lista) => lista.map((i) => `${i.produto_id ?? 'novo'}|${Number(i.quantidade)}|${i.total_centavos}`).sort().join(';');

// ------------------------------------------------------------------ parcelas
/**
 * Como deixar as dívidas da venda iguais às parcelas da nota, sem duplicar e sem mexer no que já foi pago.
 * @param venda   venda existente (ou null quando a venda vai ser criada)
 * @param plano   parcelas da nota [{ documento, vencimento, valor_centavos, pago, data_pagamento, forma }]
 */
export function planejarParcelas(venda, plano, clienteId) {
  const acoes = [];
  const avisos = [];
  const atuais = venda ? db.all('SELECT * FROM v_titulos WHERE venda_id = ? AND cancelado = 0 ORDER BY vencimento, id', venda.id) : [];
  const livres = db.all('SELECT * FROM v_titulos WHERE venda_id IS NULL AND cancelado = 0');
  const usados = new Set();
  const pares = [];
  for (const p of plano) {
    const k = p.documento ? docNorm(p.documento) : null;
    if (!k) continue;
    const t = atuais.find((x) => !usados.has(x.id) && docNorm(x.documento) === k)
      || livres.find((x) => !usados.has(x.id) && docNorm(x.documento) === k && (!clienteId || !x.cliente_id || x.cliente_id === clienteId));
    if (t) { usados.add(t.id); pares.push({ p, t }); }
  }
  const faltam = plano.filter((p) => !pares.some((x) => x.p === p));
  const sobram = atuais.filter((t) => !usados.has(t.id));
  const rotulo = (p) => `${p.documento || 'parcela'} ${fmtBRL(p.valor_centavos)} (venc. ${fmtBR(p.vencimento)})`;
  const parcelaTxt = (p) => (plano.length > 1 ? `${plano.indexOf(p) + 1}/${plano.length}` : null);

  for (const { p, t } of pares) {
    if (!t.venda_id) acoes.push({ tipo: 'adotar', titulo_id: t.id, documento: p.documento, parcela: parcelaTxt(p), texto: `ligar o boleto ${p.documento} a esta venda` });
    const aberto = t.valor_centavos - t.pago_centavos;
    if (p.pago && aberto > 0) acoes.push({ tipo: 'pagar', titulo_id: t.id, data: p.data_pagamento || p.vencimento, forma: p.forma, texto: `${p.documento}: marcar como paga em ${fmtBR(p.data_pagamento || p.vencimento)}` });
    else if (!p.pago && aberto > 0 && (t.valor_centavos !== p.valor_centavos || t.vencimento !== p.vencimento)) {
      avisos.push(`${p.documento}: no painel está ${fmtBRL(t.valor_centavos)} com vencimento ${fmtBR(t.vencimento)}; a nota diz ${fmtBRL(p.valor_centavos)} em ${fmtBR(p.vencimento)}. Mantive o do painel (pode ter sido renegociado).`);
    }
  }

  const soma = (l) => l.reduce((a, x) => a + x.valor_centavos, 0);
  if (faltam.length || sobram.length) {
    if (sobram.length && sobram.every((t) => t.valor_centavos - t.pago_centavos <= 0) && soma(sobram) === soma(faltam)) {
      // a mesma dívida, já totalmente paga, só dividida de outro jeito (ex.: 1 de 1.315 paga × 2 de 657,50 na nota): não há o que acertar
    } else if (sobram.some((t) => t.pago_centavos > 0)) {
      avisos.push(`As parcelas da nota não batem com as dívidas desta venda no painel e algumas já têm pagamento (${sobram.map((t) => t.documento || '—').join(', ')}): não mexi, confira à mão.`);
    } else {
      // dívidas ainda sem pagamento que não casam com nenhuma parcela da nota viram as parcelas que faltam (ex.: 1 dívida de 19.200 → 2 de 9.600)
      const ordemFaltam = [...faltam].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      const reaproveitar = sobram.slice(0, ordemFaltam.length);
      reaproveitar.forEach((t, i) => {
        const p = ordemFaltam[i];
        acoes.push({ tipo: 'ajustar', titulo_id: t.id, documento: p.documento, parcela: parcelaTxt(p), vencimento: p.vencimento, valor_centavos: p.valor_centavos, texto: `dívida ${t.documento || '—'} ${fmtBRL(t.valor_centavos)} passa a ser ${rotulo(p)}` });
        if (p.pago) acoes.push({ tipo: 'pagar', titulo_id: t.id, data: p.data_pagamento || p.vencimento, forma: p.forma, texto: `${p.documento}: marcar como paga` });
      });
      for (const p of ordemFaltam.slice(reaproveitar.length)) acoes.push({ tipo: 'criar', ...p, parcela: parcelaTxt(p), texto: `criar a parcela ${rotulo(p)}` });
      for (const t of sobram.slice(ordemFaltam.length)) {
        avisos.push(`A dívida ${t.documento || '—'} (${fmtBRL(t.valor_centavos)}) desta venda não existe na nota: não apaguei, confira.`);
      }
    }
  }
  return { acoes, avisos };
}

// ------------------------------------------------------------------ plano de uma venda
function camposDoCliente(clienteId, c) {
  if (!clienteId || !c) return {};
  const atual = db.get('SELECT documento, telefone, endereco, cidade, email FROM clientes WHERE id = ?', clienteId);
  if (!atual) return {};
  const out = {};
  const doc = digits(c.documento);
  if (!atual.documento && doc.length >= 11) out.documento = doc;
  for (const k of ['telefone', 'endereco', 'cidade', 'email']) if (!atual[k] && c[k] && !/^0+$/.test(digits(c[k]) || 'x')) out[k] = String(c[k]).slice(0, 160);
  if (c.telefone && /^0+$/.test(digits(c.telefone))) delete out.telefone;
  return out;
}

/**
 * Compara a nota com a venda do painel e diz o que mudaria. Serve para a prévia e para gravar (os dois usam o mesmo plano).
 * @param vendedorId id do vendedor que o arquivo indica (ou null/undefined quando não indica)
 */
export function planejarVenda(v, r, { pidx, vendedorId }) {
  const mudancas = [];
  const avisos = [];
  const campos = {};
  if (r.chave_nfe && !v.chave_nfe) { campos.chave_nfe = r.chave_nfe; mudancas.push({ tipo: 'chave', texto: 'registrar a chave da nota fiscal' }); }
  if (!v.numero && r.numero) { campos.numero = numeroNorm(r.numero); mudancas.push({ tipo: 'numero', texto: `numerar como NF ${numeroNorm(r.numero)}` }); }
  if (r.fonte === 'nfe') {
    if (r.total_centavos !== v.total_centavos) { campos.total_centavos = r.total_centavos; mudancas.push({ tipo: 'total', texto: `total ${fmtBRL(v.total_centavos)} → ${fmtBRL(r.total_centavos)}` }); }
    if (r.data && r.data !== v.data) { campos.data = r.data; mudancas.push({ tipo: 'data', texto: `data ${fmtBR(v.data)} → ${fmtBR(r.data)}` }); }
  } else if (r.total_centavos !== v.total_centavos) avisos.push(`O relatório tem esta nota com ${fmtBRL(r.total_centavos)} e o painel com ${fmtBRL(v.total_centavos)}; não mexi.`);
  if (vendedorId && !v.vendedor_id) { campos.vendedor_id = vendedorId; mudancas.push({ tipo: 'vendedor', texto: `vendedor: ${r.vendedor_nome}` }); }
  else if (vendedorId && v.vendedor_id !== vendedorId) {
    const atual = db.get('SELECT nome FROM vendedores WHERE id = ?', v.vendedor_id);
    avisos.push(`O vendedor da nota é ${r.vendedor_nome}, mas no painel está ${atual?.nome || '—'}: mantive o do painel.`);
  }
  if (!v.cliente_id && r.cliente?.nome) mudancas.push({ tipo: 'cliente', texto: 'ligar o cliente à venda' });
  const campoCliente = r.cliente_cortado ? {} : camposDoCliente(v.cliente_id, r.cliente);
  if (Object.keys(campoCliente).length) mudancas.push({ tipo: 'cadastro', texto: `completar o cadastro do cliente (${Object.keys(campoCliente).map((k) => ({ documento: 'CNPJ/CPF', telefone: 'telefone', endereco: 'endereço', cidade: 'cidade', email: 'e-mail' }[k])).join(', ')})` });
  if (campoCliente.documento) {
    const outro = db.get('SELECT nome FROM clientes WHERE documento = ? AND id <> ? LIMIT 1', campoCliente.documento, v.cliente_id);
    if (outro) avisos.push(`O CNPJ/CPF desta nota já está no cadastro de "${outro.nome}": pode ser o mesmo cliente cadastrado duas vezes.`);
  }

  let trocaItens = false;
  if (r.itens?.length) {
    const novos = r.itens.map((i) => ({ produto_id: acharProdutoDaNota(i, pidx)?.id ?? null, quantidade: i.quantidade, total_centavos: i.total_centavos }));
    const atuais = db.all('SELECT produto_id, quantidade, total_centavos FROM venda_itens WHERE venda_id = ?', v.id);
    if (assinaturaItens(novos) !== assinaturaItens(atuais)) { trocaItens = true; mudancas.push({ tipo: 'itens', texto: `itens e valores conforme a nota (${r.itens.length})` }); }
  }

  // só a nota fiscal sabe as parcelas de verdade; o relatório do sistema traz um vencimento provisório e não mexe nas dívidas de uma venda que já existe
  const parcelas = r.fonte === 'nfe' && r.parcelas?.length ? planejarParcelas(v, r.parcelas, v.cliente_id) : { acoes: [], avisos: [] };
  for (const a of parcelas.acoes) mudancas.push({ tipo: a.tipo, texto: a.texto });
  avisos.push(...parcelas.avisos);
  return { campos, campoCliente, trocaItens, parcelas, mudancas, avisos };
}

// ------------------------------------------------------------------ prévia
/** Ação ('criar' | 'atualizar' | 'igual') e avisos de uma nota ('venda') ou de um cancelamento ('cancelar'). */
export function anotarNota(r, est, pidx) {
  if (r.op === 'cancelar') {
    const v = acharVenda({ ...r, cliente: null, total_centavos: -1 }, est);
    return v ? { acao: 'atualizar', mudancas: [{ tipo: 'cancelar_venda', texto: 'cancelar esta venda no painel (nota cancelada)' }], avisos: [] } : { acao: 'igual', mudancas: [], avisos: ['Esta nota cancelada não está no painel: nada a fazer.'] };
  }
  const v = acharVenda(r, est);
  if (!v) return { acao: 'criar', mudancas: [], avisos: [] };
  if (r._nao_incluir) return { acao: 'igual', mudancas: [], avisos: ['Esta nota não vale como venda (não autorizada ou devolução): a venda do painel fica como está.'] };
  const plano = planejarVenda(v, r, { pidx, vendedorId: r._vendedor?.id ?? null });
  return { acao: plano.mudancas.length ? 'atualizar' : 'igual', mudancas: plano.mudancas, avisos: plano.avisos, venda: v };
}

// ------------------------------------------------------------------ gravar
const rotuloParcela = (acao) => ({ parcela: acao.parcela || null, observacoes: acao.provisorio ? 'Vencimento provisório (30 dias): o relatório do sistema não traz as parcelas. Quando o XML da nota chegar, elas são acertadas.' : null });

function executarParcelas(acoes, { vendaId, clienteId, vendedorId, emissao }, ctx) {
  let mexeu = false;
  for (const a of acoes) {
    if (a.tipo === 'adotar') {
      ctx.guardar('titulos', a.titulo_id);
      db.run('UPDATE titulos SET venda_id = ?, parcela = COALESCE(parcela, ?), cliente_id = COALESCE(cliente_id, ?), vendedor_id = COALESCE(vendedor_id, ?), emissao = COALESCE(emissao, ?) WHERE id = ?', vendaId, a.parcela, clienteId, vendedorId, emissao, a.titulo_id);
      mexeu = true;
    } else if (a.tipo === 'ajustar') {
      ctx.guardar('titulos', a.titulo_id);
      db.run('UPDATE titulos SET venda_id = ?, documento = ?, parcela = ?, vencimento = ?, valor_centavos = ?, cliente_id = COALESCE(cliente_id, ?), vendedor_id = COALESCE(vendedor_id, ?), emissao = COALESCE(emissao, ?) WHERE id = ?',
        vendaId, a.documento, a.parcela, a.vencimento, a.valor_centavos, clienteId, vendedorId, emissao, a.titulo_id);
      mexeu = true;
    } else if (a.tipo === 'criar') {
      const id = ctx.novoTitulo({ venda_id: vendaId, cliente_id: clienteId, vendedor_id: vendedorId, documento: a.documento, ...rotuloParcela(a), emissao, vencimento: a.vencimento, valor_centavos: a.valor_centavos, origem: ctx.origem });
      ctx.resultado.criados.titulos++;
      if (a.pago) ctx.pagarTitulo({ id }, { data: a.data_pagamento || a.vencimento, forma: a.forma, pagador_nome: ctx.pagador, observacoes: ctx.rotuloPagamento });
      mexeu = true;
    }
  }
  for (const a of acoes) if (a.tipo === 'pagar') { if (ctx.pagarTitulo({ id: a.titulo_id }, { data: a.data, forma: a.forma, pagador_nome: ctx.pagador, observacoes: ctx.rotuloPagamento })) mexeu = true; }
  return mexeu;
}

function trocarItens(vendaId, r, ctx) {
  db.run('DELETE FROM venda_itens WHERE venda_id = ?', vendaId);
  for (const i of r.itens) {
    const pid = ctx.produto(i);
    const nome = db.get('SELECT nome FROM produtos WHERE id = ?', pid)?.nome || i.descricao;
    db.run('INSERT INTO venda_itens (venda_id, produto_id, descricao, quantidade, unidade, preco_centavos, total_centavos) VALUES (?,?,?,?,?,?,?)', vendaId, pid, nome, i.quantidade, i.unidade || 'cx', i.preco_centavos, i.total_centavos);
  }
}

function atualizarVenda(v, r, vendedorId, ctx) {
  const plano = planejarVenda(v, r, { pidx: ctx.pidx, vendedorId });
  if (!plano.mudancas.length) return;
  const c = plano.campos;
  let clienteId = v.cliente_id;
  if (!clienteId && r.cliente?.nome) clienteId = ctx.cliente(r.cliente, vendedorId)?.id || null;
  ctx.guardar('vendas', v.id); // (a venda e os itens, como estavam)
  if (c.chave_nfe || c.numero || c.total_centavos !== undefined || c.data || c.vendedor_id || (clienteId && clienteId !== v.cliente_id)) {
    db.run(
      'UPDATE vendas SET chave_nfe = COALESCE(?, chave_nfe), numero = COALESCE(?, numero), total_centavos = COALESCE(?, total_centavos), data = COALESCE(?, data), vendedor_id = COALESCE(?, vendedor_id), cliente_id = COALESCE(?, cliente_id) WHERE id = ?',
      c.chave_nfe ?? null, c.numero ?? null, c.total_centavos ?? null, c.data ?? null, c.vendedor_id ?? null, clienteId, v.id,
    );
    if (c.vendedor_id) db.run('UPDATE titulos SET vendedor_id = COALESCE(vendedor_id, ?) WHERE venda_id = ?', c.vendedor_id, v.id);
  }
  const cc = camposDoCliente(clienteId, r.cliente_cortado ? null : r.cliente);
  if (Object.keys(cc).length) {
    ctx.guardar('clientes', clienteId);
    db.run('UPDATE clientes SET documento = COALESCE(documento, ?), telefone = COALESCE(telefone, ?), endereco = COALESCE(endereco, ?), cidade = COALESCE(cidade, ?), email = COALESCE(email, ?) WHERE id = ?', cc.documento ?? null, cc.telefone ?? null, cc.endereco ?? null, cc.cidade ?? null, cc.email ?? null, clienteId);
  }
  if (plano.trocaItens) trocarItens(v.id, r, ctx);
  executarParcelas(plano.parcelas.acoes, { vendaId: v.id, clienteId, vendedorId: c.vendedor_id || v.vendedor_id, emissao: r.data }, { ...ctx, origem: r.fonte === 'nfe' ? 'xml' : 'pdf', pagador: r.cliente?.nome, rotuloPagamento: r.numero ? `Pagamento da NF ${r.numero}` : 'Pagamento da venda' });
  Object.assign(v, { chave_nfe: c.chave_nfe || v.chave_nfe, numero: c.numero || v.numero, total_centavos: c.total_centavos ?? v.total_centavos, data: c.data || v.data, vendedor_id: c.vendedor_id || v.vendedor_id, cliente_id: clienteId });
  if (c.numero) { const k = numeroNorm(c.numero); if (!ctx.est.porNumero.has(k)) ctx.est.porNumero.set(k, []); ctx.est.porNumero.get(k).push(v); ctx.est.semNumero = ctx.est.semNumero.filter((x) => x !== v); }
  if (c.chave_nfe) ctx.est.porChave.set(c.chave_nfe, v);
  ctx.resultado.criados.atualizados++;
}

function criarVendaDaNota(r, vendedorId, ctx) {
  const cli = r.cliente?.nome ? ctx.cliente(r.cliente, vendedorId, { cortado: !!r.cliente_cortado }) : null;
  const origem = r.fonte === 'nfe' ? 'xml' : 'pdf';
  const vendaId = db.run(
    `INSERT INTO vendas (numero, data, cliente_id, vendedor_id, total_centavos, desconto_centavos, forma_pagamento, origem, chave_nfe, observacoes, importacao_id, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    r.numero ? numeroNorm(r.numero) : null, r.data, cli?.id || null, vendedorId || cli?.vendedor_id || null, r.total_centavos, 0, r.forma_pagamento || null, origem, r.chave_nfe || null,
    r.observacoes ? String(r.observacoes).slice(0, 500) : null, ctx.imp.id, ctx.user.id,
  ).id;
  const venda = { id: vendaId, numero: r.numero ? numeroNorm(r.numero) : null, data: r.data, total_centavos: r.total_centavos, cliente_id: cli?.id || null, vendedor_id: vendedorId || cli?.vendedor_id || null, chave_nfe: r.chave_nfe || null, origem, cliente_nome: r.cliente?.nome, cliente_documento: r.cliente?.documento };
  if (r.itens?.length) trocarItens(vendaId, r, ctx);
  const plano = planejarParcelas(null, r.parcelas || [], cli?.id || null);
  executarParcelas(plano.acoes, { vendaId, clienteId: cli?.id || null, vendedorId: venda.vendedor_id, emissao: r.data }, { ...ctx, origem, pagador: r.cliente?.nome, rotuloPagamento: r.numero ? `Pagamento da NF ${r.numero}` : 'Pagamento da venda' });
  if (cli?.id && !r.cliente_cortado) {
    const cc = camposDoCliente(cli.id, r.cliente);
    if (Object.keys(cc).length) db.run('UPDATE clientes SET documento = COALESCE(documento, ?), telefone = COALESCE(telefone, ?), endereco = COALESCE(endereco, ?), cidade = COALESCE(cidade, ?), email = COALESCE(email, ?) WHERE id = ?', cc.documento ?? null, cc.telefone ?? null, cc.endereco ?? null, cc.cidade ?? null, cc.email ?? null, cli.id);
  }
  registrarNoEstado(ctx.est, venda);
  ctx.resultado.criados.vendas++;
}

function cancelarDoEstado(r, ctx) {
  const v = acharVenda({ ...r, cliente: null, total_centavos: -1 }, ctx.est);
  if (!v) return;
  cancelarVenda(v.id);
  ctx.resultado.criados.canceladas++;
  for (const m of ctx.est.porNumero.values()) { const i = m.indexOf(v); if (i >= 0) m.splice(i, 1); }
  if (v.chave_nfe) ctx.est.porChave.delete(v.chave_nfe);
}

/** Grava uma operação de nota ('venda' com fonte nfe/relatorio) ou de cancelamento. */
export function aplicarNota(r, ctx) {
  if (r.op === 'cancelar') return cancelarDoEstado(r, ctx);
  const vendedorId = r.vendedor_nome ? ctx.vendedorId(r.vendedor_nome) : null;
  const v = acharVenda(r, ctx.est);
  if (v) return atualizarVenda(v, r, vendedorId, ctx);
  return criarVendaDaNota(r, vendedorId, ctx);
}

