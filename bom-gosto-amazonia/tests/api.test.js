import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, ok } from './helpers.js';
import { todayISO, addDays, ymAdd, monthBounds } from '../shared/dates.js';

let app;
let admin;
let marcos; // vendedor 1
let ana; // vendedor 2
const ids = {};
const hoje = todayISO('America/Manaus');
const ym = hoje.slice(0, 7);
const proxMes = monthBounds(ymAdd(ym, 1)).inicio;
const depois = monthBounds(ymAdd(ym, 2)).inicio;

before(async () => {
  app = await boot();
  admin = app.client();
});
after(() => app.close());

// ------------------------------------------------------------------ acesso e segurança
test('primeiro acesso cria o administrador e só funciona uma vez', async () => {
  const s = ok(await admin.get('/api/sessao'));
  assert.equal(s.precisa_setup, true);
  assert.equal((await admin.setup('Admin', 'admin@teste.com', 'curta')).status, 400); // senha curta
  ok(await admin.setup('Admin', 'admin@teste.com', 'senha-forte-1'));
  const outro = app.client();
  assert.equal((await outro.setup('Intruso', 'x@y.com', 'senha-forte-2')).status, 403);
  assert.equal(ok(await admin.get('/api/sessao')).usuario.papel, 'admin');
});

test('rotas exigem login e escrita exige o token CSRF', async () => {
  const anon = app.client();
  assert.equal((await anon.get('/api/vendas')).status, 401);
  assert.equal((await anon.get('/api/dashboard')).status, 401);
  // sem o cabeçalho CSRF a escrita é recusada mesmo logado
  const r = await admin.raw('POST', '/api/clientes', { body: { nome: 'X' }, headers: { 'x-csrf-token': 'errado' } });
  assert.equal(r.status, 403);
  // origem diferente também é recusada
  const r2 = await admin.raw('POST', '/api/clientes', { body: { nome: 'X' }, headers: { origin: 'https://site-malicioso.com' } });
  assert.equal(r2.status, 403);
});

test('administrador cadastra vendedores com acesso e produtos', async () => {
  ids.v1 = ok(await admin.post('/api/vendedores', { nome: 'Marcos Lima', telefone: '(92) 99999-0001', comissao_pct: 5, criar_acesso: true, email: 'marcos@teste.com', senha: 'marcos-1234' })).id;
  ids.v2 = ok(await admin.post('/api/vendedores', { nome: 'Ana Souza', comissao_pct: 4, criar_acesso: true, email: 'ana@teste.com', senha: 'ana-12345' })).id;
  ids.prod = ok(await admin.post('/api/produtos', { nome: 'Polpa de Açaí 1kg', unidade: 'pct', preco_centavos: 2500, custo_centavos: 1500, estoque_minimo: 50 })).id;
  assert.equal((await admin.post('/api/vendedores', { nome: 'Com senha curta', criar_acesso: true, email: 'c@teste.com', senha: '123' })).status, 400);
  marcos = app.client();
  ana = app.client();
  ok(await marcos.login('marcos@teste.com', 'marcos-1234'));
  ok(await ana.login('ana@teste.com', 'ana-12345'));
});

test('vendedor não acessa áreas de administrador', async () => {
  for (const [m, u] of [['GET', '/api/usuarios'], ['GET', '/api/auditoria'], ['GET', '/api/configuracoes'], ['GET', '/api/backup'], ['GET', '/api/importacoes'], ['GET', '/api/producao'], ['GET', '/api/estoque/resumo'], ['GET', '/api/recebimentos/sugestoes']]) {
    const r = await marcos.call(m, u);
    assert.equal(r.status, 403, `${m} ${u} deveria ser 403, veio ${r.status}`);
  }
  assert.equal((await marcos.post('/api/vendedores', { nome: 'Hacker' })).status, 403);
  assert.equal((await marcos.post('/api/produtos', { nome: 'Item' })).status, 403);
  assert.equal((await marcos.post('/api/estoque/movimentos', { tipo: 'entrada', produto_id: ids.prod, quantidade: 5 })).status, 403);
});

// ------------------------------------------------------------------ vendas, dívidas e baixas
test('venda a prazo gera parcelas e os números do painel batem', async () => {
  ids.cli1 = ok(await admin.post('/api/clientes', { nome: 'Mercadinho Souza', telefone: '92988887777', vendedor_id: ids.v1 })).id;
  ids.cli2 = ok(await admin.post('/api/clientes', { nome: 'Padaria Pão de Ouro', vendedor_id: ids.v2 })).id;
  const v = ok(await admin.post('/api/vendas', {
    data: hoje, cliente_id: ids.cli1, vendedor_id: ids.v1, itens: [{ produto_id: ids.prod, quantidade: 40, preco_centavos: 2500 }],
    forma_pagamento: 'prazo', parcelas: [{ vencimento: proxMes, valor_centavos: 40000 }, { vencimento: depois, valor_centavos: 60000 }],
  }));
  assert.equal(v.total_centavos, 100000);
  assert.equal(v.titulos.length, 2);
  ids.venda1 = v.venda_id;
  // parcelas com soma errada são recusadas
  const errada = await admin.post('/api/vendas', { data: hoje, cliente_id: ids.cli1, vendedor_id: ids.v1, itens: [{ descricao: 'X', quantidade: 1, preco_centavos: 1000 }], forma_pagamento: 'prazo', parcelas: [{ vencimento: proxMes, valor_centavos: 999 }] });
  assert.equal(errada.status, 400);
  // dívida avulsa já vencida
  ok(await admin.post('/api/titulos', { cliente_id: ids.cli2, valor_centavos: 25000, vencimento: addDays(hoje, -10), documento: 'FIADO-1' }));
  const d = ok(await admin.get(`/api/dashboard?mes=${ym}`));
  assert.equal(d.vendido.total, 100000);
  assert.equal(d.em_aberto.total, 125000);
  assert.equal(d.vencido.total, 25000);
  assert.equal(d.a_receber_proximo_mes.total, 40000);
  assert.equal(d.recebido.total, 0);
});

test('baixa parcial, baixa total e estorno', async () => {
  const lista = ok(await admin.get('/api/titulos?status=abertos')).itens;
  const t1 = lista.find((t) => t.valor_centavos === 40000);
  const r1 = ok(await admin.post(`/api/titulos/${t1.id}/baixar`, { valor_centavos: 15000, forma: 'pix' }));
  let det = ok(await admin.get(`/api/titulos/${t1.id}`));
  assert.equal(det.titulo.status, 'parcial');
  assert.equal(det.titulo.aberto_centavos, 25000);
  // não deixa baixar mais do que falta
  assert.equal((await admin.post(`/api/titulos/${t1.id}/baixar`, { valor_centavos: 99999 })).status, 400);
  ok(await admin.post(`/api/titulos/${t1.id}/baixar`, {}));
  det = ok(await admin.get(`/api/titulos/${t1.id}`));
  assert.equal(det.titulo.status, 'pago');
  // estorno devolve o saldo
  ok(await admin.del(`/api/baixas/${det.baixas[1].id}`));
  assert.equal(ok(await admin.get(`/api/titulos/${t1.id}`)).titulo.aberto_centavos, 25000);
  assert.ok(r1.recebimento_id);
  const d = ok(await admin.get(`/api/dashboard?mes=${ym}`));
  assert.equal(d.recebido.total, 15000);
  assert.equal(d.em_aberto.total, 110000);
});

test('Pix recebido recebe sugestão de baixa (nome e valor) e a baixa em lote funciona', async () => {
  const pix = ok(await admin.post('/api/recebimentos', { data: hoje, valor_centavos: 25000, forma: 'pix', pagador_nome: 'PADARIA PAO DE OURO ME', ref_externa: 'E1823612020261122AAAA1111BBBB22' }));
  const sug = ok(await admin.get('/api/recebimentos/sugestoes'));
  const item = sug.find((s) => s.recebimento.id === pix.id);
  assert.ok(item, 'o Pix deveria aparecer para conciliar');
  assert.equal(item.sugestoes[0].confianca, 'alta');
  assert.equal(item.sugestoes[0].cliente_nome, 'Padaria Pão de Ouro');
  // repetir o mesmo código de transação é recusado
  assert.equal((await admin.post('/api/recebimentos', { data: hoje, valor_centavos: 25000, forma: 'pix', ref_externa: 'E1823612020261122AAAA1111BBBB22' })).status, 409);
  const r = ok(await admin.post('/api/recebimentos/conciliar-lote', { itens: [{ recebimento_id: pix.id, titulo_ids: item.sugestoes[0].titulo_ids }] }));
  assert.equal(r.feitos, 1);
  const d = ok(await admin.get(`/api/dashboard?mes=${ym}`));
  assert.equal(d.vencido.total, 0);
  assert.equal(d.recebido.sem_baixa_qtd, 0);
});

test('vendedor só enxerga os próprios dados (isolamento)', async () => {
  const mv = ok(await marcos.get('/api/vendas?mes=' + ym));
  assert.equal(mv.total, 1);
  const av = ok(await ana.get('/api/vendas?mes=' + ym));
  assert.equal(av.total, 0);
  assert.equal(ok(await ana.get('/api/clientes')).total, 1);
  assert.equal(ok(await ana.get('/api/clientes')).itens[0].nome, 'Padaria Pão de Ouro');
  // acesso direto por ID a dados de outro vendedor → "não encontrado"
  assert.equal((await ana.get(`/api/vendas/${ids.venda1}`)).status, 404);
  assert.equal((await ana.get(`/api/clientes/${ids.cli1}`)).status, 404);
  const tit = ok(await admin.get(`/api/titulos?cliente_id=${ids.cli1}&status=todos`)).itens[0];
  assert.equal((await ana.get(`/api/titulos/${tit.id}`)).status, 404);
  assert.equal((await ana.get(`/api/titulos/${tit.id}/cobranca`)).status, 404);
  // tentar ver os dados do outro via filtro na URL não funciona
  const f = ok(await ana.get(`/api/vendas?mes=${ym}&vendedor_id=${ids.v1}`));
  assert.equal(f.total, 0);
  const dash = ok(await ana.get(`/api/dashboard?mes=${ym}&vendedor_id=${ids.v1}`));
  assert.equal(dash.vendido.total, 0);
  assert.equal(dash.por_vendedor.length, 0);
  assert.equal(dash.deposito, null);
  // não pode lançar venda para cliente de outro vendedor nem dar baixa
  const venda = await ana.post('/api/vendas', { data: hoje, cliente_id: ids.cli1, itens: [{ descricao: 'X', quantidade: 1, preco_centavos: 1000 }], forma_pagamento: 'prazo' });
  assert.equal(venda.status, 403);
  assert.equal((await ana.post(`/api/titulos/${tit.id}/baixar`, {})).status, 403);
  assert.equal((await ana.get(`/api/exportar/clientes.csv`)).status, 200);
});

test('vendedor informa pagamento e o administrador confirma', async () => {
  const t = ok(await marcos.get('/api/titulos?status=abertos')).itens[0];
  const info = ok(await marcos.call('POST', `/api/titulos/${t.id}/informar-pagamento`, undefined, (() => { const f = new FormData(); f.set('valor_centavos', String(t.aberto_centavos)); f.set('data', hoje); return f; })()));
  assert.equal(info.pendente, true);
  assert.equal(ok(await admin.get('/api/alertas')).pendentes, 1);
  // enquanto pendente, nada muda no em aberto
  assert.equal(ok(await admin.get(`/api/titulos/${t.id}`)).titulo.aberto_centavos, t.aberto_centavos);
  ok(await admin.post(`/api/recebimentos/${info.recebimento_id}/confirmar`));
  assert.equal(ok(await admin.get(`/api/titulos/${t.id}`)).titulo.status, 'pago');
});

test('cancelar venda cancela as parcelas', async () => {
  const v = ok(await admin.post('/api/vendas', { data: hoje, vendedor_id: ids.v2, cliente_id: ids.cli2, itens: [{ descricao: 'Teste', quantidade: 2, preco_centavos: 5000 }], forma_pagamento: 'prazo' }));
  const antes = ok(await admin.get(`/api/dashboard?mes=${ym}`)).em_aberto.total;
  ok(await admin.post(`/api/vendas/${v.venda_id}/cancelar`));
  const depoisT = ok(await admin.get(`/api/dashboard?mes=${ym}`)).em_aberto.total;
  assert.equal(antes - depoisT, 10000);
});

// ------------------------------------------------------------------ depósito
test('depósito: retirada exige vendedor, produção entra no plano e saldos conferem', async () => {
  const plano = ok(await admin.post('/api/producao', { produto_id: ids.prod, planejado: 300, data: hoje }));
  ok(await admin.post('/api/estoque/movimentos', { tipo: 'producao', produto_id: ids.prod, quantidade: 200, data: hoje })); // entra no plano automaticamente
  ok(await admin.post('/api/estoque/movimentos', { tipo: 'entrada', produto_id: ids.prod, quantidade: 100, data: hoje }));
  assert.equal((await admin.post('/api/estoque/movimentos', { tipo: 'retirada', produto_id: ids.prod, quantidade: 10 })).status, 400);
  ok(await admin.post('/api/estoque/movimentos', { tipo: 'retirada', produto_id: ids.prod, quantidade: 60, vendedor_id: ids.v1, data: hoje }));
  ok(await admin.post('/api/estoque/movimentos', { tipo: 'devolucao', produto_id: ids.prod, quantidade: 10, vendedor_id: ids.v1, data: hoje }));
  const neg = ok(await admin.post('/api/estoque/movimentos', { tipo: 'saida', produto_id: ids.prod, quantidade: 1000, data: hoje }));
  assert.ok(neg.aviso, 'estoque negativo deveria avisar');
  const lista = ok(await admin.get(`/api/producao?mes=${ym}`)).itens.find((o) => o.id === plano.id);
  assert.equal(lista.produzido, 200);
  assert.equal(lista.faltou, 100);
  const ret = ok(await admin.get(`/api/estoque/retiradas?mes=${ym}`)).itens.find((r) => r.vendedor_id === ids.v1);
  assert.equal(ret.retirado_mes, 60);
  assert.equal(ret.em_maos, 50);
  const dash = ok(await admin.get(`/api/dashboard?mes=${ym}`));
  assert.equal(dash.retiradas.unidades, 60);
  assert.equal(dash.deposito.producao.nao_produzido, 100);
  // vendedor vê só as próprias retiradas
  const mr = ok(await marcos.get(`/api/estoque/retiradas?mes=${ym}`));
  assert.equal(mr.itens.length, 1);
  assert.equal(mr.itens[0].retirado_mes, 60);
  assert.equal(ok(await ana.get(`/api/estoque/retiradas?mes=${ym}`)).itens[0].retirado_mes, 0);
});

// ------------------------------------------------------------------ relatórios e exportações
test('PDF do resumo e planilhas CSV funcionam para administrador e vendedor', async () => {
  const pdf = await admin.raw('GET', `/api/relatorios/resumo.pdf?mes=${ym}&vendedores=1&deposito=1`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 20000);
  const pdfV = await marcos.raw('GET', `/api/relatorios/resumo.pdf?mes=${ym}`);
  assert.equal(pdfV.status, 200, 'vendedor deve conseguir gerar o próprio PDF');
  const csv = await admin.raw('GET', `/api/exportar/a-receber.csv?status=todos`);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV precisa começar com BOM para o Excel ler os acentos');
  const texto = bytes.toString('utf8');
  assert.ok(texto.includes('Cliente;Telefone;Vendedor'));
  assert.match(texto, /Mercadinho Souza/);
  const csvV = await ana.raw('GET', '/api/exportar/vendas.csv');
  assert.doesNotMatch(await csvV.text(), /Mercadinho Souza/);
});

test('backup baixa o banco SQLite inteiro (só administrador)', async () => {
  const r = await admin.raw('GET', '/api/backup');
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
});

// ------------------------------------------------------------------ usuários e senhas
test('trocar senha, redefinir senha e impedir ficar sem administrador', async () => {
  const meu = ok(await admin.get('/api/usuarios')).find((u) => u.email === 'admin@teste.com');
  // não pode desativar o único administrador / a si mesmo
  assert.equal((await admin.put(`/api/usuarios/${meu.id}`, { ativo: false })).status, 400);
  assert.equal((await admin.put(`/api/usuarios/${meu.id}`, { papel: 'vendedor', vendedor_id: ids.v1 })).status, 400);
  // redefinir a senha do vendedor derruba as sessões dele e exige nova troca
  const mu = ok(await admin.get('/api/usuarios')).find((u) => u.email === 'marcos@teste.com');
  ok(await admin.post(`/api/usuarios/${mu.id}/senha`, { senha: 'provisoria-99' }));
  assert.equal((await marcos.get('/api/dashboard')).status, 401);
  const novo = app.client();
  const l = ok(await novo.login('marcos@teste.com', 'provisoria-99'));
  assert.equal(l.usuario.trocar_senha, true);
  assert.equal((await novo.post('/api/minha-senha', { atual: 'errada', nova: 'nova-senha-123' })).status, 400);
  ok(await novo.post('/api/minha-senha', { atual: 'provisoria-99', nova: 'nova-senha-123' }));
  assert.equal((await app.client().login('marcos@teste.com', 'provisoria-99')).status, 401);
  ok(await app.client().login('marcos@teste.com', 'nova-senha-123'));
  // usuário desativado não entra
  ok(await admin.put(`/api/usuarios/${mu.id}`, { ativo: false }));
  assert.equal((await app.client().login('marcos@teste.com', 'nova-senha-123')).status, 401);
});

test('muitas tentativas de login erradas bloqueiam temporariamente', async () => {
  const c = app.client();
  let ultimo;
  for (let i = 0; i < 10; i++) ultimo = await c.login('ana@teste.com', `errada-${i}`);
  assert.equal(ultimo.status, 429);
  // e a senha correta também fica bloqueada enquanto durar o limite
  assert.equal((await c.login('ana@teste.com', 'ana-12345')).status, 429);
});

test('histórico registra as ações importantes', async () => {
  const h = ok(await admin.get('/api/auditoria?limite=200')).itens;
  const acoes = h.map((x) => x.acao).join('|');
  assert.match(acoes, /Lançou venda/);
  assert.match(acoes, /Deu baixa em título/);
  assert.match(acoes, /Redefiniu a senha/);
});
