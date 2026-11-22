// Transforma o que foi lido dos arquivos em uma PRÉVIA: registros padronizados + avisos + duplicados.
import { db, getSettings } from '../../db.js';
import { norm, nameScore, digits } from '../../../shared/text.js';
import { fmtBRL } from '../../../shared/money.js';
import { fmtBR } from '../../../shared/dates.js';
import { acharVendedor, ClienteIndex, ProdutoIndex } from '../entities.js';
import { prepararTabela, converterTabela } from './tabela.js';
import { limparHistorico } from './ofx.js';

export const TIPOS = ['vendas', 'devedores', 'pagamentos', 'estoque', 'clientes', 'produtos'];
export const TIPOS_ROTULO = {
  vendas: 'Vendas', devedores: 'Devedores / contas a receber', pagamentos: 'Pagamentos recebidos (Pix etc.)', estoque: 'Movimentação do depósito',
  clientes: 'Cadastro de clientes', produtos: 'Cadastro de produtos', desconhecido: 'Não identificado',
};
const LIMITE_LINHAS_GUARDADAS = 8000;

// ---------------------------------------------------------------- registros por tipo de documento
export function registrosDeNFe(nfe, extras = {}) {
  return {
    ...extras,
    chave_nfe: nfe.chave || null,
    numero: nfe.numero || null,
    data: nfe.data || null,
    cliente: nfe.cliente?.nome && nfe.cliente.nome !== 'Consumidor final' ? nfe.cliente : nfe.cliente?.documento ? nfe.cliente : null,
    vendedor_nome: nfe.vendedor_nome || null,
    itens: nfe.itens,
    total_centavos: nfe.total_centavos,
    forma_pagamento: nfe.forma_pagamento,
    parcelas: nfe.parcelas || [],
    pago: null,
    observacoes: nfe.observacoes,
    natureza: nfe.natureza,
    emitente: nfe.emitente,
    _avisos: [...(nfe.avisos || [])],
    _nao_incluir: (nfe.avisos || []).some((a) => /devolu|n[aã]o autorizada/i.test(a)),
  };
}

export function registrosDePix(recibos, empresa, extras = {}) {
  return recibos.map((r) => {
    const av = [];
    const pagador = r.pagador?.nome || null;
    const eEmpresa = (nome, doc) => (empresa.cnpj && digits(doc) === digits(empresa.cnpj)) || (empresa.nome && nome && nameScore(nome, empresa.nome) >= 0.8);
    let naoIncluir = false;
    if (pagador && eEmpresa(pagador, r.pagador?.documento)) {
      av.push('Parece um Pix ENVIADO pela empresa (saída), não um recebimento.');
      naoIncluir = true;
    }
    if (!pagador) av.push('Não achei o nome de quem pagou — preencha para conciliar.');
    if (!r.data) av.push('Sem data no comprovante.');
    return {
      _linha: r.pagina,
      data: r.data,
      valor_centavos: r.valor_centavos,
      forma: 'pix',
      pagador_nome: pagador,
      pagador_documento: r.pagador?.documento || null,
      banco: r.pagador?.banco || null,
      ref_externa: r.e2e || null,
      observacoes: r.favorecido?.nome ? `Pix para ${r.favorecido.nome}` : null,
      _avisos: av,
      _nao_incluir: naoIncluir,
      ...extras,
    };
  });
}

export function registrosDeOFX(ofx) {
  const out = [];
  for (const t of ofx.transacoes) {
    if (t.valor_centavos <= 0) continue; // só entradas
    const hist = t.historico || '';
    out.push({
      _linha: out.length + 1,
      data: t.data,
      valor_centavos: t.valor_centavos,
      forma: /pix/i.test(hist) ? 'pix' : /ted|doc|transf/i.test(hist) ? 'transferencia' : 'outro',
      pagador_nome: limparHistorico(hist) || null,
      pagador_documento: null,
      banco: ofx.banco,
      ref_externa: t.fitid ? `ofx:${ofx.banco || 'banco'}:${t.fitid}` : null,
      observacoes: hist,
      _avisos: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------- anotação (reconhece vendedor/cliente/produto e duplicados)
export function anotar(tipo, registros) {
  const vendedores = db.all('SELECT id, nome, nome_norm, ativo FROM vendedores');
  const cidx = new ClienteIndex();
  const pidx = new ProdutoIndex();
  const vendNomes = new Map();
  const cliParecidos = new Map();
  const novosClientes = new Set();
  const novosProdutos = new Set();

  for (const r of registros) {
    if (!r._avisos_base) r._avisos_base = r._avisos || [];
    r._avisos = [...r._avisos_base];
    r._incluir = r._incluir_forcado !== undefined ? r._incluir_forcado : !r._nao_incluir;
    delete r._dup;

    if (r.vendedor_nome) {
      const m = acharVendedor(r.vendedor_nome, vendedores);
      r._vendedor = m ? { id: m.id, nome: m.nome, tipo: m.tipo } : null;
      const k = norm(r.vendedor_nome);
      const e = vendNomes.get(k) || { nome: r.vendedor_nome, qtd: 0, sugestao: r._vendedor };
      e.qtd++;
      vendNomes.set(k, e);
    } else r._vendedor = null;

    const cli = tipo === 'clientes' ? { nome: r.nome, documento: r.documento } : r.cliente;
    r._cliente = null;
    if (cli?.nome) {
      const f = cidx.find(cli);
      if (f) {
        r._cliente = { id: f.cliente.id, nome: f.cliente.nome, tipo: f.tipo, score: Math.round(f.score * 100) / 100, auto: f.tipo !== 'parecido' || f.score >= 0.93 };
        if (f.tipo === 'parecido') {
          const k = norm(cli.nome);
          if (!cliParecidos.has(k)) cliParecidos.set(k, { nome: cli.nome, id: f.cliente.id, nome_cadastrado: f.cliente.nome, score: r._cliente.score, auto: r._cliente.auto });
        }
      } else novosClientes.add(norm(cli.nome));
    }

    // duplicados
    let dup = null;
    if (tipo === 'vendas' && r.chave_nfe) {
      dup = db.get('SELECT id FROM vendas WHERE chave_nfe = ?', r.chave_nfe);
      if (dup) dup.motivo = 'Esta nota fiscal já foi importada.';
    } else if (tipo === 'vendas' && r.data) {
      if (r.numero) dup = db.get("SELECT id FROM vendas WHERE numero = ? AND data = ? AND total_centavos = ? AND status = 'ativa'", r.numero, r.data, r.total_centavos);
      else if (r._cliente) dup = db.get("SELECT id FROM vendas WHERE cliente_id = ? AND data = ? AND total_centavos = ? AND status = 'ativa'", r._cliente.id, r.data, r.total_centavos);
      if (dup) dup.motivo = 'Já existe uma venda igual (mesmo dia, cliente e valor).';
    } else if (tipo === 'devedores' && r._cliente) {
      dup = db.get("SELECT id FROM titulos WHERE cliente_id = ? AND vencimento = ? AND valor_centavos = ? AND cancelado = 0 AND IFNULL(documento,'') = IFNULL(?, '')", r._cliente.id, r.vencimento, r.valor_centavos, r.documento);
      if (dup) dup.motivo = 'Já existe uma dívida igual deste cliente (mesmo vencimento e valor).';
    } else if (tipo === 'pagamentos') {
      if (r.ref_externa) dup = db.get('SELECT id FROM recebimentos WHERE ref_externa = ?', r.ref_externa);
      if (!dup && r.data) dup = db.get("SELECT id FROM recebimentos WHERE data = ? AND valor_centavos = ? AND IFNULL(pagador_norm,'') = ? AND status <> 'cancelado'", r.data, r.valor_centavos, norm(r.pagador_nome));
      if (dup) dup.motivo = 'Este pagamento já está registrado.';
    } else if (tipo === 'estoque') {
      const p = pidx.find({ nome: r.produto_nome, sku: r.sku });
      r._produto = p ? { id: p.id, nome: p.nome } : null;
      if (!p) novosProdutos.add(norm(r.produto_nome));
      if (p) {
        dup = db.get('SELECT id FROM estoque_movimentos WHERE data = ? AND produto_id = ? AND tipo = ? AND ABS(quantidade) = ?', r.data, p.id, r.tipo, Math.abs(r.quantidade));
        if (dup) dup.motivo = 'Já existe uma movimentação igual neste dia.';
      }
      if (r.tipo === 'retirada' && !r.vendedor_nome) r._avisos.push('Retirada sem vendedor — escolha um vendedor padrão ao confirmar.');
    } else if (tipo === 'clientes' && r._cliente) {
      dup = { id: r._cliente.id, motivo: `Já cadastrado como "${r._cliente.nome}".` };
    } else if (tipo === 'produtos') {
      const p = pidx.find({ nome: r.nome, sku: r.sku });
      if (p) dup = { id: p.id, motivo: `Já cadastrado como "${p.nome}".` };
    }
    if (tipo === 'vendas' && Array.isArray(r.itens)) {
      for (const i of r.itens) {
        const p = pidx.find({ nome: i.descricao, sku: i.codigo });
        if (!p && i.descricao) novosProdutos.add(norm(i.descricao));
      }
    }
    if (dup) {
      r._dup = dup;
      if (r._incluir_forcado === undefined) r._incluir = false;
      r._avisos.push(dup.motivo);
    }
    if (r._cliente && !r._cliente.auto) r._avisos.push(`Cliente parecido com "${r._cliente.nome}" (${Math.round(r._cliente.score * 100)}%): será criado como novo, a menos que você escolha juntar.`);
  }

  const resumo = {
    total: registros.length,
    incluidos: registros.filter((r) => r._incluir).length,
    duplicados: registros.filter((r) => r._dup).length,
    com_aviso: registros.filter((r) => r._avisos.length).length,
    clientes_novos: novosClientes.size,
    produtos_novos: novosProdutos.size,
    vendedores: [...vendNomes.values()],
    clientes_parecidos: [...cliParecidos.values()].filter((c) => !c.auto),
    sem_vendedor: registros.filter((r) => !r._vendedor && !r._cliente?.id).length,
  };
  const valorDe = (r) => r.total_centavos ?? r.valor_centavos ?? 0;
  if (['vendas', 'devedores', 'pagamentos'].includes(tipo)) resumo.valor_total_centavos = registros.filter((r) => r._incluir).reduce((s, r) => s + valorDe(r), 0);
  return resumo;
}

// ---------------------------------------------------------------- montar a prévia de um documento
export function previaDeTabela(doc, ctx) {
  const vendedorAba = doc.aba ? acharVendedor(doc.aba)?.nome || null : null;
  const t = prepararTabela(doc.matriz, { nomeAba: doc.aba || '', hoje: ctx.hoje });
  const temVendedorCol = Object.values(t.mapeamento).includes('vendedor');
  const tipo = t.tipo;
  const opc = { hoje: ctx.hoje, vendedor_aba: temVendedorCol ? null : vendedorAba, vencimento_padrao: ctx.opcoes?.vencimento_padrao, data_padrao: ctx.opcoes?.data_padrao };
  const conv = tipo !== 'desconhecido' ? converterTabela(t, tipo, t.mapeamento, opc) : { registros: [], avisos: ['Não consegui identificar o tipo de dado desta tabela. Escolha o tipo e confira as colunas.'] };
  return {
    tipo,
    dados: {
      tabela: { cabecalho: t.cabecalho, linhas: t.linhas.slice(0, LIMITE_LINHAS_GUARDADAS), linha_inicial: t.linha_inicial, truncada: t.linhas.length > LIMITE_LINHAS_GUARDADAS },
      mapeamento: t.mapeamento,
      vendedor_aba: opc.vendedor_aba,
      registros: conv.registros,
      avisos: conv.avisos.slice(0, 200),
    },
  };
}

export function reprocessarTabela(dados, { tipo, mapeamento, opcoes = {} }, ctx) {
  const tabela = dados.tabela;
  const opc = { hoje: ctx.hoje, vendedor_aba: dados.vendedor_aba, vencimento_padrao: opcoes.vencimento_padrao, data_padrao: opcoes.data_padrao };
  const conv = converterTabela(tabela, tipo, mapeamento, opc);
  return { ...dados, mapeamento, registros: conv.registros, avisos: conv.avisos.slice(0, 200), opcoes_prev: opcoes };
}

export function empresaAtual() {
  const s = getSettings();
  return { nome: s.empresa_nome || '', cnpj: s.empresa_cnpj || '' };
}

export const rotuloRegistro = (tipo, r) => {
  if (tipo === 'vendas') return `${fmtBR(r.data)} · ${r.cliente?.nome || 'sem cliente'} · ${fmtBRL(r.total_centavos)}`;
  if (tipo === 'devedores') return `${r.cliente?.nome} · venc. ${fmtBR(r.vencimento)} · ${fmtBRL(r.valor_centavos)}`;
  if (tipo === 'pagamentos') return `${fmtBR(r.data)} · ${r.pagador_nome || 'pagador?'} · ${fmtBRL(r.valor_centavos)}`;
  return '';
};
