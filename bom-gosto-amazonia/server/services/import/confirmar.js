// Grava a importação no banco (tudo ou nada por linha) e permite DESFAZER depois.
import { db, getSetting } from '../../db.js';
import { norm } from '../../../shared/text.js';
import { ClienteIndex, ProdutoIndex, acharVendedor, criarCliente, criarVendedor, criarProduto } from '../entities.js';
import {
  FORMAS_AVISTA, SINAL_ESTOQUE, criarVenda, cancelarVenda, registrarRecebimento, registrarBaixa, alocarRecebimento,
} from '../finance.js';
import { ordemAbertaDoProduto } from '../estoque.js';
import { sugerir } from '../conciliacao.js';
import { hojeEmpresa } from '../metrics.js';
import { aplicarPlanilha } from './planilha-empresa.js';

/**
 * @param imp   linha de `importacoes` (com dados já lidos do JSON)
 * @param dados dados da prévia
 * @param pedido { opcoes, incluir:[_linha...] | null, excluir:[...], mapa_vendedores, mapa_clientes }
 */
export function confirmarImportacao(imp, dados, pedido, user) {
  if (imp.tipo === 'planilha') return aplicarPlanilha(imp, dados, pedido, user); // planilhas da empresa: sincroniza (cria e atualiza)
  const opcoes = pedido.opcoes || {};
  const hoje = hojeEmpresa();
  const registros = dados.registros;
  const tipo = imp.tipo;
  const excluir = new Set((pedido.excluir || []).map(String));
  const incluirEsc = pedido.incluir ? new Set(pedido.incluir.map(String)) : null;
  const chave = (r, i) => String(r._id ?? i);

  const vendedores = db.all('SELECT id, nome, nome_norm, ativo FROM vendedores');
  const cidx = new ClienteIndex();
  const pidx = new ProdutoIndex();
  const mapaV = pedido.mapa_vendedores || {};
  const mapaC = pedido.mapa_clientes || {};
  const aVista = getSetting('vendas_a_vista_pagas', '1') === '1';
  const vendedorPadrao = opcoes.vendedor_padrao_id ? Number(opcoes.vendedor_padrao_id) : null;
  const criarClientes = opcoes.criar_clientes !== false;
  const criarProdutos = opcoes.criar_produtos !== false;
  const criarVendedores = !!opcoes.criar_vendedores;

  const resultado = { criados: { vendas: 0, titulos: 0, recebimentos: 0, clientes: 0, produtos: 0, vendedores: 0, movimentos: 0, baixas_automaticas: 0, canceladas: 0 }, ignoradas: [], erros: [] };
  const novosRecebimentos = [];

  const resolverVendedor = (r) => {
    if (r.vendedor_nome) {
      const k = norm(r.vendedor_nome);
      if (Object.prototype.hasOwnProperty.call(mapaV, k)) {
        const v = mapaV[k];
        if (v === 'novo') return novoVendedor(r.vendedor_nome);
        return v ? Number(v) : null;
      }
      const m = acharVendedor(r.vendedor_nome, vendedores);
      if (m) return m.id;
      if (criarVendedores) return novoVendedor(r.vendedor_nome);
    }
    return null;
  };
  const novoVendedor = (nome) => {
    const k = norm(nome);
    const ex = vendedores.find((v) => v.nome_norm === k);
    if (ex) return ex.id;
    const id = criarVendedor({ nome });
    vendedores.push({ id, nome, nome_norm: k, ativo: 1 });
    resultado.criados.vendedores++;
    return id;
  };

  /** devolve { id, vendedor_id } do cliente (cria se preciso) */
  const resolverCliente = (cli, vendedorId) => {
    if (!cli?.nome) return null;
    const k = norm(cli.nome);
    if (Object.prototype.hasOwnProperty.call(mapaC, k)) {
      const v = mapaC[k];
      if (v && v !== 'novo') {
        const c = db.get('SELECT id, vendedor_id FROM clientes WHERE id = ?', Number(v));
        if (c) return c;
      }
    } else {
      const f = cidx.find(cli);
      if (f && (f.tipo !== 'parecido' || f.score >= 0.93)) return db.get('SELECT id, vendedor_id FROM clientes WHERE id = ?', f.cliente.id);
    }
    if (!criarClientes) return null;
    const id = criarCliente({ ...cli, vendedor_id: vendedorId, importacao_id: imp.id });
    cidx.add({ id, nome: cli.nome, nome_norm: k, documento: cli.documento, ativo: 1 });
    resultado.criados.clientes++;
    return { id, vendedor_id: vendedorId };
  };

  const resolverProduto = (nome, sku, extra = {}) => {
    const p = pidx.find({ nome, sku });
    if (p) return p.id;
    if (!criarProdutos || !nome) return null;
    const id = criarProduto({ nome, sku, unidade: extra.unidade || 'un', preco_centavos: extra.preco_centavos || 0, importacao_id: imp.id });
    pidx.add({ id, nome, nome_norm: norm(nome), sku, unidade: extra.unidade });
    resultado.criados.produtos++;
    return id;
  };

  db.tx(() => {
    registros.forEach((r, i) => {
      const k = chave(r, i);
      const marcado = incluirEsc ? incluirEsc.has(k) : r._incluir !== false;
      if (!marcado || excluir.has(k)) { resultado.ignoradas.push({ linha: r._linha, motivo: r._dup ? 'duplicado' : 'não marcado' }); return; }
      try {
        db.tx(() => processar(r));
      } catch (e) {
        resultado.erros.push({ linha: r._linha, erro: e.message });
      }
    });

    // dá baixa automática nos Pix com certeza alta
    if (tipo === 'pagamentos' && opcoes.conciliar_automatico !== false && novosRecebimentos.length) {
      const lista = db.all(
        `SELECT r.*, r.valor_centavos - r.alocado_centavos AS saldo_centavos FROM v_recebimentos r WHERE r.id IN (${novosRecebimentos.map(() => '?').join(',')}) AND r.status = 'confirmado'`,
        ...novosRecebimentos,
      );
      const sugs = sugerir(lista);
      for (const r of lista) {
        const alta = (sugs.get(r.id) || []).find((s) => s.confianca === 'alta');
        if (!alta) continue;
        try {
          db.tx(() => alocarRecebimento(r.id, alta.titulo_ids.map((id) => ({ titulo_id: id })), user.id));
          resultado.criados.baixas_automaticas++;
        } catch { /* deixa para conciliar manualmente */ }
      }
    }
  });

  function processar(r) {
    if (tipo === 'vendas' && r.tipo_registro === 'cancelamento') {
      const v = db.get('SELECT id, status FROM vendas WHERE chave_nfe = ?', r.chave);
      if (!v) throw new Error('Nota cancelada que não está no sistema (nada a cancelar).');
      if (v.status !== 'cancelada') { cancelarVenda(v.id); resultado.criados.canceladas++; }
      return;
    }
    let vendedorId = resolverVendedor(r);

    if (tipo === 'vendas') {
      const cli = resolverCliente(r.cliente, vendedorId || vendedorPadrao);
      if (!vendedorId && cli?.vendedor_id) vendedorId = cli.vendedor_id;
      if (!vendedorId) vendedorId = vendedorPadrao;
      if (!r.data) throw new Error('Venda sem data.');
      const itens = (r.itens || []).map((i) => ({
        produto_id: resolverProduto(i.descricao, i.codigo, { unidade: i.unidade, preco_centavos: i.preco_centavos }),
        descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, preco_centavos: i.preco_centavos, total_centavos: i.total_centavos,
      })).filter((i) => i.quantidade > 0 && i.descricao);
      const parcelas = (r.parcelas || []).map((p) => ({ vencimento: p.vencimento, valor_centavos: p.valor_centavos, documento: p.documento }));
      let pago = r.pago === true;
      if (r.pago == null && r.pago_centavos == null && !parcelas.length && !r.vencimento) {
        pago = (aVista && FORMAS_AVISTA.includes(r.forma_pagamento)) || !!opcoes.considerar_pagas_sem_info;
      }
      const venc = parcelas.length ? null : r.vencimento || null;
      const res = criarVenda(
        {
          numero: r.numero, data: r.data, cliente_id: cli?.id || null, vendedor_id: vendedorId, itens, total_centavos: r.total_centavos,
          forma_pagamento: r.forma_pagamento || (parcelas.length ? 'prazo' : null), parcelas, validar_parcelas: false, vencimento: venc,
          pago, pago_centavos: r.pago_centavos, data_pagamento: r.data_pagamento, observacoes: r.observacoes ? String(r.observacoes).slice(0, 500) : null,
          origem: imp.formato, chave_nfe: r.chave_nfe, importacao_id: imp.id, baixar_estoque: !!opcoes.baixar_estoque,
        },
        { user_id: user.id },
      );
      resultado.criados.vendas++;
      resultado.criados.titulos += res.titulos.length;
      if (res.recebimento_id) resultado.criados.recebimentos++;
      return;
    }

    if (tipo === 'devedores') {
      const cli = resolverCliente(r.cliente, vendedorId || vendedorPadrao);
      if (!cli) throw new Error('Cliente não encontrado e criação automática desligada.');
      if (!vendedorId) vendedorId = cli.vendedor_id || vendedorPadrao;
      const tid = db.run(
        `INSERT INTO titulos (cliente_id, vendedor_id, documento, emissao, vencimento, valor_centavos, origem, observacoes, importacao_id, criado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        cli.id, vendedorId, r.documento, r.emissao, r.vencimento || hoje, r.valor_centavos, imp.formato, r.observacoes ? String(r.observacoes).slice(0, 300) : null, imp.id, user.id,
      ).id;
      resultado.criados.titulos++;
      if (r.pago_centavos > 0) {
        const rid = registrarRecebimento({
          data: r.data_pagamento || hoje, valor_centavos: r.pago_centavos, forma: 'outro', pagador_nome: r.cliente.nome, cliente_id: cli.id, vendedor_id: vendedorId,
          origem: 'baixa', importacao_id: imp.id, user_id: user.id, observacoes: 'Baixa vinda da planilha',
        });
        registrarBaixa({ titulo_id: tid, recebimento_id: rid, valor_centavos: Math.min(r.pago_centavos, r.valor_centavos), data: r.data_pagamento || hoje, user_id: user.id });
        resultado.criados.recebimentos++;
      }
      return;
    }

    if (tipo === 'pagamentos') {
      if (!r.data) throw new Error('Pagamento sem data.');
      let clienteId = null;
      if (r.pagador_nome || r.pagador_documento) {
        const f = cidx.find({ nome: r.pagador_nome, documento: r.pagador_documento });
        if (f && (f.tipo !== 'parecido' || f.score >= 0.9)) clienteId = f.cliente.id;
      }
      const rid = registrarRecebimento({
        data: r.data, valor_centavos: r.valor_centavos, forma: r.forma || 'pix', pagador_nome: r.pagador_nome, pagador_documento: r.pagador_documento,
        banco: r.banco, ref_externa: r.ref_externa, cliente_id: clienteId, arquivo_id: r._arquivo_id || null, origem: imp.formato, importacao_id: imp.id,
        user_id: user.id, observacoes: r.observacoes ? String(r.observacoes).slice(0, 300) : null,
      });
      novosRecebimentos.push(rid);
      resultado.criados.recebimentos++;
      return;
    }

    if (tipo === 'estoque') {
      const pid = resolverProduto(r.produto_nome, r.sku, { preco_centavos: r.valor_unit_centavos });
      if (!pid) throw new Error(`Produto "${r.produto_nome}" não cadastrado.`);
      if (!vendedorId) vendedorId = vendedorPadrao;
      if (r.tipo === 'retirada' && !vendedorId) throw new Error('Retirada sem vendedor.');
      const sinal = r.tipo === 'ajuste' ? (r.quantidade < 0 ? -1 : 1) : SINAL_ESTOQUE[r.tipo];
      const prod = db.get('SELECT preco_centavos FROM produtos WHERE id = ?', pid);
      db.run(
        `INSERT INTO estoque_movimentos (data, produto_id, tipo, quantidade, vendedor_id, valor_unit_centavos, ordem_producao_id, observacoes, importacao_id, criado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        r.data, pid, r.tipo, sinal * Math.abs(r.quantidade), vendedorId, r.valor_unit_centavos || prod?.preco_centavos || 0,
        r.tipo === 'producao' ? ordemAbertaDoProduto(pid, r.data) : null, r.observacoes ? String(r.observacoes).slice(0, 300) : null, imp.id, user.id,
      );
      resultado.criados.movimentos++;
      return;
    }

    if (tipo === 'clientes') {
      const f = cidx.find({ nome: r.nome, documento: r.documento });
      if (f && f.tipo !== 'parecido') {
        db.run(
          `UPDATE clientes SET documento = COALESCE(documento, ?), telefone = COALESCE(telefone, ?), email = COALESCE(email, ?), endereco = COALESCE(endereco, ?),
             cidade = COALESCE(cidade, ?), vendedor_id = COALESCE(vendedor_id, ?) WHERE id = ?`,
          r.documento ? String(r.documento).replace(/\D+/g, '') : null, r.telefone, r.email, r.endereco, r.cidade, vendedorId, f.cliente.id,
        );
        return;
      }
      const id = criarCliente({ ...r, vendedor_id: vendedorId || vendedorPadrao, importacao_id: imp.id });
      cidx.add({ id, nome: r.nome, nome_norm: norm(r.nome), documento: r.documento, ativo: 1 });
      resultado.criados.clientes++;
      return;
    }

    if (tipo === 'produtos') {
      if (pidx.find({ nome: r.nome, sku: r.sku })) return;
      const id = criarProduto({ ...r, importacao_id: imp.id });
      pidx.add({ id, nome: r.nome, nome_norm: norm(r.nome), sku: r.sku });
      resultado.criados.produtos++;
    }
  }

  return resultado;
}

/** Remove tudo que a importação criou. */
export function desfazerImportacao(id) {
  return db.tx(() => {
    const cont = {};
    const del = (nome, sql, ...p) => { cont[nome] = db.run(sql, ...p).changes; };
    del('movimentos', 'DELETE FROM estoque_movimentos WHERE importacao_id = ?', id);
    del('baixas', 'DELETE FROM baixas WHERE recebimento_id IN (SELECT id FROM recebimentos WHERE importacao_id = ?) OR titulo_id IN (SELECT id FROM titulos WHERE importacao_id = ?)', id, id);
    del('recebimentos', 'DELETE FROM recebimentos WHERE importacao_id = ?', id);
    del('titulos', 'DELETE FROM titulos WHERE importacao_id = ?', id);
    // dívidas que vieram de OUTRA importação (ex.: lista de devedores) e foram ligadas a vendas desta: ficam, só desligadas da venda
    db.run('UPDATE titulos SET venda_id = NULL WHERE venda_id IN (SELECT id FROM vendas WHERE importacao_id = ?)', id);
    del('vendas', 'DELETE FROM vendas WHERE importacao_id = ?', id);
    del('clientes', `DELETE FROM clientes WHERE importacao_id = ?
       AND NOT EXISTS (SELECT 1 FROM vendas v WHERE v.cliente_id = clientes.id) AND NOT EXISTS (SELECT 1 FROM titulos t WHERE t.cliente_id = clientes.id)
       AND NOT EXISTS (SELECT 1 FROM recebimentos r WHERE r.cliente_id = clientes.id)`, id);
    del('produtos', `DELETE FROM produtos WHERE importacao_id = ?
       AND NOT EXISTS (SELECT 1 FROM venda_itens i WHERE i.produto_id = produtos.id) AND NOT EXISTS (SELECT 1 FROM estoque_movimentos m WHERE m.produto_id = produtos.id)
       AND NOT EXISTS (SELECT 1 FROM ordens_producao o WHERE o.produto_id = produtos.id)`, id);
    return cont;
  });
}

