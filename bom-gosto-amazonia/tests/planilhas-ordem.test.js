// A ordem de envio não importa: Lista de Devedores primeiro e Controle depois dá o mesmo resultado
// (as dívidas já importadas são "adotadas" pelas vendas, sem duplicar), e desfazer o Controle não leva as dívidas da lista junto.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, ok } from './helpers.js';
import { construirDevedores, construirControle, paraBuffer } from './fixtures-planilhas.js';

let app;
let admin;
before(async () => { app = await boot(); admin = app.client(); ok(await admin.setup()); });
after(() => app.close());

const form = (buf, nome) => { const f = new FormData(); f.append('arquivos', new Blob([buf]), nome); return f; };
const enviar = async (buf, nome) => (ok(await admin.call('POST', '/api/importacoes/analisar', undefined, form(buf, nome)), 'analisar')).importacoes[0];
const confirmar = async (id) => ok(await admin.post(`/api/importacoes/${id}/confirmar`, {}), 'confirmar').resultado;
const painel = async () => ok(await admin.get('/api/dashboard?mes=2026-11'));
const titulos = async () => ok(await admin.get('/api/titulos?status=todos&limite=200')).itens;
const ctx = {};

test('Lista de Devedores primeiro: cria as 7 dívidas (com o Peterson escrito de 3 jeitos virando um só)', async () => {
  const p = await enviar(await paraBuffer(await construirDevedores()), 'Devedores.xlsx');
  assert.equal(p.resumo.criar, 7);
  const res = await confirmar(p.id);
  assert.equal(res.criados.titulos, 7);
  assert.equal(res.criados.recebimentos, 3, '821, 498-01 e 484-02 estão pagas');
  const nomes = ok(await admin.get('/api/vendedores')).map((v) => v.nome).sort();
  assert.equal(nomes.filter((n) => /^Pet/i.test(n)).length, 1, 'uma só grafia do Peterson');
  assert.ok(nomes.includes('Valter Brito') && !nomes.includes('Brito'));
  ctx.devedores = p.id;
});

test('Controle depois: as dívidas 821 e 829 passam a fazer parte das vendas (sem duplicar) e o total fecha', async () => {
  const p = await enviar(await paraBuffer(await construirControle()), 'Controle.xlsx');
  const det = ok(await admin.get(`/api/importacoes/${p.id}`));
  const v829 = det.dados.registros.find((r) => r.op === 'venda' && r.numero === '829');
  assert.match(v829._avisos.join(' '), /Já existe 1 boleto desta nota/);
  const res = await confirmar(p.id);
  assert.equal(res.criados.vendas, 7);
  assert.equal(res.criados.titulos, 7, '9 parcelas no total, 2 delas já existiam (821 e 829)');
  assert.equal(res.criados.recebimentos, 1, 'só a venda em dinheiro (871); a 821 já estava paga pela lista de devedores');
  const todos = await titulos();
  assert.equal(todos.length, 14, '5 sem nota + 9 parcelas de notas, sem nenhuma repetida');
  const t829 = todos.filter((t) => t.documento === '829');
  assert.equal(t829.length, 1);
  assert.ok(t829[0].venda_id, 'a dívida da lista passou a pertencer à venda 829');
  assert.equal((await painel()).em_aberto.total, 4202200, 'mesmo total do outro caminho: 32.447,00 + 9.575,00');
  ctx.controle = p.id;
});

test('desfazer o Controle apaga as vendas e as dívidas dele, mas mantém as dívidas que vieram da lista', async () => {
  ok(await admin.post(`/api/importacoes/${ctx.controle}/desfazer`));
  const todos = await titulos();
  assert.equal(todos.length, 7);
  assert.ok(todos.every((t) => !t.venda_id));
  assert.ok(todos.some((t) => t.documento === '821') && todos.some((t) => t.documento === '829'));
  assert.equal((await painel()).vendido.total, 0);
});
