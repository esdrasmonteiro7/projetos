// A ordem de envio não importa: o relatório do banco ANTES das notas termina no mesmo lugar (sem dívida repetida) que depois delas.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, ok } from './helpers.js';
import { construirDevedores, construirControle, paraBuffer } from './fixtures-planilhas.js';
import { xmlNFe, pdfSicoobVencidos } from './fixtures-notas.js';

let app;
let admin;
let db;
before(async () => {
  app = await boot();
  admin = app.client();
  ok(await admin.setup());
  ({ db } = await import('../server/db.js'));
});
after(() => app.close());

const enviar = async (...arqs) => {
  const f = new FormData();
  for (const [nome, buf] of arqs) f.append('arquivos', new Blob([buf]), nome);
  return ok(await admin.call('POST', '/api/importacoes/analisar', undefined, f), 'analisar');
};
const confirmar = async (p) => ok(await admin.post(`/api/importacoes/${p.id}/confirmar`, {}), 'confirmar').resultado;
const repetidos = () => db.all("SELECT documento, COUNT(*) n FROM titulos WHERE cancelado = 0 AND documento IS NOT NULL GROUP BY documento HAVING n > 1");

test('banco → notas: a dívida 851 (1 de 19.200 na planilha) e o boleto 0851-01 do banco (9.600) terminam como as 2 parcelas da nota', async () => {
  for (const wb of [await construirControle(), await construirDevedores()]) await confirmar((await enviar(['planilha.xlsx', await paraBuffer(wb)])).importacoes[0]);
  const abertoAntes = db.get("SELECT SUM(valor_centavos - pago_centavos) s FROM v_titulos WHERE cancelado = 0 AND valor_centavos > pago_centavos").s;

  // 1) o banco primeiro: ele só conhece o boleto 0851-01; a nota 851 já está no painel como UMA dívida de 19.200 → não cria uma segunda
  const pdf = await pdfSicoobVencidos([{ sacado: 'CLIENTE ETA', nosso: '75-8', seu: '0851-01', entrada: '2026-11-09', venc: '2026-11-23', valor: 960000 }]);
  const banco = (await enviar(['sicoobnet.pdf', pdf])).importacoes[0];
  assert.equal(banco.resumo.conferir, 1); assert.equal(banco.resumo.criar, 0);
  await confirmar(banco);
  assert.deepEqual(repetidos(), []);
  assert.equal(db.all("SELECT 1 FROM titulos WHERE documento LIKE '851%'").length, 1);

  // 2) as notas depois: a 851 vira 851-01 + 851-02
  const item = (codigo, descricao, qtd, preco) => ({ codigo, descricao, qtd, preco });
  const xml = xmlNFe({ numero: 851, data: '2026-11-09', cliente: { nome: 'CLIENTE ETA', doc: '11111111000004' }, itens: [item('7898971278060', 'BOLACHA PRINCESINHA 400G', 100, 102), item('7898971278008', 'BOLACHA PRINCESINHA 300G', 100, 90)], parcelas: [{ venc: '2026-11-23', valor: 9600 }, { venc: '2026-11-30', valor: 9600 }] });
  const notas = (await enviar(['NFe 851.xml', xml])).importacoes[0];
  assert.equal(notas.resumo.atualizar, 1);
  await confirmar(notas);
  assert.deepEqual(db.all("SELECT documento, valor_centavos FROM titulos WHERE documento LIKE '851%' ORDER BY documento"), [{ documento: '851-01', valor_centavos: 960000 }, { documento: '851-02', valor_centavos: 960000 }]);
  assert.deepEqual(repetidos(), []);
  assert.equal(db.get("SELECT SUM(valor_centavos - pago_centavos) s FROM v_titulos WHERE cancelado = 0 AND valor_centavos > pago_centavos").s, abertoAntes, 'o total em aberto é o mesmo de antes: a dívida foi só dividida');

  // 3) o banco de novo: agora o boleto 0851-01 existe e só ganha o nosso número
  const de_novo = (await enviar(['sicoobnet.pdf', pdf])).importacoes[0];
  assert.equal(de_novo.resumo.conferir, 0); assert.equal(de_novo.resumo.criar, 0); assert.equal(de_novo.resumo.atualizar, 1);
  await confirmar(de_novo);
  assert.match(db.get("SELECT observacoes o FROM titulos WHERE documento = '851-01'").o, /75-8/);
  assert.deepEqual(repetidos(), []);
});
