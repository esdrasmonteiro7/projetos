// Dados de DEMONSTRAÇÃO (fictícios) para conhecer o painel sem digitar nada.
// Uso:  DATA_DIR=./data-demo node scripts/seed-demo.js   e depois   DATA_DIR=./data-demo npm start
// Login de teste:  admin@demo.com / demo12345   (vendedor: marcos@demo.com / demo12345)
import { db } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { criarVenda, registrarRecebimento, registrarBaixa } from '../server/services/finance.js';
import { criarCliente, criarProduto, criarVendedor } from '../server/services/entities.js';
import { todayISO, addDays, addMonths, monthBounds, ymAdd } from '../shared/dates.js';
import { getTZ } from '../server/db.js';

if (db.get('SELECT COUNT(*) n FROM usuarios').n > 0 && !process.argv.includes('--force')) {
  console.error('Este banco já tem usuários. Use outro DATA_DIR ou --force para recriar os dados de demonstração por cima.');
  process.exit(1);
}

// gerador pseudo-aleatório com semente fixa (sempre os mesmos dados)
let seed = 20261122;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const hoje = todayISO(getTZ());
const ymHoje = hoje.slice(0, 7);
const senha = await hashPassword('demo12345');

db.tx(() => {
  const vendedores = [
    ['Marcos Lima', '(92) 99111-2233', 'marcos@demo.com', 5],
    ['Ana Paula Souza', '(92) 99222-3344', 'ana@demo.com', 5],
    ['Carlos Monteiro', '(92) 99333-4455', 'carlos@demo.com', 4],
    ['Juliana Ferreira', '(92) 99444-5566', null, 4],
    ['Rafael Nogueira', '(92) 99555-6677', null, 3],
  ].map(([nome, tel, email, pct]) => ({ id: criarVendedor({ nome, telefone: tel, email, comissao_pct: pct }), nome, email }));

  db.run("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('Administrador Demo','admin@demo.com',?,'admin')", senha);
  for (const v of vendedores.filter((x) => x.email)) {
    db.run("INSERT INTO usuarios (nome, email, senha_hash, papel, vendedor_id) VALUES (?,?,?,'vendedor',?)", v.nome, v.email, senha, v.id);
  }

  const produtos = [
    ['Polpa de Açaí 1kg', 'pct', 28, 17, 'Polpas'],
    ['Polpa de Cupuaçu 1kg', 'pct', 24, 14, 'Polpas'],
    ['Polpa de Graviola 1kg', 'pct', 22, 13, 'Polpas'],
    ['Polpa de Taperebá 1kg', 'pct', 23, 13.5, 'Polpas'],
    ['Castanha-do-Pará 500g', 'pct', 38, 24, 'Castanhas'],
    ['Farinha de Mandioca 1kg', 'pct', 9, 5.5, 'Mercearia'],
    ['Tucupi 500ml', 'gf', 14, 8, 'Mercearia'],
    ['Goma de Tapioca 1kg', 'pct', 12, 7, 'Mercearia'],
    ['Guaraná em Pó 100g', 'pct', 19, 11, 'Mercearia'],
    ['Biscoito de Castanha 200g', 'pct', 11, 6.2, 'Biscoitos'],
    ['Pimenta de Cheiro 300g', 'pt', 8, 4.4, 'Mercearia'],
    ['Doce de Cupuaçu 400g', 'pt', 16, 9, 'Doces'],
  ].map(([nome, un, preco, custo, cat]) => ({
    id: criarProduto({ nome, unidade: un, preco_centavos: Math.round(preco * 100), custo_centavos: Math.round(custo * 100), categoria: cat, estoque_minimo: 40 }),
    nome, unidade: un, preco: Math.round(preco * 100),
  }));

  const nomesClientes = [
    'Mercadinho Souza', 'Padaria Pão de Ouro', 'Supermercado Amazonas', 'Restaurante Sabor da Terra', 'Mercantil Boa Esperança', 'Casa do Açaí Tropical',
    'Lanchonete Estrela do Norte', 'Sorveteria Gelo Fino', 'Mercado do Zé Maria', 'Hotel Rio Negro', 'Cantina Dona Francisca', 'Empório Floresta Viva',
    'Atacadão do Norte', 'Bar e Petiscaria Ponta Negra', 'Mini Box Central', 'Doceria Amor Cupuaçu', 'Quitanda da Dona Raimunda', 'Frutaria Tambaqui',
    'Mercadinho Boa Vista', 'Pastelaria Estação Verde', 'Churrascaria Ribeirinha', 'Supermercado Equatorial', 'Feira Orgânica da Serra', 'Lojas Cacau & Cia',
    'Buffet Sabores do Pará', 'Mercearia Dois Irmãos', 'Cafeteria Café com Tapioca', 'Pousada Igarapé', 'Mercadinho Nova Era', 'Distribuidora Rio Solimões',
    'Padaria Delícia Amazônica', 'Sacolão do Povo', 'Restaurante Peixe na Telha', 'Armazém Tucumã', 'Lanches da Praça', 'Casa de Carnes Boi Bumbá',
  ];
  const clientes = nomesClientes.map((nome, i) => {
    const v = vendedores[i % vendedores.length];
    const id = criarCliente({
      nome, telefone: `(92) 9${between(8000, 9999)}-${between(1000, 9999)}`, cidade: pick(['Manaus', 'Manaus', 'Manaus', 'Iranduba', 'Manacapuru']), vendedor_id: v.id,
      documento: i % 3 === 0 ? String(between(10_000_000, 99_999_999)) + '000199' : null,
    });
    return { id, nome, vendedor: v, perfil: rnd() };
  });

  // ---- vendas dos últimos 8 meses ----
  let numero = 1000;
  const titulosAbertosParaPix = [];
  for (let m = -7; m <= 0; m++) {
    const ym = ymAdd(ymHoje, m);
    const { inicio, fim } = monthBounds(ym);
    const ultimoDia = ym === ymHoje ? hoje : fim;
    const qtdVendas = between(26, 40) + (m + 7) * 2;
    for (let i = 0; i < qtdVendas; i++) {
      const dia = between(1, Number(ultimoDia.slice(8, 10)));
      const data = `${ym}-${String(dia).padStart(2, '0')}`;
      const c = pick(clientes);
      const itens = Array.from({ length: between(1, 4) }, () => {
        const p = pick(produtos);
        return { produto_id: p.id, descricao: p.nome, quantidade: between(4, 36), unidade: p.unidade, preco_centavos: p.preco };
      });
      const total = itens.reduce((s, it) => s + it.quantidade * it.preco_centavos, 0);
      const forma = pick(['pix', 'pix', 'dinheiro', 'prazo', 'prazo', 'prazo', 'boleto']);
      const aprazo = ['prazo', 'boleto'].includes(forma);
      const n = aprazo && total > 90000 && rnd() < 0.4 ? 2 : 1;
      const parcelas = aprazo
        ? Array.from({ length: n }, (_, k) => ({ vencimento: addDays(data, 30 * (k + 1)), valor_centavos: k === n - 1 ? total - Math.floor(total / n) * (n - 1) : Math.floor(total / n) }))
        : [{ vencimento: data, valor_centavos: total }];
      const r = criarVenda(
        { numero: String(numero++), data, cliente_id: c.id, vendedor_id: c.vendedor.id, itens, forma_pagamento: forma, parcelas, pago: !aprazo, origem: 'manual' },
        { user_id: 1 },
      );
      if (aprazo) {
        // quita quase tudo que já venceu (uns atrasados, uns no prazo); deixa alguns vencidos em aberto
        for (let k = 0; k < r.titulos.length; k++) {
          const venc = parcelas[k].vencimento;
          const foiVencido = venc < hoje;
          const pagou = foiVencido ? rnd() < (c.perfil > 0.82 ? 0.25 : 0.9) : rnd() < 0.06;
          if (pagou) {
            const dataPg = foiVencido ? (rnd() < 0.7 ? addDays(venc, between(-3, 4)) : addDays(venc, between(8, 25))) : data;
            const dpg = dataPg > hoje ? hoje : dataPg;
            const rid = registrarRecebimento({
              data: dpg, valor_centavos: parcelas[k].valor_centavos, forma: pick(['pix', 'pix', 'pix', 'transferencia', 'dinheiro']), pagador_nome: c.nome,
              cliente_id: c.id, vendedor_id: c.vendedor.id, origem: 'baixa', user_id: 1,
            });
            registrarBaixa({ titulo_id: r.titulos[k], recebimento_id: rid, valor_centavos: parcelas[k].valor_centavos, data: dpg, user_id: 1 });
          } else if (venc >= addDays(hoje, -2) || foiVencido) titulosAbertosParaPix.push({ id: r.titulos[k], cliente: c, valor: parcelas[k].valor_centavos });
        }
      }
    }
  }

  // ---- Pix recebidos ainda sem baixa (para mostrar a conciliação) ----
  const abertos = db.all(
    'SELECT t.id, t.cliente_id, t.valor_centavos - t.pago_centavos AS aberto, c.nome FROM v_titulos t JOIN clientes c ON c.id = t.cliente_id WHERE t.cancelado = 0 AND t.valor_centavos > t.pago_centavos ORDER BY t.vencimento LIMIT 40',
  );
  const variacoes = (n) => [n, n.toUpperCase(), n.replace('Mercadinho', 'Mercadinho').split(' ').slice(0, 2).join(' ') + ' ME', n];
  abertos.slice(0, 7).forEach((t, i) => {
    registrarRecebimento({
      data: addDays(hoje, -between(0, 6)), valor_centavos: i === 5 ? Math.round(t.aberto / 2) : t.aberto, forma: 'pix', pagador_nome: variacoes(t.nome)[i % 4],
      ref_externa: `E18236120${String(20261100 + i)}${String(between(100000, 999999))}${String(between(10000, 99999))}`, origem: 'pix', user_id: 1,
    });
  });
  registrarRecebimento({ data: addDays(hoje, -2), valor_centavos: 183700, forma: 'pix', pagador_nome: 'JOSE ROBERTO ALMEIDA', ref_externa: 'E18236120202611200917xyz81723', origem: 'pix', user_id: 1 });

  // ---- pagamento informado por vendedor (aguardando confirmação) ----
  const alvo = abertos[8];
  if (alvo) {
    const t = db.get('SELECT * FROM titulos WHERE id = ?', alvo.id);
    registrarRecebimento({
      data: hoje, valor_centavos: alvo.aberto, forma: 'pix', pagador_nome: alvo.nome, cliente_id: alvo.cliente_id, vendedor_id: t.vendedor_id,
      titulo_informado_id: alvo.id, status: 'pendente', origem: 'informado', observacoes: 'Cliente mandou o Pix hoje cedo', user_id: 2,
    });
  }

  // ---- depósito: entradas, produção planejada x produzida, saídas e retiradas ----
  for (let m = -3; m <= 0; m++) {
    const ym = ymAdd(ymHoje, m);
    const ultimoDia = ym === ymHoje ? Number(hoje.slice(8, 10)) : Number(monthBounds(ym).fim.slice(8, 10));
    for (const p of produtos) {
      const plan = between(10, 25) * 20;
      const dataPlan = `${ym}-${String(between(1, Math.min(ultimoDia, 10))).padStart(2, '0')}`;
      const ordem = db.run('INSERT INTO ordens_producao (data, produto_id, planejado, criado_por) VALUES (?,?,?,1)', dataPlan, p.id, plan).id;
      const feito = rnd() < 0.8 ? Math.round(plan * (0.7 + rnd() * 0.3)) : m === 0 ? Math.round(plan * 0.4) : 0;
      if (feito > 0) {
        db.run("INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, ordem_producao_id, criado_por) VALUES (?,?,'producao',?,?,1)", `${ym}-${String(Math.min(ultimoDia, between(5, 20))).padStart(2, '0')}`, p.id, feito, ordem);
      }
      if (rnd() < 0.5) db.run("INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, observacoes, criado_por) VALUES (?,?,'entrada',?,'Compra de matéria-prima/embalagem',1)", `${ym}-${String(Math.min(ultimoDia, between(2, 15))).padStart(2, '0')}`, p.id, between(5, 15) * 10);
      db.run("INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, criado_por) VALUES (?,?,'saida',?,1)", `${ym}-${String(Math.min(ultimoDia, between(10, 28))).padStart(2, '0')}`, p.id, -between(6, 16) * 10);
      if (rnd() < 0.3) db.run("INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, observacoes, criado_por) VALUES (?,?,'perda',?,'Embalagem estourada',1)", `${ym}-${String(Math.min(ultimoDia, 20)).padStart(2, '0')}`, p.id, -between(2, 12));
      for (const v of vendedores) {
        if (rnd() < 0.7) {
          const q = between(5, 20) * 2;
          db.run("INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, vendedor_id, valor_unit_centavos, criado_por) VALUES (?,?,'retirada',?,?,?,1)", `${ym}-${String(Math.min(ultimoDia, between(3, 25))).padStart(2, '0')}`, p.id, -q, v.id, p.preco);
          if (rnd() < 0.3) db.run("INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, vendedor_id, valor_unit_centavos, criado_por) VALUES (?,?,'devolucao',?,?,?,1)", `${ym}-${String(Math.min(ultimoDia, 27)).padStart(2, '0')}`, p.id, Math.floor(q / 4), v.id, p.preco);
        }
      }
    }
  }
});

const n = (t) => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
console.log(`Dados de demonstração criados: ${n('vendedores')} vendedores, ${n('clientes')} clientes, ${n('produtos')} produtos, ${n('vendas')} vendas, ${n('titulos')} títulos, ${n('recebimentos')} recebimentos, ${n('estoque_movimentos')} movimentos de depósito.`);
console.log('Login administrador: admin@demo.com / demo12345   |   vendedor: marcos@demo.com / demo12345');
void addMonths;
