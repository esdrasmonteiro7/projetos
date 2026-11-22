import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, fmtBRL } from '../shared/money.js';
import { parseDate, addMonths, ymAdd, monthBounds, daysBetween } from '../shared/dates.js';
import { nameScore, norm } from '../shared/text.js';
import { lerCSV, decodificar } from '../server/services/import/leitor.js';
import { statusPago, papelDoCabecalho, mapearColunas } from '../server/services/import/tabela.js';

test('dinheiro em formato brasileiro', () => {
  const casos = [['R$ 1.234,56', 123456], ['1234,56', 123456], ['1.234', 123400], ['12.5', 1250], ['1234.56', 123456], ['(50,00)', -5000], ['-1.234,56', -123456], ['1.250,00 D', -125000], ['0,5', 50], ['1.234.567,89', 123456789], ['abc', null], ['', null], [1234.5, 123450], ['R$ 99', 9900]];
  for (const [entrada, esperado] of casos) assert.equal(parseMoney(entrada), esperado, `parseMoney(${JSON.stringify(entrada)})`);
  assert.equal(fmtBRL(123456), 'R$ 1.234,56');
});

test('datas brasileiras e do Excel', () => {
  assert.equal(parseDate('05/11/2026'), '2026-11-05');
  assert.equal(parseDate('5/1/26'), '2026-01-05');
  assert.equal(parseDate('2026-11-05T10:00:00Z'), '2026-11-05');
  assert.equal(parseDate('11 NOV 2026'), '2026-11-11');
  assert.equal(parseDate('11 de novembro de 2026'), '2026-11-11');
  assert.equal(parseDate('20261105'), '2026-11-05');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate(46000), '2025-12-09');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(ymAdd('2026-12', 1), '2027-01');
  assert.deepEqual(monthBounds('2026-02'), { inicio: '2026-02-01', fim: '2026-02-28' });
  assert.equal(daysBetween('2026-11-01', '2026-11-22'), 21);
});

test('nomes parecidos', () => {
  assert.equal(nameScore('JOAO DA SILVA', 'João Silva'), 1);
  assert.ok(nameScore('Mercadinho Souza LTDA', 'Mercadinho Sousa') > 0.85);
  assert.ok(nameScore('Padaria Pão ME', 'Padaria Pão de Ouro') > 0.8);
  assert.ok(nameScore('Maria Santos', 'Pedro Santos') < 0.6);
  assert.equal(norm('Ação  Ótima!'), 'acao otima');
});

test('CSV do Excel brasileiro: separador ; e acentos em Windows-1252', () => {
  const buf = Buffer.from('Cliente;Valor\r\nPadaria Pão;"1.250,00"\r\n', 'latin1');
  const linhas = lerCSV(decodificar(buf));
  assert.deepEqual(linhas, [['Cliente', 'Valor'], ['Padaria Pão', '1.250,00']]);
});

test('reconhecimento de colunas e situação de pagamento', () => {
  assert.equal(papelDoCabecalho('Valor Pago').papel, 'valor_pago');
  assert.equal(papelDoCabecalho('Data de Vencimento').papel, 'vencimento');
  assert.equal(papelDoCabecalho('Nome do Cliente').papel, 'cliente');
  assert.equal(papelDoCabecalho('Vendedor(a)').papel, 'vendedor');
  assert.deepEqual(mapearColunas(['Cliente', 'Vendedor', 'Valor devido', 'Vencimento']), { 0: 'cliente', 1: 'vendedor', 2: 'valor', 3: 'vencimento' });
  assert.equal(statusPago('Sim').pago, true);
  assert.equal(statusPago('não').pago, false);
  assert.deepEqual(statusPago('05/11/2026'), { pago: true, data: '2026-11-05' });
  assert.equal(statusPago(250).pago, null);
});
