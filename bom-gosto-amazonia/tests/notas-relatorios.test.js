// Notas fiscais (XML), relatório de vendas do sistema e relatório de boletos do banco: leitura e SINCRONIZAÇÃO com o painel.
// O que importa aqui: a nota que já veio de uma planilha é COMPLETADA (nunca duplicada), nota cancelada nunca vira venda,
// e enviar tudo de novo (ou em outra ordem) não cria nada repetido.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { boot, ok } from './helpers.js';
import { construirDevedores, construirControle, paraBuffer } from './fixtures-planilhas.js';
import { xmlNFe, xmlCancelamento, chaveDaNota, pdfRelatorioVendas, pdfSicoobVencidos } from './fixtures-notas.js';
import { lerArquivo } from '../server/services/import/leitor.js';

let app;
let admin;
let db;
const ctx = {};
before(async () => {
  app = await boot();
  admin = app.client();
  ok(await admin.setup());
  ({ db } = await import('../server/db.js'));
});
after(() => app.close());

const form = (...arqs) => { const f = new FormData(); for (const [nome, buf] of arqs) f.append('arquivos', new Blob([buf]), nome); return f; };
const enviar = async (...arqs) => ok(await admin.call('POST', '/api/importacoes/analisar', undefined, form(...arqs)), 'analisar');
const confirmar = async (id, corpo = {}) => ok(await admin.post(`/api/importacoes/${id}/confirmar`, corpo), 'confirmar').resultado;
const detalhe = async (id) => ok(await admin.get(`/api/importacoes/${id}`));
const aberto = () => db.get("SELECT COALESCE(SUM(valor_centavos - pago_centavos), 0) AS s FROM v_titulos WHERE cancelado = 0 AND valor_centavos > pago_centavos").s;
const doc = (k) => `1111111100${String(k).padStart(4, '0')}`;
const cli = (nome, k) => ({ nome, doc: doc(k), fone: `929111${k}`, cidade: 'MANAUS' });
const EAN = { '400G': '7898971278060', '300G': '7898971278008', '300BG': '7898952718110', '400BG': '7898952718028', AMANT: '7898952718073' };
const item = (produto, descricao, qtd, preco) => ({ codigo: EAN[produto], descricao, qtd, preco });

// as notas que correspondem às vendas do Controle de teste (fixtures-planilhas) + uma nota nova, uma cancelada e uma recusada pela SEFAZ
const XMLS = {
  821: xmlNFe({ numero: 821, data: '2026-11-04', cliente: cli('CLIENTE ALFA LTDA', 1), itens: [item('400G', 'BOLACHA PRINCESINHA 400G', 20, 95)], parcelas: [{ venc: '2026-11-18', valor: 1900 }] }),
  829: xmlNFe({ numero: 829, data: '2026-11-04', cliente: cli('CLIENTE BETA LTDA', 2), itens: [item('300BG', 'BISCOITO AGUA E SAL 20x300G', 20, 85), item('AMANT', 'BISC. RECREIO AMANTEIGADO 20X300GR', 6, 85)], parcelas: [{ venc: '2026-12-02', valor: 2210 }] }),
  840: xmlNFe({ numero: 840, data: '2026-11-06', cliente: cli('CLIENTE EPSILON', 3), itens: [item('300BG', 'BISCOITO AGUA E SAL 20x300G', 40, 85)], parcelas: [{ venc: '2026-11-27', valor: 3400 }] }),
  851: xmlNFe({ numero: 851, data: '2026-11-09', cliente: cli('CLIENTE ETA', 4), itens: [item('400G', 'BOLACHA PRINCESINHA 400G', 100, 102), item('300G', 'BOLACHA PRINCESINHA 300G', 100, 90)], parcelas: [{ venc: '2026-11-23', valor: 9600 }, { venc: '2026-11-30', valor: 9600 }] }),
  871: xmlNFe({ numero: 871, data: '2026-11-11', cliente: cli('CLIENTE GAMA', 5), itens: [item('400BG', 'BISCOITO AGUA E SAL 20X400gr', 1, 234.5), item('300BG', 'BISCOITO AGUA E SAL 20x300G', 1, 234.5)] }),
  885: xmlNFe({ numero: 885, data: '2026-11-12', cliente: cli('CLIENTE ZETA', 6), itens: [item('400G', 'BOLACHA PRINCESINHA 400G', 50, 106.9)], parcelas: [{ venc: '2026-11-26', valor: 2672.5 }, { venc: '2026-12-03', valor: 2672.5 }] }),
  900: xmlNFe({ numero: 900, data: '2026-11-16', cliente: cli('CLIENTE DELTA', 7), itens: [item('300BG', 'BISCOITO AGUA E SAL 20x300G', 6, 382)], parcelas: [{ venc: '2026-11-30', valor: 1146 }, { venc: '2026-12-07', valor: 1146 }] }),
  950: xmlNFe({ numero: 950, data: '2026-11-24', cliente: cli('CLIENTE NOVO LTDA', 8), itens: [item('400G', 'BOLACHA PRINCESINHA 400G', 10, 100)], parcelas: [{ venc: '2026-12-24', valor: 1000 }] }),
  960: xmlNFe({ numero: 960, data: '2026-11-24', cliente: cli('CLIENTE CANCELADO LTDA', 9), itens: [item('400G', 'BOLACHA PRINCESINHA 400G', 5, 100)], parcelas: [{ venc: '2026-12-24', valor: 500 }] }),
  961: xmlNFe({ numero: 961, data: '2026-11-24', cliente: cli('CLIENTE RECUSADO LTDA', 10), itens: [item('400G', 'BOLACHA PRINCESINHA 400G', 5, 100)], parcelas: [{ venc: '2026-12-24', valor: 500 }], status: '302' }),
};
const zipDeNotas = async () => {
  const z = new JSZip();
  for (const [n, xml] of Object.entries(XMLS)) z.file(`NFe ${String(n).padStart(9, '0')} Série 1 Chave ${chaveDaNota(n)} Recibo 1300.xml`, xml);
  z.file(`NFe 000000960 Série 1 Chave ${chaveDaNota(960)} Recibo 1132 - CANCELAMENTO.xml`, xmlCancelamento(960));
  z.file('Conteúdo desta pasta.txt', '25/11/2026 - EMPRESA\nNotas Fiscais Eletrônicas emitidas entre 01/11/2026 e 25/11/2026\nQuantidade de notas canceladas: 1\n');
  return z.generateAsync({ type: 'nodebuffer' });
};

// ------------------------------------------------------------------ leitura dos PDFs
test('relatório de vendas do sistema: ano cortado, cliente cortado colado no vendedor, nota 0 e total conferido', async () => {
  const buf = await pdfRelatorioVendas([
    { data: '2026-11-03', nota: 820, cliente: 'N. Almeida Maia Ltda', vendedor: 'Paulo', valor: 48000 },
    { data: '2026-11-11', nota: 869, cliente: 'Rayanara Supermercado Ltda', vendedor: 'Alessandra', valor: 274300 },
    { data: '2026-11-09', nota: 851, cliente: 'D. Hernan Montoro Ortiz', vendedor: 'Gracy Ney', valor: 1920000 },
    { data: '2026-11-24', nota: 0, cliente: 'Comercio Costa Ltda', vendedor: 'Alessandra', valor: 850000 },
    { data: '2026-11-12', nota: 886, cliente: 'Casa de Carne Otavio Ltda 4', vendedor: 'Dewid Furtado', valor: 28500, prazo: false },
  ]);
  const [d] = await lerArquivo({ buffer: buf, nome: 'Vendas_Totais.pdf' });
  assert.equal(d.kind, 'relatorio');
  const r = d.relatorio;
  assert.equal(r.tipo, 'vendas_totais');
  assert.deepEqual(r.periodo, { de: '2026-11-01', ate: '2026-11-25' });
  assert.deepEqual(r.avisos, [], 'a soma das linhas bate com o total impresso');
  assert.equal(r.total_centavos, 48000 + 274300 + 1920000 + 850000 + 28500);
  assert.deepEqual(r.linhas.map((l) => [l.numero, l.data, l.vendedor]), [
    ['820', '2026-11-03', 'Paulo'], ['869', '2026-11-11', 'Alessandra'], ['851', '2026-11-09', 'Gracy Ney'], [null, '2026-11-24', 'Alessandra'], ['886', '2026-11-12', 'Dewid Furtado'],
  ]);
  assert.equal(r.linhas[1].cliente, 'Rayanara Supermercad', 'o nome do cliente vem cortado pelo sistema');
  assert.equal(r.linhas[4].saida, 'Venda a vista');
});

test('relatório de títulos do Sicoob (página girada): sacado, nosso número, seu número, vencimento e valor', async () => {
  const buf = await pdfSicoobVencidos([
    { sacado: 'CLIENTE ALFA LTDA', nosso: '76-6', seu: '0857-02', entrada: '2026-11-10', venc: '2026-11-24', valor: 38050 },
    { sacado: 'CLIENTE ETA', nosso: '75-8', seu: '0851-01', entrada: '2026-11-09', venc: '2026-11-23', valor: 960000 },
    { sacado: 'CLIENTE SIGMA', nosso: '79-7', seu: '0890', entrada: '2026-11-13', venc: '2026-11-20', valor: 24800 },
  ]);
  const [d] = await lerArquivo({ buffer: buf, nome: 'sicoobnet.pdf' });
  assert.equal(d.kind, 'relatorio');
  const r = d.relatorio;
  assert.equal(r.tipo, 'sicoob_titulos');
  assert.equal(r.consulta, 'Vencido');
  assert.deepEqual(r.periodo, { de: '2026-11-01', ate: '2026-11-24' });
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(r.linhas.map((l) => [l.seu_numero, l.nosso_numero, l.vencimento, l.valor_centavos]), [
    ['0857-02', '76-6', '2026-11-24', 38050], ['0851-01', '75-8', '2026-11-23', 960000], ['0890', '79-7', '2026-11-20', 24800],
  ]);
  const liquidado = await pdfSicoobVencidos([{ sacado: 'X', nosso: '1-1', seu: '0001', entrada: '2026-11-01', venc: '2026-11-02', valor: 100 }], { consulta: 'Liquidado' });
  const [e] = await lerArquivo({ buffer: liquidado, nome: 'liquidados.pdf' });
  assert.equal(e.kind, 'erro');
  assert.match(e.motivo, /Liquidado/, 'um relatório que ainda não é lido diz isso com clareza');
});

// ------------------------------------------------------------------ notas fiscais sobre o que já veio das planilhas
test('base: Controle e Lista de Devedores entram como entraram na vida real', async () => {
  for (const wb of [await construirControle(), await construirDevedores()]) {
    const p = (await enviar(['planilha.xlsx', await paraBuffer(wb)])).importacoes[0];
    await confirmar(p.id);
  }
  ctx.vendas = db.get('SELECT COUNT(*) n FROM vendas').n;
  ctx.titulos = db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n;
  ctx.aberto = aberto();
  ctx.produtos = db.get('SELECT COUNT(*) n FROM produtos').n;
  assert.equal(ctx.vendas, 7);
  assert.equal(db.all("SELECT documento FROM titulos WHERE documento LIKE '851%'").length, 1, 'a nota 851 está como UMA dívida de 19.200 (assim vem da planilha)');
});

test('XMLs (num ZIP) completam as notas que já existem, criam só a nova e deixam de fora a cancelada e a recusada', async () => {
  const r = await enviar(['XML_20261125.zip', await zipDeNotas()]);
  assert.equal(r.erros.length, 0);
  assert.equal(r.importacoes.length, 1, 'tudo vira UMA importação (o "Conteúdo desta pasta.txt" do ZIP não vira lixo)');
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'planilha');
  assert.match(p.nome, /9 notas fiscais/, 'a nota cancelada não é contada');
  assert.equal(p.resumo.criar, 2, 'nota 950 (nova) e 961 (recusada, mas desmarcada)');
  assert.equal(p.resumo.atualizar, 7, 'as 7 notas que já estavam no painel');
  assert.equal(p.resumo.incluidos, 8);
  const det = await detalhe(p.id);
  assert.ok(det.dados.avisos.some((a) => /cancelada.*960/.test(a)), 'avisa que a nota cancelada ficou de fora');
  assert.ok(det.dados.avisos.some((a) => /961.*não autorizada/i.test(a)));
  const rec = det.dados.registros.find((x) => x.numero === '961');
  assert.equal(rec._incluir, false, 'nota recusada pela SEFAZ não vem marcada');
  assert.equal(det.dados.registros.find((x) => x.op === 'cancelar').numero, '960');
  assert.equal(det.dados.registros.find((x) => x.op === 'venda' && x.numero === '960'), undefined, 'a cancelada não é uma venda nem na prévia');

  const res = await confirmar(p.id);
  assert.equal(res.erros.length, 0);
  assert.equal(res.criados.vendas, 1);
  assert.equal(res.criados.produtos, 0, 'os produtos das notas são os MESMOS das planilhas (pelo código de barras): nada de produto repetido');
  assert.equal(db.get('SELECT COUNT(*) n FROM vendas').n, ctx.vendas + 1, 'só a 950 é venda nova');
  for (const n of [821, 829, 840, 851, 871, 885, 900, 950]) {
    const v = db.all('SELECT * FROM vendas WHERE numero = ?', String(n));
    assert.equal(v.length, 1, `NF ${n} existe uma vez só`);
    assert.equal(v[0].chave_nfe, chaveDaNota(n), `NF ${n} ganhou a chave da nota`);
  }
  assert.equal(db.get("SELECT COUNT(*) n FROM vendas WHERE numero IN ('960','961')").n, 0, 'cancelada e recusada não entram');
  // cliente completado com os dados da nota
  const alfa = db.get("SELECT * FROM clientes WHERE nome = 'CLIENTE ALFA LTDA'");
  assert.equal(alfa.documento, doc(1)); assert.equal(alfa.cidade, 'MANAUS'); assert.ok(alfa.telefone);
  // itens exatos da nota (a planilha só tinha o total distribuído) com os produtos de sempre
  const itens = db.all("SELECT i.quantidade q, i.total_centavos t, p.nome produto FROM venda_itens i JOIN produtos p ON p.id = i.produto_id JOIN vendas v ON v.id = i.venda_id WHERE v.numero = '829' ORDER BY p.nome");
  assert.deepEqual(itens.map((i) => [i.produto, i.q, i.t]), [['300BG', 20, 170000], ['AMANT', 6, 51000]]);
  assert.equal(db.get("SELECT sku FROM produtos WHERE nome = '400G'").sku, EAN['400G'], 'o código de barras ficou guardado no produto');
  assert.equal(db.get('SELECT COUNT(*) n FROM produtos').n, ctx.produtos);
  // a nota 851 estava como 1 dívida de 19.200; a nota diz 2 parcelas de 9.600 — a dívida foi dividida, sem duplicar
  const t851 = db.all("SELECT documento, parcela, vencimento, valor_centavos FROM titulos WHERE venda_id = (SELECT id FROM vendas WHERE numero = '851') ORDER BY documento");
  assert.deepEqual(t851, [
    { documento: '851-01', parcela: '1/2', vencimento: '2026-11-23', valor_centavos: 960000 },
    { documento: '851-02', parcela: '2/2', vencimento: '2026-11-30', valor_centavos: 960000 },
  ]);
  assert.equal(aberto(), ctx.aberto + 100000, 'o em aberto só cresce com a nota nova (950): o que já existia não foi contado duas vezes');
  assert.equal(db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n, ctx.titulos + 2, 'títulos novos: 950 e 851-02');
  ctx.importXml = p.id;
  ctx.aposXml = { vendas: db.get('SELECT COUNT(*) n FROM vendas').n, titulos: db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n, aberto: aberto() };
});

test('enviar de novo os XMLs, o Controle e a Lista de Devedores (depois das notas) não cria nem muda nada', async () => {
  const x = (await enviar(['XML_20261125.zip', await zipDeNotas()])).importacoes[0];
  assert.equal(x.resumo.criar, 1, 'só a 961 (recusada) continua "nova", desmarcada');
  assert.equal(x.resumo.atualizar, 0);
  assert.equal(x.resumo.incluidos, 0);
  const c = (await enviar(['Controle.xlsx', await paraBuffer(await construirControle())])).importacoes[0];
  assert.equal(c.resumo.criar, 0); assert.equal(c.resumo.atualizar, 0);
  const det = await detalhe(c.id);
  assert.match(det.dados.registros.find((r) => r.numero === '851')._avisos.join(' '), /não foi criada.*já tem dívidas/, 'a linha "851" do Controle não recria a dívida inteira ao lado das 2 parcelas');
  const l = (await enviar(['Devedores.xlsx', await paraBuffer(await construirDevedores())])).importacoes[0];
  assert.equal(l.resumo.criar, 0); assert.equal(l.resumo.atualizar, 0);
  for (const p of [x, c, l]) ok(await admin.post(`/api/importacoes/${p.id}/descartar`));
  assert.deepEqual({ vendas: db.get('SELECT COUNT(*) n FROM vendas').n, titulos: db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n, aberto: aberto() }, ctx.aposXml);
});

test('desfazer a importação das notas devolve as dívidas e as vendas ao que eram antes (851 volta a ser 1 dívida de 19.200)', async () => {
  ok(await admin.post(`/api/importacoes/${ctx.importXml}/desfazer`));
  assert.equal(db.get('SELECT COUNT(*) n FROM vendas').n, ctx.vendas);
  assert.equal(db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n, ctx.titulos);
  assert.equal(aberto(), ctx.aberto);
  const t851 = db.all("SELECT documento, parcela, valor_centavos FROM titulos WHERE venda_id = (SELECT id FROM vendas WHERE numero = '851')");
  assert.deepEqual(t851, [{ documento: '851', parcela: null, valor_centavos: 1920000 }]);
  assert.equal(db.get("SELECT chave_nfe FROM vendas WHERE numero = '821'").chave_nfe, null);
  assert.equal(db.get("SELECT documento FROM clientes WHERE nome = 'CLIENTE ALFA LTDA'").documento, null);
  assert.equal(db.get("SELECT COUNT(*) n FROM venda_itens WHERE venda_id = (SELECT id FROM vendas WHERE numero = '829')").n, 2);
  // e dá para importar de novo, chegando ao mesmo resultado
  const p = (await enviar(['XML_20261125.zip', await zipDeNotas()])).importacoes[0];
  await confirmar(p.id);
  assert.deepEqual({ vendas: db.get('SELECT COUNT(*) n FROM vendas').n, titulos: db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n, aberto: aberto() }, ctx.aposXml);
});

test('nota cancelada que JÁ está no painel é cancelada (venda e dívidas), e a nota cancelada nunca é importada', async () => {
  const antes = aberto();
  const p = (await enviar([`NFe 840 - CANCELAMENTO.xml`, xmlCancelamento(840)], ['NFe 840.xml', XMLS[840]])).importacoes[0];
  assert.equal(p.resumo.total, 1, 'o XML da nota 840 + o cancelamento viram só o cancelamento');
  assert.equal(p.resumo.atualizar, 1);
  const res = await confirmar(p.id);
  assert.equal(res.criados.canceladas, 1);
  assert.equal(db.get("SELECT status FROM vendas WHERE numero = '840'").status, 'cancelada');
  assert.equal(db.get("SELECT COUNT(*) n FROM titulos WHERE documento = '840' AND cancelado = 0").n, 0);
  assert.equal(aberto(), antes - 340000);
});

// ------------------------------------------------------------------ relatório de vendas do sistema
test('relatório de vendas: vendedor da nota (Petterson = Peterson), venda sem nota, venda à vista; a nota emitida depois ADOTA a venda sem número', async () => {
  const vendedoresAntes = db.get('SELECT COUNT(*) n FROM vendedores').n;
  const pdf = await pdfRelatorioVendas([
    { data: '2026-11-04', nota: 821, cliente: 'Cliente Alfa Ltda', vendedor: 'Hélio', valor: 190000 },
    { data: '2026-11-24', nota: 951, cliente: 'Cliente Novo Dois Ltda', vendedor: 'Petterson', valor: 125000 },
    { data: '2026-11-24', nota: 952, cliente: 'Mercadinho Avista', vendedor: 'Paulo', valor: 30000, prazo: false },
    { data: '2026-11-24', nota: 0, cliente: 'Comercio Costa Ltda', vendedor: 'Paulo', valor: 300000 },
  ]);
  const p = (await enviar(['Vendas_Totais.pdf', pdf])).importacoes[0];
  assert.equal(p.tipo, 'planilha');
  assert.equal(p.resumo.criar, 3); assert.equal(p.resumo.atualizar, 0, 'a 821 já tem o mesmo vendedor');
  assert.deepEqual(p.resumo.vendedores.map((v) => v.nome).sort(), ['Hélio', 'Paulo', 'Peterson']);
  const antes = aberto();
  const res = await confirmar(p.id);
  assert.equal(res.criados.vendas, 3); assert.equal(res.criados.vendedores, 0, 'ninguém novo: "Petterson" é o Peterson');
  assert.equal(db.get('SELECT COUNT(*) n FROM vendedores').n, vendedoresAntes);
  assert.equal(db.get("SELECT vd.nome FROM vendas v JOIN vendedores vd ON vd.id = v.vendedor_id WHERE v.numero = '951'").nome, 'Peterson');
  // à vista: já nasce paga; a prazo sem parcelas no relatório: vencimento provisório de 30 dias, avisado na dívida
  assert.equal(db.get("SELECT pago_centavos p FROM v_titulos WHERE documento = '952'").p, 30000);
  const t951 = db.get("SELECT vencimento, observacoes FROM titulos WHERE documento = '951'");
  assert.equal(t951.vencimento, '2026-12-24'); assert.match(t951.observacoes, /provisório/);
  assert.equal(aberto(), antes + 125000 + 300000);
  const semNumero = db.get('SELECT id, numero, origem FROM vendas WHERE numero IS NULL');
  assert.ok(semNumero, 'a venda sem nota entrou sem número');

  // a nota sai depois (outro número, 2 parcelas): ADOTA a venda sem número em vez de criar uma segunda
  const xml = xmlNFe({ numero: 953, data: '2026-11-25', cliente: cli('COMERCIO COSTA LTDA', 11), itens: [item('400G', 'BOLACHA PRINCESINHA 400G', 30, 100)], parcelas: [{ venc: '2026-12-05', valor: 1500 }, { venc: '2026-12-12', valor: 1500 }] });
  const x = (await enviar(['NFe 953.xml', xml])).importacoes[0];
  assert.equal(x.resumo.criar, 0); assert.equal(x.resumo.atualizar, 1, 'é a venda que já estava sem número');
  const vendasAntes = db.get('SELECT COUNT(*) n FROM vendas').n;
  await confirmar(x.id);
  assert.equal(db.get('SELECT COUNT(*) n FROM vendas').n, vendasAntes, 'nenhuma venda a mais');
  const v = db.get('SELECT * FROM vendas WHERE id = ?', semNumero.id);
  assert.equal(v.numero, '953'); assert.equal(v.chave_nfe, chaveDaNota(953));
  assert.deepEqual(db.all('SELECT documento, valor_centavos FROM titulos WHERE venda_id = ? ORDER BY documento', v.id), [{ documento: '953-01', valor_centavos: 150000 }, { documento: '953-02', valor_centavos: 150000 }], 'o vencimento provisório virou as parcelas reais da nota');
  assert.equal(db.get('SELECT vd.nome FROM vendas v JOIN vendedores vd ON vd.id = v.vendedor_id WHERE v.id = ?', v.id).nome, 'Paulo', 'o vendedor do relatório ficou');
  assert.equal(aberto(), antes + 125000 + 300000);
});

test('XML e relatório enviados juntos: o vendedor do relatório vai para a nota, sem duplicar', async () => {
  const xml = xmlNFe({ numero: 954, data: '2026-11-25', cliente: cli('CLIENTE QUINZE LTDA', 15), itens: [item('400BG', 'BISCOITO AGUA E SAL 20X400gr', 4, 100)], parcelas: [{ venc: '2026-12-25', valor: 400 }] });
  const pdf = await pdfRelatorioVendas([{ data: '2026-11-25', nota: 954, cliente: 'Cliente Quinze Ltda', vendedor: 'Paulo', valor: 40000 }]);
  const r = await enviar(['NFe 954.xml', xml], ['Vendas.pdf', pdf]);
  assert.equal(r.importacoes.length, 1);
  assert.equal(r.importacoes[0].resumo.total, 1, 'a nota do XML e a do relatório são a mesma');
  await confirmar(r.importacoes[0].id);
  assert.equal(db.get("SELECT vd.nome FROM vendas v JOIN vendedores vd ON vd.id = v.vendedor_id WHERE v.numero = '954'").nome, 'Paulo');
  assert.equal(db.get("SELECT COUNT(*) n FROM vendas WHERE numero = '954'").n, 1);
});

// ------------------------------------------------------------------ relatório do banco
test('Sicoob: confirma o que está em aberto, guarda o nosso número, avisa o que não bate e NUNCA duplica uma dívida da mesma nota', async () => {
  // 792 (Lista de Devedores) está em aberto no painel; 821 está PAGA no painel; 829 é uma dívida inteira de 2.210 (o banco tem metade: outra divisão);
  // 990 não existe no painel; 851-01 foi criada pelas notas
  const pdf = await pdfSicoobVencidos([
    { sacado: 'CLIENTE OMEGA LTDA', nosso: '70-8', seu: '0792', entrada: '2026-10-28', venc: '2026-11-18', valor: 686000 },
    { sacado: 'CLIENTE ALFA LTDA', nosso: '70-1', seu: '0821', entrada: '2026-11-04', venc: '2026-11-18', valor: 190000 },
    { sacado: 'CLIENTE BETA LTDA', nosso: '72-1', seu: '0829-01', entrada: '2026-11-04', venc: '2026-11-18', valor: 110500 },
    { sacado: 'CLIENTE XIS', nosso: '99-0', seu: '0990', entrada: '2026-11-05', venc: '2026-11-20', valor: 50000 },
    { sacado: 'CLIENTE ETA', nosso: '75-8', seu: '0851-01', entrada: '2026-11-09', venc: '2026-11-23', valor: 960000 },
  ]);
  const r = await enviar(['sicoobnet.pdf', pdf]);
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'planilha');
  assert.equal(p.resumo.criar, 1, 'só o 990 é desconhecido');
  assert.equal(p.resumo.conferir, 1, 'o 829-01 não é criado: a nota 829 já tem dívida somando o total dela');
  const det = await detalhe(p.id);
  const por = (n) => det.dados.registros.find((x) => x.documento === n);
  assert.equal(por('0829-01')._acao, 'conferir');
  assert.match(por('0829-01')._avisos.join(' '), /não foi criado.*duplicar/i);
  assert.match(por('0821')._avisos.join(' '), /consta como PAGO/, 'o banco diz vencido, o painel diz pago: avisa, não desfaz o pagamento');
  assert.ok(det.dados.avisos.some((a) => /(NÃO aparecem|NÃO aparece) na lista de vencidos do banco/.test(a)), `avisa as dívidas vencidas do painel que o banco não lista: ${JSON.stringify(det.dados.avisos)}`);
  const titulos = db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n;
  const res = await confirmar(p.id);
  assert.equal(res.criados.titulos, 1);
  assert.equal(db.get('SELECT COUNT(*) n FROM titulos WHERE cancelado = 0').n, titulos + 1);
  assert.equal(db.get("SELECT COUNT(*) n FROM titulos WHERE documento LIKE '829%' AND cancelado = 0").n, 1, 'a nota 829 continua com UMA dívida');
  assert.match(db.get("SELECT observacoes o FROM titulos WHERE documento = '792'").o, /70-8/, 'o nosso número do banco ficou guardado');
  assert.match(db.get("SELECT observacoes o FROM titulos WHERE documento = '851-01'").o, /75-8/);
  assert.equal(db.get("SELECT pago_centavos p FROM v_titulos WHERE documento = '821'").p, 190000, 'a nota paga continua paga');
  // reenviar o mesmo relatório: nada novo
  const de_novo = (await enviar(['sicoobnet.pdf', pdf])).importacoes[0];
  assert.equal(de_novo.resumo.criar, 0); assert.equal(de_novo.resumo.atualizar, 0);
});
