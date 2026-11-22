import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, ok } from './helpers.js';
import { todayISO } from '../shared/dates.js';

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const hoje = todayISO('America/Manaus');
let app;
let admin;
const ids = {};

const formDe = (...nomes) => {
  const f = new FormData();
  for (const n of nomes) f.append('arquivos', new Blob([fs.readFileSync(path.join(SAMPLES, n))]), n);
  return f;
};
const analisar = async (...nomes) => ok(await admin.call('POST', '/api/importacoes/analisar', undefined, formDe(...nomes)), 'analisar');
const confirmar = async (id, corpo = {}) => ok(await admin.post(`/api/importacoes/${id}/confirmar`, { opcoes: { criar_clientes: true, criar_produtos: true, conciliar_automatico: true }, ...corpo }), 'confirmar');
const detalhe = async (id) => ok(await admin.get(`/api/importacoes/${id}`));
const contar = async (rota) => ok(await admin.get(rota));

before(async () => {
  app = await boot();
  admin = app.client();
  ok(await admin.setup());
  ids.marcos = ok(await admin.post('/api/vendedores', { nome: 'Marcos Lima' })).id;
  ids.ana = ok(await admin.post('/api/vendedores', { nome: 'Ana Paula Souza' })).id;
  ids.carlos = ok(await admin.post('/api/vendedores', { nome: 'Carlos Monteiro' })).id;
  ok(await admin.post('/api/clientes', { nome: 'Mercadinho Souza', vendedor_id: ids.marcos }));
  ok(await admin.post('/api/clientes', { nome: 'Padaria Pão de Ouro', vendedor_id: ids.ana }));
});
after(() => app.close());

test('notas fiscais XML: cliente, itens, parcelas e vendedor vêm da nota', async () => {
  const r = await analisar('nfe-001-mercadinho-souza.xml', 'nfe-002-padaria-pao-de-ouro.xml', 'nfe-003-restaurante-pix.xml');
  assert.equal(r.importacoes.length, 1, 'várias notas viram UMA importação');
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'vendas');
  assert.equal(p.resumo.total, 3);
  assert.deepEqual(p.resumo.vendedores.map((v) => v.nome).sort(), ['Ana Paula Souza', 'Carlos Monteiro', 'Marcos Lima']);
  assert.ok(p.resumo.vendedores.every((v) => v.sugestao), 'todos os vendedores reconhecidos');
  ids.nfe = p.id;
  const det = await detalhe(p.id);
  const n1 = det.dados.registros.find((x) => x.numero === '1501');
  assert.equal(n1.total_centavos, 187000);
  assert.equal(n1.parcelas.length, 2);
  assert.equal(n1.itens.length, 3);
  assert.equal(n1._cliente.nome, 'Mercadinho Souza', 'cliente reconhecido pelo nome');
  const res = await confirmar(p.id);
  assert.equal(res.resultado.criados.vendas, 3);
  assert.equal(res.resultado.criados.titulos, 4, '2 parcelas + 1 parcela + 1 (Pix à vista)');
  assert.equal(res.resultado.erros.length, 0);
  // cada venda ficou com o vendedor certo
  const vendas = (await contar('/api/vendas?limite=50&mes=2026-11')).itens;
  assert.equal(vendas.length, 3);
  assert.equal(vendas.find((v) => v.numero === '1501').vendedor_nome, 'Marcos Lima');
  assert.equal(vendas.find((v) => v.numero === '1503').vendedor_nome, 'Carlos Monteiro');
  // o restaurante pagou por Pix na própria nota: já entra como recebido
  assert.equal(vendas.find((v) => v.numero === '1503').situacao, 'paga');
  assert.equal(vendas.find((v) => v.numero === '1501').situacao, 'aberta');
  // clientes e produtos novos foram cadastrados
  assert.ok((await contar('/api/clientes?busca=restaurante')).total >= 1);
  assert.ok((await contar('/api/produtos?busca=tucupi')).length >= 1);
});

test('mandar as mesmas notas de novo não duplica nada', async () => {
  const r = await analisar('nfe-001-mercadinho-souza.xml', 'nfe-002-padaria-pao-de-ouro.xml');
  const p = r.importacoes[0];
  assert.equal(p.resumo.duplicados, 2);
  assert.equal(p.resumo.incluidos, 0);
  const det = await detalhe(p.id);
  assert.match(det.dados.registros[0]._avisos.join(' '), /nota fiscal já foi importada/i);
  ok(await admin.post(`/api/importacoes/${p.id}/descartar`));
});

test('desfazer importação remove tudo que ela criou', async () => {
  const antes = (await contar('/api/vendas?mes=2026-11&limite=50')).total;
  const des = ok(await admin.post(`/api/importacoes/${ids.nfe}/desfazer`));
  assert.equal(des.removidos.vendas, 3);
  assert.equal((await contar('/api/vendas?mes=2026-11&limite=50')).total, antes - 3);
  assert.equal((await contar('/api/titulos?status=todos')).totais.qtd, 0);
  // depois de desfeita, dá para importar de novo
  const r = await analisar('nfe-001-mercadinho-souza.xml');
  assert.equal(r.importacoes[0].resumo.duplicados, 0);
  ok(await admin.post(`/api/importacoes/${r.importacoes[0].id}/descartar`));
});

test('planilha XLSX com 3 abas: devedores, vendas e depósito são identificados sozinhos', async () => {
  const r = await analisar('planilha-exemplo.xlsx');
  const por = Object.fromEntries(r.importacoes.map((i) => [i.tipo, i]));
  assert.deepEqual(Object.keys(por).sort(), ['devedores', 'estoque', 'vendas']);
  assert.equal(por.devedores.resumo.total, 4);
  assert.equal(por.vendas.resumo.total, 3, '3 pedidos (o pedido 2001 tem 2 itens e vira uma venda só)');
  assert.equal(por.estoque.resumo.total, 4);
  // vendas: o pedido com 2 linhas é uma venda de 2 itens
  const dv = await detalhe(por.vendas.id);
  const v2001 = dv.dados.registros.find((x) => x.numero === '2001');
  assert.equal(v2001.itens.length, 2);
  assert.equal(v2001.total_centavos, 176000);
  // devedores: "sim" em "Já pagou?" vira dívida já paga
  const dd = await detalhe(por.devedores.id);
  assert.equal(dd.dados.registros.filter((x) => x.pago_centavos > 0).length, 1);
  const c1 = await confirmar(por.devedores.id);
  assert.equal(c1.resultado.criados.titulos, 4);
  assert.equal(c1.resultado.criados.recebimentos, 1);
  const c2 = await confirmar(por.vendas.id);
  assert.equal(c2.resultado.criados.vendas, 3);
  const c3 = await confirmar(por.estoque.id);
  assert.equal(c3.resultado.criados.movimentos, 4);
  // retirada do Marcos entrou como retirada do vendedor certo
  const ret = (await contar('/api/estoque/retiradas?mes=2026-11')).itens.find((x) => x.vendedor_id === ids.marcos);
  assert.equal(ret.retirado_mes, 60);
  // dívidas ficaram só com o vendedor informado na planilha
  const abertas = (await contar('/api/titulos?status=abertos&limite=100')).itens;
  assert.ok(abertas.some((t) => t.cliente_nome === 'Mercantil Boa Esperança' && t.vendedor_nome === 'Marcos Lima'));
});

test('CSV do Excel (; e acentos em Windows-1252) com nomes de vendedor abreviados', async () => {
  const r = await analisar('devedores-excel.csv');
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'devedores');
  assert.equal(p.resumo.total, 6, 'a linha TOTAL fica de fora');
  const det = await detalhe(p.id);
  assert.ok(det.dados.registros.some((x) => x.cliente.nome === 'Padaria Pão de Ouro'), 'acentos preservados');
  const ana = det.dados.registros.find((x) => x.vendedor_nome === 'Ana Paula');
  assert.equal(ana._vendedor.nome, 'Ana Paula Souza', '"Ana Paula" reconhecida como Ana Paula Souza');
  assert.equal(det.dados.registros.find((x) => x.vendedor_nome === 'Carlos')._vendedor.nome, 'Carlos Monteiro');
  // o usuário pode trocar o vendedor de um nome inteiro na tela de revisão
  const res = await confirmar(p.id, { mapa_vendedores: { 'juliana ferreira': 'novo', rafael: null } });
  assert.equal(res.resultado.criados.vendedores, 1, 'Juliana foi cadastrada como vendedora nova');
  assert.equal(res.resultado.erros.length, 0);
});

test('PDF de relatório de devedores é lido como tabela', async () => {
  const r = await analisar('relatorio-devedores.pdf');
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'devedores');
  assert.equal(p.resumo.total, 5, 'sem a linha "Total geral" nem o rodapé');
  const det = await detalhe(p.id);
  const f = det.dados.registros.find((x) => x.cliente.nome === 'Frutaria Tambaqui');
  assert.equal(f.valor_centavos, 125000);
  assert.equal(f.vencimento, '2026-11-10');
  assert.equal(det.dados.registros.find((x) => x.cliente.nome === 'Churrascaria Ribeirinha').pago_centavos, 310000, '"Pago" na situação = quitado');
  ok(await admin.post(`/api/importacoes/${p.id}/descartar`));
});

test('comprovantes de Pix em PDF (dois modelos de banco) e extrato OFX viram recebimentos', async () => {
  const r = await analisar('comprovante-pix-nubank.pdf', 'comprovante-pix-banco.pdf');
  assert.equal(r.importacoes.length, 1, 'vários comprovantes viram UMA importação');
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'pagamentos');
  const det = await detalhe(p.id);
  const a = det.dados.registros.find((x) => x.valor_centavos === 187000);
  assert.equal(a.pagador_nome, 'MERCADINHO SOUZA LTDA');
  assert.equal(a.data, '2026-11-11');
  assert.match(a.ref_externa, /^E18236120/);
  const b = det.dados.registros.find((x) => x.valor_centavos === 245050);
  assert.equal(b.pagador_nome, 'PADARIA PAO DE OURO ME');
  assert.equal(b.data, '2026-11-13');
  assert.equal(b.pagador_documento, '11.222.333/0001-44');
  const res = await confirmar(p.id);
  assert.equal(res.resultado.criados.recebimentos, 2);
  // o comprovante em PDF fica guardado junto do recebimento
  const rec = (await contar('/api/recebimentos?mes=2026-11&limite=100')).itens.filter((x) => /^E\d{8}/.test(x.ref_externa || ''));
  assert.equal(rec.length, 2);
  assert.ok(rec.every((x) => x.arquivo_id), 'comprovantes em PDF anexados ao recebimento');
  // OFX: só entradas (créditos) viram recebimentos; a saída ao fornecedor é ignorada
  const o = (await analisar('extrato-banco.ofx')).importacoes[0];
  assert.equal(o.resumo.total, 4);
  const ro = await detalhe(o.id);
  assert.ok(ro.dados.registros.every((x) => x.valor_centavos > 0));
  assert.equal(ro.dados.registros.find((x) => x.valor_centavos === 125000).pagador_nome, 'FRUTARIA TAMBAQUI');
  const rc = await confirmar(o.id);
  assert.equal(rc.resultado.criados.recebimentos, 4);
  // reenviar o mesmo extrato: tudo já existe
  const o2 = (await analisar('extrato-banco.ofx')).importacoes[0];
  assert.equal(o2.resumo.duplicados, 4);
  ok(await admin.post(`/api/importacoes/${o2.id}/descartar`));
});

test('baixa automática: Pix cujo nome e valor batem com a dívida é conciliado na hora', async () => {
  // dívida do Mercadinho Souza vinda de NF-e + Pix de 1.870,00 (comprovante Nubank) → baixa certeira nas 2 parcelas
  const n = (await analisar('nfe-001-mercadinho-souza.xml')).importacoes[0];
  await confirmar(n.id);
  const antes = (await contar('/api/titulos?cliente_id=' + (await contar('/api/clientes?busca=mercadinho souza')).itens[0].id + '&status=abertos')).totais.aberto_total;
  assert.equal(antes, 187000);
  const sug = ok(await admin.get('/api/recebimentos/sugestoes'));
  const doMercadinho = sug.find((s) => s.recebimento.valor_centavos === 187000);
  assert.ok(doMercadinho, 'o Pix de R$ 1.870,00 está sem baixa');
  assert.equal(doMercadinho.sugestoes[0].confianca, 'alta');
  assert.equal(doMercadinho.sugestoes[0].titulo_ids.length, 2, 'soma das 2 parcelas');
  ok(await admin.post('/api/recebimentos/conciliar-lote', { itens: [{ recebimento_id: doMercadinho.recebimento.id, titulo_ids: doMercadinho.sugestoes[0].titulo_ids }] }));
  assert.equal((await contar('/api/titulos?status=abertos&busca=mercadinho')).totais.aberto_total, 0);
});

test('colunas erradas podem ser corrigidas na prévia (reprocessar)', async () => {
  const csv = 'Nome;Quanto;Quando\nLoja do Zé;350,00;15/12/2026\nBar da Esquina;120,50;20/12/2026\n';
  const f = new FormData();
  f.append('arquivos', new Blob([csv]), 'planilha-estranha.csv');
  const r = ok(await admin.call('POST', '/api/importacoes/analisar', undefined, f));
  const p = r.importacoes[0];
  assert.equal(p.resumo.total, 0, 'não adivinhou — colunas com nomes fora do comum');
  const det = await detalhe(p.id);
  assert.deepEqual(det.dados.tabela.cabecalho, ['Nome', 'Quanto', 'Quando']);
  const novo = ok(await admin.post(`/api/importacoes/${p.id}/reprocessar`, { tipo: 'devedores', mapeamento: { 0: 'cliente', 1: 'valor', 2: 'vencimento' } }));
  assert.equal(novo.importacao.tipo, 'devedores');
  assert.equal(novo.dados.registros.length, 2);
  assert.equal(novo.dados.registros[0].valor_centavos, 35000);
  assert.equal(novo.dados.registros[0].vencimento, '2026-12-15');
  const res = await confirmar(p.id, { incluir: [0] }); // só a primeira linha
  assert.equal(res.resultado.criados.titulos, 1);
});

test('arquivos ruins dão mensagem clara em vez de quebrar', async () => {
  const f = new FormData();
  f.append('arquivos', new Blob(['isto nao e um xml']), 'quebrado.xml');
  f.append('arquivos', new Blob(['abc']), 'velha.xls');
  f.append('arquivos', new Blob(['%PDF-1.4 lixo']), 'lixo.pdf');
  f.append('arquivos', new Blob(['x']), 'virus.exe');
  const r = ok(await admin.call('POST', '/api/importacoes/analisar', undefined, f));
  assert.equal(r.importacoes.length, 0);
  assert.equal(r.erros.length, 4);
  assert.match(r.erros.find((e) => e.nome === 'velha.xls').motivo, /\.xlsx/);
  assert.match(r.erros.find((e) => e.nome === 'virus.exe').motivo, /não suportado/);
});

test('só administrador importa e o histórico guarda o resultado', async () => {
  const hist = ok(await admin.get('/api/importacoes'));
  assert.ok(hist.some((h) => h.status === 'confirmada' && h.resumo?.resultado));
  assert.ok(hist.some((h) => h.status === 'desfeita'));
  const bloqueado = await admin.raw('POST', '/api/importacoes/1/confirmar', { body: {}, headers: { cookie: '' } });
  assert.equal(bloqueado.status, 401);
});

test('XML de cancelamento da nota cancela a venda e suas parcelas', async () => {
  const antes = (await contar('/api/vendas?mes=2026-11&limite=50')).itens.find((v) => v.numero === '1501');
  assert.ok(antes && antes.situacao !== 'cancelada', 'a venda da NF-e 1501 existe (importada no teste anterior)');
  const r = await analisar('nfe-cancelamento-1501.xml');
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'vendas');
  const det = await detalhe(p.id);
  assert.equal(det.dados.registros[0].tipo_registro, 'cancelamento');
  const res = await confirmar(p.id);
  assert.equal(res.resultado.criados.canceladas, 1);
  const depois = (await contar('/api/vendas?mes=2026-11&limite=50&status=todas')).itens.find((v) => v.numero === '1501');
  assert.equal(depois.situacao, 'cancelada');
  assert.equal((await contar('/api/titulos?status=abertos&busca=mercadinho')).totais.aberto_total, 0, 'parcelas canceladas não contam como dívida');
});
