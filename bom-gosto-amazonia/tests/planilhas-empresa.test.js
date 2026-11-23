// As planilhas que a empresa usa (Lista de Devedores e Controle): leitura, reconhecimento e SINCRONIZAÇÃO com o painel
// (criar o que é novo, atualizar o que mudou, não duplicar nada ao reenviar).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { boot, ok } from './helpers.js';
import { construirDevedores, construirControle, paraBuffer, comComentariosEstiloOpenpyxl } from './fixtures-planilhas.js';
import { lerXlsx, calcularConta } from '../server/services/import/xlsx.js';
import { parseNF, datasNoTexto, canonizarVendedores, reconhecerPlanilha, lerListaDevedores, lerControle } from '../server/services/import/perfis-bomgosto.js';

// ------------------------------------------------------------------ leitor de Excel
test('o leitor abre a planilha que travava o ExcelJS (anotações no estilo openpyxl) sem perder os dados', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Aba');
  ws.getCell('A1').value = 'Cliente'; ws.getCell('B1').value = 'Valor'; ws.getCell('A2').value = 'Ação & Cia'; ws.getCell('B2').value = 12.5;
  ws.getCell('A2').note = 'uma anotação na célula';
  const buf = await comComentariosEstiloOpenpyxl(Buffer.from(await wb.xlsx.writeBuffer()));
  await assert.rejects(() => new ExcelJS.Workbook().xlsx.load(buf), /comments/); // o problema que o usuário viu
  const abas = await lerXlsx(buf);
  assert.deepEqual(abas[0].matriz, [['Cliente', 'Valor'], ['Ação & Cia', 12.5]]);
});

test('leitor: texto compartilhado, datas, números, acentos em &#199;, fórmulas e abas ocultas', async () => {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('Visível');
  a.getCell('A1').value = 'SITUAÇÃO'; a.getCell('B1').value = new Date('2026-11-04T12:00:00Z'); a.getCell('B1').numFmt = 'dd/mm/yyyy';
  a.getCell('C1').value = 1234.56; a.getCell('D1').value = true; a.getCell('E1').value = { formula: 'C1*2', result: 2469.12 };
  a.getCell('A3').value = { formula: '11180*2' }; // fórmula sem resultado guardado: só aproveitamos contas simples
  a.getCell('B3').value = { formula: 'SUM(A1:A2)' }; // referência: ignorada
  wb.addWorksheet('Oculta').state = 'hidden';
  wb.getWorksheet('Oculta').getCell('A1').value = 'segredo';
  const abas = await lerXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(abas.length, 1, 'abas ocultas ficam de fora');
  assert.deepEqual(abas[0].matriz[0].slice(0, 5), ['SITUAÇÃO', '2026-11-04', 1234.56, 'Sim', 2469.12]);
  assert.deepEqual(abas[0].matriz[1].slice(0, 2), [22360, null]);
  assert.deepEqual(abas[0].linhas, [1, 3]);
});

test('contas simples em fórmulas (sem eval) e rejeição de qualquer outra coisa', () => {
  assert.equal(calcularConta('11180*2'), 22360);
  assert.equal(calcularConta('(1000+500)/3'), 500);
  assert.equal(calcularConta('-2*(3+4)'), -14);
  assert.equal(calcularConta('A1*2'), null);
  assert.equal(calcularConta('process.exit()'), null);
  assert.equal(calcularConta('1/0'), null);
});

// ------------------------------------------------------------------ pequenas peças
test('nota fiscal: zeros à esquerda e parcela', () => {
  assert.deepEqual(parseNF('0793-01'), { base: '793', suf: '01', chave: '793-01', texto: '0793-01' });
  assert.equal(parseNF('821').chave, '821');
  assert.equal(parseNF('0900-2').chave, '900-02');
  assert.equal(parseNF('SALDO DE BOLACHA:'), null);
});

test('datas dentro de textos: "BOLETO PAGO 18/11", "11/11 E 18/11" e com ano', () => {
  assert.deepEqual(datasNoTexto('A PRAZO / BOLETO PAGO 18/11', '2026-11-04'), ['2026-11-18']);
  assert.deepEqual(datasNoTexto('BOLETOS PAGOS 11/11 E 18/11', '2026-11-04'), ['2026-11-11', '2026-11-18']);
  assert.deepEqual(datasNoTexto('BOLETO LIQUIDADO SICOOB 20/10/2026'), ['2026-10-20']);
  assert.deepEqual(datasNoTexto('PAGO 02/01', '2026-12-20'), ['2027-01-02']);
});

test('vendedores: grafias do mesmo vendedor viram um só, preferindo o já cadastrado', () => {
  const f = canonizarVendedores(['PETERSSON', 'PETERSSON', 'PETTERSON', 'PETERSON', 'BRITO', 'VALTER BRITO', 'HÉLIO', '']);
  assert.equal(f('PETERSSON'), 'Peterson'); assert.equal(f('PETTERSON'), 'Peterson'); assert.equal(f('BRITO'), 'Valter Brito'); assert.equal(f('HÉLIO'), 'Hélio'); assert.equal(f(''), null);
  assert.equal(canonizarVendedores(['PETERSSON'], ['Peterson'])('PETERSSON'), 'Peterson');
});

// ------------------------------------------------------------------ leitura das duas planilhas
test('Lista de Devedores: reconhece o modelo e lê situação, valores, datas e vendedores', async () => {
  const abas = await lerXlsx(await paraBuffer(await construirDevedores()));
  assert.equal(reconhecerPlanilha(abas), 'devedores');
  const { boletos } = lerListaDevedores(abas);
  assert.equal(boletos.length, 8);
  const por = (doc) => boletos.find((b) => b.documento === doc);
  assert.equal(por('821').situacao, 'pago'); assert.equal(por('821').pago_centavos, 190000); assert.equal(por('821').data_pagamento, '2026-11-18');
  assert.equal(por('792').valor_centavos, 686000); assert.equal(por('792').situacao, 'vencido'); assert.equal(por('792').boleto, '70-8');
  assert.equal(por('829').situacao, ''); // sem situação escrita = em aberto
  assert.equal(por('751-02').situacao, 'baixado');
  assert.equal(por('498-01').pago_centavos, 53350, 'setembro: o valor pago está na primeira coluna OBSERVAÇÃO');
  assert.equal(por('498-01').observacao, 'PAGO NO PIX');
  assert.equal(por('484-02').pago_centavos, 200000, 'valor pago vindo de uma fórmula =1000*2');
  assert.ok(!boletos.some((b) => b.cliente === ''), 'linhas reservadas ("EM ABERTO" sem cliente) e totais não viram boleto');
});

test('Controle: notas por vendedor (inclusive o bloco dividido), parcelas, depósito e produção', async () => {
  const abas = await lerXlsx(await paraBuffer(await construirControle()), { formulas: true });
  assert.equal(reconhecerPlanilha(abas), 'controle');
  const c = lerControle(abas);
  assert.equal(c.vendas.length, 9);
  const quem = (nf) => c.vendas.find((l) => l.nf.chave === nf).vendedor;
  assert.equal(quem('821'), 'HÉLIO'); assert.equal(quem('840'), 'PETERSON');
  assert.equal(quem('885-01'), 'DEWID FURTADO', 'o quadro RELATÓRIO GERAL separa as linhas do bloco "DEWID / GRACY"');
  assert.equal(quem('851'), 'GRACY NEY');
  assert.equal(c.vendas.reduce((s, l) => s + l.valor_centavos, 0), 3481600);
  assert.equal(c.precos['300BG'], 7500);
  assert.equal(c.deposito.entradas.length, 1); assert.equal(c.deposito.saidas.length, 6); assert.equal(c.producao.length, 3);
  assert.equal(c.deposito.saidas.find((s) => s.destino === '(GRACY NEY)').vendedor, 'PETERSON');
});

// ------------------------------------------------------------------ sincronização com o painel (API completa)
let app;
let admin;
before(async () => { app = await boot(); admin = app.client(); ok(await admin.setup()); });
after(() => app.close());

const form = (buf, nome) => { const f = new FormData(); f.append('arquivos', new Blob([buf]), nome); return f; };
const enviar = async (buf, nome) => ok(await admin.call('POST', '/api/importacoes/analisar', undefined, form(buf, nome)), 'analisar');
const confirmar = async (id, corpo = {}) => ok(await admin.post(`/api/importacoes/${id}/confirmar`, corpo), 'confirmar');
const painel = async () => ok(await admin.get('/api/dashboard?mes=2026-11'));
const ctx = {};

test('Controle enviado pela tela: prévia diz o que será criado e a importação grava tudo certo', async () => {
  ctx.controle = await paraBuffer(await construirControle());
  const r = await enviar(ctx.controle, 'Controle.xlsx');
  assert.equal(r.erros.length, 0);
  assert.equal(r.importacoes.length, 1, 'o arquivo todo vira UMA importação (não uma por aba)');
  const p = r.importacoes[0];
  assert.equal(p.tipo, 'planilha');
  assert.equal(p.resumo.total, 16); // 7 notas + 9 movimentos do depósito
  assert.equal(p.resumo.criar, 16); assert.equal(p.resumo.atualizar, 0);
  const det = ok(await admin.get(`/api/importacoes/${p.id}`));
  assert.ok(det.dados.avisos.some((a) => /mesma produção/.test(a)), 'a entrada igual à produção não é contada duas vezes');
  const res = await confirmar(p.id);
  assert.deepEqual([res.resultado.criados.vendas, res.resultado.criados.titulos, res.resultado.criados.recebimentos, res.resultado.criados.movimentos], [7, 9, 2, 9]);
  assert.equal(res.resultado.erros.length, 0);
  const d = await painel();
  assert.equal(d.vendido.total, 3481600, 'vendido do mês = soma das notas da planilha');
  assert.equal(d.em_aberto.total, 3244700);
  const vend = ok(await admin.get('/api/vendedores')).map((v) => v.nome).sort();
  assert.deepEqual(vend, ['Dewid Furtado', 'Gracy Ney', 'Hélio', 'Paulo', 'Peterson']);
  ctx.importControle = p.id;
});

test('Lista de Devedores: reconhece o que já veio do Controle, cria o resto e junta os nomes dos vendedores', async () => {
  ctx.devedores = await paraBuffer(await construirDevedores());
  const r = await enviar(ctx.devedores, 'Devedores.xlsx');
  const p = r.importacoes[0];
  assert.equal(p.resumo.total, 7);
  assert.equal(p.resumo.duplicados, 2, 'notas 821 e 829 já estão iguais (vieram do Controle)');
  assert.equal(p.resumo.criar, 5);
  const det = ok(await admin.get(`/api/importacoes/${p.id}`));
  assert.ok(det.dados.avisos.some((a) => /751-02/.test(a)), 'boleto baixado sem valor é avisado');
  const res = await confirmar(p.id);
  assert.equal(res.resultado.criados.titulos, 5);
  assert.equal(res.resultado.criados.recebimentos, 2);
  assert.equal(res.resultado.criados.vendedores, 1, 'só Valter Brito é novo; PETERSSON/PETTERSON/BRITO foram juntados');
  const d = await painel();
  assert.equal(d.em_aberto.total, 3244700 + 686000 + 171500 + 100000, 'em aberto = Controle + dívidas antigas, sem contar nada duas vezes');
  const nomes = ok(await admin.get('/api/vendedores')).map((v) => v.nome);
  assert.ok(nomes.includes('Valter Brito') && !nomes.some((n) => /Pet+erss?on|^Brito$/i.test(n) && n !== 'Peterson'));
  ctx.importDevedores = p.id;
});

test('enviar as mesmas planilhas de novo não duplica nada (tudo "já igual")', async () => {
  const antes = await painel();
  const a = (await enviar(ctx.controle, 'Controle.xlsx')).importacoes[0];
  assert.equal(a.resumo.criar, 0); assert.equal(a.resumo.atualizar, 0); assert.equal(a.resumo.duplicados, 16);
  const b = (await enviar(ctx.devedores, 'Devedores.xlsx')).importacoes[0];
  assert.equal(b.resumo.criar, 0); assert.equal(b.resumo.atualizar, 0);
  const res = await confirmar(a.id, { incluir: [] });
  assert.equal(res.resultado.criados.vendas + res.resultado.criados.titulos + res.resultado.criados.movimentos, 0);
  assert.deepEqual(await painel(), antes);
});

test('planilha atualizada: uma nota que passou a "PAGO" é atualizada (e só ela), com baixa e recebimento', async () => {
  const novo = await paraBuffer(await construirControle({ pagar829: true }));
  const p = (await enviar(novo, 'Controle.xlsx')).importacoes[0];
  assert.equal(p.resumo.atualizar, 1);
  assert.equal(p.resumo.criar, 0);
  const det = ok(await admin.get(`/api/importacoes/${p.id}`));
  const r = det.dados.registros.find((x) => x._acao === 'atualizar');
  assert.equal(r.numero, '829');
  assert.match(r._avisos.join(' '), /marcar como paga em 20\/11\/2026/);
  const emAbertoAntes = (await painel()).em_aberto.total;
  const res = await confirmar(p.id);
  assert.equal(res.resultado.criados.atualizados, 1);
  assert.equal(res.resultado.criados.recebimentos, 1);
  assert.equal((await painel()).em_aberto.total, emAbertoAntes - 221000);
  const rec = ok(await admin.get('/api/recebimentos?mes=2026-11&limite=100')).itens.find((x) => x.valor_centavos === 221000);
  assert.equal(rec.data, '2026-11-20');
  assert.equal(rec.forma, 'boleto');
  // e reenviar essa versão não muda mais nada
  const de_novo = (await enviar(novo, 'Controle.xlsx')).importacoes[0];
  assert.equal(de_novo.resumo.atualizar, 0); assert.equal(de_novo.resumo.criar, 0);
  ctx.importAtualiza = p.id;
});

test('desfazer a atualização devolve a nota a "em aberto"; desfazer o Controle apaga só o que ele criou', async () => {
  const antes = (await painel()).em_aberto.total;
  ok(await admin.post(`/api/importacoes/${ctx.importAtualiza}/desfazer`));
  assert.equal((await painel()).em_aberto.total, antes + 221000);
  ok(await admin.post(`/api/importacoes/${ctx.importControle}/desfazer`));
  const d = await painel();
  assert.equal(d.vendido.total, 0);
  assert.equal(d.em_aberto.total, 686000 + 171500 + 100000, 'sobram só as dívidas que a Lista de Devedores criou');
});

test('boleto baixado a pedido do cedente entra como cancelado (não conta como dívida) e reenviar não o recria', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('OUTUBRO');
  ['SACADOS', 'NFE', 'ENTRADA', 'VENCIMENTO', 'VENDEDOR', 'VALOR', 'BOLETO', 'SITUAÇÃO', 'OBSERVAÇÃO', 'PAGAMENTO DATA'].forEach((h, i) => { ws.getCell(1, i + 1).value = h; });
  ws.getCell('A2').value = 'CLIENTE CANCELADO LTDA'; ws.getCell('B2').value = '0751-01'; ws.getCell('C2').value = new Date('2026-10-21T12:00:00Z'); ws.getCell('C2').numFmt = 'yyyy-mm-dd';
  ws.getCell('D2').value = new Date('2026-10-28T12:00:00Z'); ws.getCell('D2').numFmt = 'yyyy-mm-dd'; ws.getCell('E2').value = 'ALESSANDRA';
  ws.getCell('G2').value = '66-9'; ws.getCell('H2').value = 'BAIXADO'; ws.getCell('I2').value = 'BAIXA A PEDIDO CEDENTE 04/11 (R$ 226,00)';
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const emAbertoAntes = (await painel()).em_aberto.total;
  const p = (await enviar(buf, 'Cancelado.xlsx')).importacoes[0];
  assert.equal(p.resumo.criar, 1);
  const res = await confirmar(p.id);
  assert.equal(res.resultado.criados.titulos, 1);
  assert.equal((await painel()).em_aberto.total, emAbertoAntes, 'cancelado não entra no que está em aberto');
  const de_novo = (await enviar(buf, 'Cancelado.xlsx')).importacoes[0];
  assert.equal(de_novo.resumo.criar, 0, 'reconhecido como já existente');
  assert.equal(de_novo.resumo.duplicados, 1);
});
