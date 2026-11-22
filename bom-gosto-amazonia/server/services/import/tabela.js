// Planilhas e tabelas (XLSX, CSV, PDF em tabela): descobre o cabeçalho, o tipo de dado e converte as linhas.
import { norm } from '../../../shared/text.js';
import { parseMoney } from '../../../shared/money.js';
import { parseDate } from '../../../shared/dates.js';
import { limparHistorico } from './ofx.js';

// ------------------------------------------------------------------ cabeçalhos
const SIN = {
  data: ['data', 'data venda', 'data da venda', 'dt venda', 'dt', 'data emissao', 'data de emissao', 'emissao', 'data pedido', 'data do pedido', 'data compra', 'data da compra', 'data lancamento', 'data movimento', 'data do movimento', 'data mov', 'dia', 'data da operacao'],
  vencimento: ['vencimento', 'venc', 'data vencimento', 'data de vencimento', 'dt venc', 'dt vencimento', 'vence', 'vcto', 'vencto', 'data venc', 'vence em', 'data limite'],
  data_pagamento: ['data pagamento', 'data de pagamento', 'dt pagamento', 'data pgto', 'dt pgto', 'pago em', 'data baixa', 'data da baixa', 'baixa em', 'data recebimento', 'data de recebimento', 'recebido em', 'dt baixa'],
  cliente: ['cliente', 'nome cliente', 'nome do cliente', 'razao social', 'nome', 'devedor', 'comprador', 'estabelecimento', 'loja', 'ponto de venda', 'mercado', 'favorecido', 'nome fantasia', 'sacado', 'mercadinho'],
  vendedor: ['vendedor', 'vendedora', 'representante', 'rep', 'responsavel', 'vend', 'consultor', 'nome vendedor', 'vendedor responsavel'],
  documento: ['documento', 'doc', 'nf', 'nota', 'nota fiscal', 'nf e', 'nfe', 'numero', 'n', 'num', 'n doc', 'numero nota', 'numero pedido', 'n pedido', 'pedido', 'duplicata', 'titulo', 'nosso numero', 'numero documento', 'n documento', 'cupom', 'comanda'],
  cpf_cnpj: ['cpf', 'cnpj', 'cpf cnpj', 'cnpj cpf', 'documento fiscal', 'inscricao'],
  telefone: ['telefone', 'tel', 'celular', 'whatsapp', 'whats', 'fone', 'contato', 'telefone contato', 'tel contato'],
  email: ['email', 'e mail'],
  endereco: ['endereco', 'logradouro', 'rua', 'end'],
  cidade: ['cidade', 'municipio', 'bairro', 'localidade'],
  valor: ['valor', 'valor total', 'total', 'vlr', 'vlr total', 'valor da venda', 'valor venda', 'valor devido', 'debito divida', 'valor a receber', 'a receber', 'valor titulo', 'valor do titulo', 'valor original', 'valor bruto', 'total venda', 'total da venda', 'montante', 'valor liquido', 'valor nota', 'valor da nota', 'valor da compra', 'compra', 'valor do pix', 'valor pix', 'valor transferencia'],
  valor_pago: ['valor pago', 'vlr pago', 'recebido', 'valor recebido', 'abatimento', 'total pago', 'pagamento realizado', 'vlr recebido', 'ja pago'],
  saldo: ['saldo', 'saldo devedor', 'em aberto', 'valor em aberto', 'saldo em aberto', 'restante', 'falta pagar', 'resta', 'saldo a pagar', 'a pagar', 'pendente', 'valor pendente'],
  pago_ou_status: ['pago', 'pg', 'paga', 'pix', 'pix enviado', 'baixa', 'baixado', 'deu baixa', 'quitado', 'quitacao', 'pagamento', 'pagou'],
  status: ['status', 'situacao', 'situacao pagamento', 'status pagamento', 'condicao pagamento status'],
  produto: ['produto', 'descricao', 'descricao do produto', 'item', 'mercadoria', 'produto servico', 'nome produto', 'descricao produto', 'artigo', 'sabor'],
  sku: ['sku', 'codigo produto', 'cod produto', 'ref', 'referencia', 'codigo de barras', 'ean', 'codigo', 'cod'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'quant', 'qte', 'unidades', 'qtd vendida', 'qtd total', 'volume', 'caixas', 'cx'],
  unidade: ['unidade', 'un', 'und', 'um', 'unid', 'medida', 'unidade de medida'],
  preco: ['preco', 'preco unitario', 'valor unitario', 'vlr unit', 'unitario', 'preco un', 'pr unit', 'vl unit', 'valor unit', 'preco venda', 'preco de venda', 'p unit', 'vl unitario', 'valor un'],
  forma_pagamento: ['forma de pagamento', 'forma pagamento', 'pgto', 'forma', 'tipo pagamento', 'tipo de pagamento', 'meio de pagamento', 'condicao', 'condicao pagamento', 'condicao de pagamento', 'meio pagamento', 'modalidade'],
  tipo: ['tipo', 'tipo movimentacao', 'tipo de movimentacao', 'movimentacao', 'operacao', 'natureza', 'tipo mov', 'mov', 'tipo operacao'],
  entrada: ['entrada', 'entradas', 'qtd entrada', 'entrou'],
  saida: ['saida', 'saidas', 'qtd saida', 'saiu'],
  producao: ['producao', 'produzido', 'qtd produzida', 'produzidos', 'fabricado', 'fabricacao', 'produziu'],
  retirada: ['retirada', 'retiradas', 'retirou', 'qtd retirada', 'retirado'],
  perda: ['perda', 'perdas', 'avaria', 'avarias', 'quebra', 'vencidos'],
  devolucao: ['devolucao', 'devolucoes', 'devolvido', 'retorno'],
  credito: ['credito', 'creditos', 'valor credito', 'entrada de valor'],
  debito: ['debito', 'debitos', 'valor debito', 'saida de valor'],
  pagador: ['pagador', 'remetente', 'origem', 'de', 'nome pagador', 'quem pagou', 'depositante', 'nome do pagador', 'pagante'],
  ref_externa: ['id transacao', 'id da transacao', 'e2e', 'endtoendid', 'end to end', 'codigo transacao', 'autenticacao', 'protocolo', 'codigo da transacao', 'id pix', 'fitid', 'comprovante', 'identificador'],
  banco: ['banco', 'instituicao', 'instituicao financeira'],
  historico: ['historico', 'descricao lancamento', 'lancamento', 'detalhes', 'memo', 'descricao da operacao', 'descricao do lancamento'],
  obs: ['observacao', 'observacoes', 'obs', 'anotacoes', 'comentario', 'comentarios'],
  categoria: ['categoria', 'grupo', 'familia', 'linha produto'],
  custo: ['custo', 'preco custo', 'custo unitario', 'valor custo', 'preco de custo'],
  estoque_minimo: ['estoque minimo', 'minimo', 'est min', 'estoque min'],
  ignorar: ['id', 'codigo cliente', 'cod cliente', 'item', 'seq', 'sequencia', 'linha', 'n item', 'cod vendedor', 'codigo vendedor', 'numero item'],
};

export const PAPEIS_ROTULO = {
  data: 'Data', vencimento: 'Vencimento', data_pagamento: 'Data do pagamento', cliente: 'Cliente', vendedor: 'Vendedor', documento: 'Nº documento/nota',
  cpf_cnpj: 'CPF/CNPJ', telefone: 'Telefone', email: 'E-mail', endereco: 'Endereço', cidade: 'Cidade', valor: 'Valor', valor_pago: 'Valor pago',
  saldo: 'Saldo em aberto', pago_ou_status: 'Pago? / Baixa / Pix', status: 'Situação', produto: 'Produto/descrição', sku: 'Código do produto', quantidade: 'Quantidade',
  unidade: 'Unidade', preco: 'Preço unitário', forma_pagamento: 'Forma de pagamento', tipo: 'Tipo de movimentação', entrada: 'Qtd. entrada', saida: 'Qtd. saída',
  producao: 'Qtd. produzida', retirada: 'Qtd. retirada', perda: 'Qtd. perda', devolucao: 'Qtd. devolução', credito: 'Crédito', debito: 'Débito', pagador: 'Pagador',
  ref_externa: 'Código da transação', banco: 'Banco', historico: 'Histórico', obs: 'Observação', categoria: 'Categoria', custo: 'Custo', estoque_minimo: 'Estoque mínimo', ignorar: '(ignorar)',
};

const INDICE = [];
for (const [papel, lista] of Object.entries(SIN)) for (const s of lista) INDICE.push([papel, s]);

export function papelDoCabecalho(h) {
  const n = norm(h);
  if (!n || n.length > 60) return null;
  let melhor = null;
  let melhorScore = 0;
  for (const [papel, s] of INDICE) {
    let score = 0;
    if (n === s) score = 1000 + s.length;
    else if (s.length >= 3 && ` ${n} `.includes(` ${s} `)) score = s.length;
    if (score > melhorScore) { melhorScore = score; melhor = papel; }
  }
  return melhor ? { papel: melhor, score: melhorScore } : null;
}

/** { "0": "cliente", "3": "valor" } — cada papel só uma vez (exceto observação/ignorar). */
export function mapearColunas(cabecalho) {
  const cand = cabecalho.map((h, i) => ({ i, r: papelDoCabecalho(h) })).filter((x) => x.r);
  const porPapel = new Map();
  for (const c of cand) {
    const atual = porPapel.get(c.r.papel);
    if (!atual || c.r.score > atual.r.score) porPapel.set(c.r.papel, c);
  }
  const out = {};
  for (const c of cand) {
    if (c.r.papel === 'obs' || c.r.papel === 'ignorar' || porPapel.get(c.r.papel) === c) out[c.i] = c.r.papel;
  }
  return out;
}

/** Procura a linha de cabeçalho entre as primeiras linhas. */
export function acharCabecalho(linhas) {
  let melhor = { idx: -1, n: 0 };
  const limite = Math.min(linhas.length - 1, 25);
  for (let i = 0; i < limite; i++) {
    const cels = linhas[i].map((c) => String(c ?? '').trim());
    const naoVazias = cels.filter(Boolean).length;
    if (naoVazias < 2) continue;
    const n = Object.values(mapearColunas(cels)).filter((p) => p !== 'ignorar').length;
    if (n >= 2 && n / naoVazias >= 0.4 && n > melhor.n) melhor = { idx: i, n };
  }
  return melhor.idx;
}

// ------------------------------------------------------------------ tipo de dado
const WIDE = ['entrada', 'saida', 'producao', 'retirada', 'perda', 'devolucao'];

export function pontuarTipos(papeis, nomeAba = '') {
  const has = (r) => papeis.has(r);
  const s = { vendas: 0, devedores: 0, pagamentos: 0, estoque: 0, clientes: 0, produtos: 0 };
  const temValor = has('valor') || has('saldo');
  if (has('vencimento') && temValor && has('cliente')) s.devedores += 6;
  if (has('saldo')) s.devedores += 2;
  if (has('valor_pago') || has('pago_ou_status') || has('status')) s.devedores += 1;
  if (temValor && has('cliente') && has('data')) s.vendas += 3;
  if (has('produto') && has('quantidade') && has('cliente')) s.vendas += 4;
  if (has('vendedor')) { s.vendas += 1; s.devedores += 0.5; }
  if (has('pagador') || has('ref_externa') || has('historico') || has('credito')) s.pagamentos += 4;
  if (has('valor') && has('data') && !has('cliente') && !has('vencimento') && !has('produto')) s.pagamentos += 3;
  const wide = WIDE.some(has);
  if (has('produto') && has('quantidade') && !has('cliente') && (has('tipo') || wide)) s.estoque += 6;
  if (wide && has('produto')) s.estoque += 3;
  if (has('produto') && has('preco') && !has('cliente') && !has('quantidade')) s.produtos += 5;
  if (has('sku') && has('produto') && !has('cliente')) s.produtos += 1;
  if (has('cliente') && (has('cpf_cnpj') || has('telefone') || has('endereco') || has('cidade')) && !temValor) s.clientes += 5;
  const n = norm(nomeAba);
  if (/devedor|receber|fiado|inadimpl|cobranc|pendenc|divida/.test(n)) s.devedores += 4;
  if (/venda|pedido|faturamento|nota/.test(n)) s.vendas += 3;
  if (/pix|pagamento|recebimento|extrato|banco/.test(n)) s.pagamentos += 3;
  if (/estoque|deposito|producao|movimenta|retirada/.test(n)) s.estoque += 4;
  if (/cliente/.test(n)) s.clientes += 3;
  if (/produto/.test(n)) s.produtos += 3;
  return s;
}

export function detectarTipo(papeis, nomeAba) {
  const s = pontuarTipos(new Set(papeis), nomeAba);
  const [tipo, pts] = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
  return pts >= 4 ? tipo : 'desconhecido';
}

// ------------------------------------------------------------------ valores
const SIM = new Set(['sim', 's', 'x', 'ok', 'pago', 'paga', 'quitado', 'quitada', 'recebido', 'recebida', 'baixado', 'baixada', 'liquidado', 'liquidada', 'pg', 'pgo', 'yes', 'y', '1', 'true', 'verdadeiro', 'confirmado', 'pix', 'recebeu', 'pagou', 'enviou', 'enviado']);
const NAO = new Set(['nao', 'n', 'aberto', 'aberta', 'pendente', 'devendo', 'em aberto', 'a receber', 'fiado', '0', 'false', 'falso', 'nao pago', 'n pago', 'nao pagou', 'nao enviou', 'a pagar', 'atrasado', 'vencido', 'deve']);

/** true = pago, false = em aberto, null = não deu para saber. Data no lugar de "sim" significa pago naquele dia. */
export function statusPago(v) {
  if (v === null || v === undefined || v === '') return { pago: null };
  if (typeof v === 'number') return { pago: null };
  const t = norm(v);
  if (!t) return { pago: null };
  if (SIM.has(t)) return { pago: true };
  if (NAO.has(t)) return { pago: false };
  const d = parseDate(String(v));
  if (d) return { pago: true, data: d };
  if (/^(pago|paga|quitad|receb|baixad)/.test(t)) return { pago: true };
  if (/^(nao|n[aã]o|aberto|pend|dev)/.test(t)) return { pago: false };
  return { pago: null };
}

function resolverAmbiguo(valores) {
  const v = valores.filter((x) => x !== null && x !== undefined && String(x).trim() !== '');
  if (!v.length) return 'status';
  const frac = (fn) => v.filter(fn).length / v.length;
  if (frac((x) => typeof x === 'string' && (statusPago(x).pago !== null))) {
    if (frac((x) => typeof x === 'string' && statusPago(x).pago !== null) >= 0.5) return 'status';
  }
  if (frac((x) => typeof x === 'number' || (typeof x === 'string' && !parseDate(x) && /\d/.test(x) && parseMoney(x) !== null)) >= 0.6) return 'valor_pago';
  return 'status';
}

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const semTraco = (s) => (/^[-–—.\s]*$/.test(s) ? '' : s);

function formaDe(s) {
  const t = norm(s);
  if (!t) return null;
  if (/pix/.test(t)) return 'pix';
  if (/dinheiro|especie|cash/.test(t)) return 'dinheiro';
  if (/cart|credito|debito|visa|master|elo/.test(t)) return 'cartao';
  if (/boleto/.test(t)) return 'boleto';
  if (/transf|ted|doc/.test(t)) return 'transferencia';
  if (/cheque/.test(t)) return 'cheque';
  if (/prazo|fiado|duplicata|crediario|30 dias|a receber/.test(t)) return 'prazo';
  return null;
}

const TIPOS_TEXTO = [
  [/produ[cç]|fabric|produz/, 'producao'],
  [/retir/, 'retirada'],
  [/devol|retorno/, 'devolucao'],
  [/perd|avaria|quebra|vencid|descart/, 'perda'],
  [/ajust|invent|acerto/, 'ajuste'],
  [/entrad|compra|receb|repos|chegou/, 'entrada'],
  [/venda|vendid/, 'venda'],
  [/sa[ií]d|baixa|sai/, 'saida'],
];
function tipoEstoqueDe(s) {
  const t = norm(s);
  for (const [re, tipo] of TIPOS_TEXTO) if (re.test(t)) return tipo;
  return null;
}

// ------------------------------------------------------------------ conversão em registros
/**
 * @param tabela { cabecalho: string[], linhas: any[][] }
 * @param tipo   'vendas'|'devedores'|'pagamentos'|'estoque'|'clientes'|'produtos'
 * @param mapeamento { "0": "cliente", ... }
 * @param opc { hoje, vencimento_padrao, data_padrao, vendedor_aba }
 */
export function converterTabela(tabela, tipo, mapeamento, opc = {}) {
  const hoje = opc.hoje;
  const colunaDe = {};
  for (const [i, papel] of Object.entries(mapeamento)) {
    if (papel && papel !== 'ignorar' && colunaDe[papel] === undefined) colunaDe[papel] = Number(i);
  }
  // "Pago/Pix/Baixa": decide pelo conteúdo se é valor ou situação
  if (colunaDe.pago_ou_status !== undefined) {
    const col = colunaDe.pago_ou_status;
    const papel = resolverAmbiguo(tabela.linhas.slice(0, 400).map((l) => l[col]));
    if (colunaDe[papel] === undefined) colunaDe[papel] = col;
    else if (papel === 'valor_pago' && colunaDe.status === undefined) colunaDe.status = col;
    delete colunaDe.pago_ou_status;
  }
  const get = (linha, papel) => (colunaDe[papel] === undefined ? undefined : linha[colunaDe[papel]]);
  const t = (linha, papel) => semTraco(txt(get(linha, papel)));
  const money = (linha, papel) => {
    const v = get(linha, papel);
    return v === undefined || v === null || v === '' ? null : parseMoney(v);
  };
  const dt = (linha, papel) => {
    const v = get(linha, papel);
    return v === undefined || v === null || v === '' ? null : parseDate(v, { refYear: Number((hoje || '').slice(0, 4)) || undefined });
  };

  const registros = [];
  const avisos = [];
  let secao = null;
  const linhasGrupo = new Map();

  tabela.linhas.forEach((linha, idx) => {
    const n = idx + 1 + (tabela.linha_inicial || 0);
    const cels = linha.map(txt);
    const naoVazias = cels.filter(Boolean);
    if (!naoVazias.length) return;
    // linha de seção "Vendedor: João"
    if (naoVazias.length === 1) {
      const m = naoVazias[0].match(/^(?:vendedor(?:a)?|representante|rota|responsavel)\s*[:\-–]\s*(.+)$/i);
      if (m) { secao = m[1].trim(); return; }
    }
    if (/^(total|subtotal|soma|totais|total geral|saldo anterior|saldo final)\b/i.test(naoVazias[0])) return;
    if (naoVazias.length < 2 && tipo !== 'clientes' && tipo !== 'produtos') return; // título, rodapé ou lixo
    // linha que repete o cabeçalho (páginas de PDF)
    if (Object.keys(mapeamento).length && Object.keys(mapearColunas(cels)).length >= Math.max(2, Math.floor(Object.keys(mapeamento).length / 2))) return;

    const base = { _linha: n };
    const vendedorNome = t(linha, 'vendedor') || secao || opc.vendedor_aba || null;
    const clienteNome = t(linha, 'cliente');
    const clienteObj = () => ({ nome: clienteNome, documento: t(linha, 'cpf_cnpj') || null, telefone: t(linha, 'telefone') || null, cidade: t(linha, 'cidade') || null });
    const av = [];

    if (tipo === 'devedores') {
      if (!clienteNome) { avisos.push(`Linha ${n}: sem nome do cliente — ignorada.`); return; }
      const valorOrig = money(linha, 'valor');
      const saldo = money(linha, 'saldo');
      if (valorOrig === null && saldo === null) { avisos.push(`Linha ${n} (${clienteNome}): sem valor — ignorada.`); return; }
      const valor = valorOrig ?? saldo;
      if (valor <= 0) { avisos.push(`Linha ${n} (${clienteNome}): valor zero ou negativo — ignorada.`); return; }
      let pago = 0;
      let dataPg = dt(linha, 'data_pagamento');
      const pagoCol = money(linha, 'valor_pago');
      if (pagoCol) pago = Math.min(pagoCol, valor);
      if (valorOrig !== null && saldo !== null && saldo < valorOrig) pago = Math.max(pago, valorOrig - saldo);
      const st = statusPago(get(linha, 'status'));
      if (st.pago === true && pago === 0 && saldo === null) pago = valor;
      if (st.pago === false && saldo === null && !pagoCol) pago = 0;
      if (st.data && !dataPg) dataPg = st.data;
      const emissao = dt(linha, 'data');
      let venc = dt(linha, 'vencimento') || emissao || opc.vencimento_padrao || hoje;
      if (!dt(linha, 'vencimento') && !emissao) av.push('Sem data de vencimento: usei a data padrão.');
      registros.push({
        ...base, cliente: clienteObj(), vendedor_nome: vendedorNome, documento: t(linha, 'documento') || null, emissao, vencimento: venc,
        valor_centavos: valor, pago_centavos: pago, data_pagamento: pago > 0 ? dataPg || emissao || hoje : null, observacoes: t(linha, 'obs') || t(linha, 'produto') || null, _avisos: av,
      });
      return;
    }

    if (tipo === 'vendas') {
      const data = dt(linha, 'data') || opc.data_padrao || null;
      const produto = t(linha, 'produto');
      const qtd = (() => { const v = get(linha, 'quantidade'); if (v === undefined || v === null || v === '') return produto ? 1 : null; const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : null; })();
      const preco = money(linha, 'preco');
      let totalLinha = money(linha, 'valor');
      if (totalLinha === null && qtd !== null && preco !== null) totalLinha = Math.round(qtd * preco);
      if (totalLinha === null) { avisos.push(`Linha ${n}: sem valor — ignorada.`); return; }
      if (!clienteNome && !t(linha, 'documento')) av.push('Sem cliente (venda de balcão).');
      if (!data) av.push('Sem data: informe a data padrão ou corrija.');
      const st = statusPago(get(linha, 'status'));
      const pagoCol = money(linha, 'valor_pago');
      const item = produto ? { descricao: produto, quantidade: qtd ?? 1, unidade: t(linha, 'unidade') || null, preco_centavos: preco ?? (qtd ? Math.round(totalLinha / qtd) : totalLinha), total_centavos: totalLinha } : null;
      const doc = t(linha, 'documento');
      const chave = doc ? `${doc}|${norm(clienteNome)}|${data}` : `linha${n}`;
      let reg = linhasGrupo.get(chave);
      if (!reg) {
        reg = {
          ...base, data, numero: doc || null, cliente: clienteNome ? clienteObj() : null, vendedor_nome: vendedorNome, itens: [], total_centavos: 0,
          forma_pagamento: formaDe(t(linha, 'forma_pagamento')), vencimento: dt(linha, 'vencimento'), pago: st.pago, data_pagamento: st.data || dt(linha, 'data_pagamento'),
          pago_centavos: null, observacoes: t(linha, 'obs') || null, _avisos: av,
        };
        linhasGrupo.set(chave, reg);
        registros.push(reg);
      }
      if (item) reg.itens.push(item);
      reg.total_centavos += totalLinha;
      if (pagoCol) reg.pago_centavos = (reg.pago_centavos || 0) + pagoCol;
      return;
    }

    if (tipo === 'pagamentos') {
      let valor = money(linha, 'valor');
      const cred = money(linha, 'credito');
      const deb = money(linha, 'debito');
      if (cred !== null && cred > 0) valor = cred;
      else if (valor === null && deb) valor = null;
      if (valor === null) { return; }
      if (valor <= 0) { avisos.push(`Linha ${n}: valor de saída/negativo — ignorada (só entradas viram recebimentos).`); return; }
      const hist = t(linha, 'historico');
      const data = dt(linha, 'data') || opc.data_padrao;
      if (!data) { avisos.push(`Linha ${n}: sem data — ignorada.`); return; }
      const forma = formaDe(t(linha, 'forma_pagamento')) || formaDe(hist) || 'pix';
      const pagador = t(linha, 'pagador') || clienteNome || limparHistorico(hist) || null;
      registros.push({
        ...base, data, valor_centavos: valor, forma, pagador_nome: pagador, pagador_documento: t(linha, 'cpf_cnpj') || null, banco: t(linha, 'banco') || null,
        ref_externa: t(linha, 'ref_externa') || null, observacoes: hist || t(linha, 'obs') || null, _avisos: av,
      });
      return;
    }

    if (tipo === 'estoque') {
      const produto = t(linha, 'produto');
      if (!produto) { avisos.push(`Linha ${n}: sem produto — ignorada.`); return; }
      const data = dt(linha, 'data') || opc.data_padrao;
      if (!data) { avisos.push(`Linha ${n} (${produto}): sem data — ignorada.`); return; }
      const parseQ = (papel) => { const v = get(linha, papel); if (v === undefined || v === null || v === '') return null; const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) && x !== 0 ? x : null; };
      const baseMov = { ...base, data, produto_nome: produto, sku: t(linha, 'sku') || null, vendedor_nome: vendedorNome, valor_unit_centavos: money(linha, 'preco') ?? 0, observacoes: t(linha, 'obs') || null, _avisos: av };
      let gerou = false;
      for (const papel of WIDE) {
        const q = parseQ(papel);
        if (q) { registros.push({ ...baseMov, tipo: papel, quantidade: Math.abs(q) }); gerou = true; }
      }
      if (!gerou) {
        const q = parseQ('quantidade');
        const tp = tipoEstoqueDe(t(linha, 'tipo'));
        if (q === null) { avisos.push(`Linha ${n} (${produto}): sem quantidade — ignorada.`); return; }
        if (!tp) { avisos.push(`Linha ${n} (${produto}): não entendi o tipo "${t(linha, 'tipo')}" — ignorada.`); return; }
        registros.push({ ...baseMov, tipo: tp, quantidade: tp === 'ajuste' ? q : Math.abs(q) });
      }
      return;
    }

    if (tipo === 'clientes') {
      if (!clienteNome) return;
      registros.push({ ...base, nome: clienteNome, documento: t(linha, 'cpf_cnpj') || null, telefone: t(linha, 'telefone') || null, email: t(linha, 'email') || null, endereco: t(linha, 'endereco') || null, cidade: t(linha, 'cidade') || null, vendedor_nome: vendedorNome, _avisos: av });
      return;
    }

    if (tipo === 'produtos') {
      const nome = t(linha, 'produto') || clienteNome;
      if (!nome) return;
      registros.push({ ...base, nome, sku: t(linha, 'sku') || null, unidade: t(linha, 'unidade') || 'un', preco_centavos: money(linha, 'preco') ?? money(linha, 'valor') ?? 0, custo_centavos: money(linha, 'custo') ?? 0, categoria: t(linha, 'categoria') || null, estoque_minimo: Number(get(linha, 'estoque_minimo')) || 0, _avisos: av });
    }
  });

  if (tipo === 'vendas') {
    for (const r of registros) {
      if (!r.itens.length) r.itens = [];
      if (r.pago_centavos !== null && r.pago_centavos >= r.total_centavos) { r.pago = true; r.pago_centavos = null; }
    }
  }
  return { registros, avisos, papeis: colunaDe };
}

function pareceCabecalho(l0, l1) {
  if (!l0 || !l1) return false;
  const a = l0.map((c) => txt(c)).filter(Boolean);
  if (a.length < 2) return false;
  const soTexto = a.every((c) => !/^[\d.,\s/:R$-]+$/.test(c) && parseMoney(c) === null && !parseDate(c));
  const dadosNumericos = l1.some((c) => c !== null && c !== '' && (typeof c === 'number' || (typeof c === 'string' && (parseDate(c) || /^[\sR$]*\d[\d.,]*\s*$/.test(c)))));
  return soTexto && dadosNumericos;
}

/** Lê uma tabela bruta (matriz) e devolve o necessário para a prévia. */
export function prepararTabela(matriz, { nomeAba = '', hoje, vendedor_aba = null } = {}) {
  const linhas = matriz.map((l) => l.map((c) => (c === undefined ? null : c)));
  let idx = acharCabecalho(linhas);
  let cabecalho;
  let dados;
  let mapeamento;
  if (idx >= 0) {
    cabecalho = linhas[idx].map((c) => txt(c));
    dados = linhas.slice(idx + 1);
    mapeamento = mapearColunas(cabecalho);
  } else if (pareceCabecalho(linhas[0], linhas[1])) {
    // nomes de coluna fora do comum: a 1ª linha é texto e a 2ª tem números/datas
    cabecalho = linhas[0].map((c) => txt(c));
    dados = linhas.slice(1);
    mapeamento = mapearColunas(cabecalho);
    idx = 0;
  } else {
    const largura = Math.max(0, ...linhas.map((l) => l.length));
    cabecalho = Array.from({ length: largura }, (_, i) => `Coluna ${i + 1}`);
    dados = linhas;
    mapeamento = {};
    idx = -1;
  }
  const largura = cabecalho.length;
  dados = dados.map((l) => Array.from({ length: largura }, (_, i) => (l[i] === undefined ? null : l[i])));
  const tipo = detectarTipo(Object.values(mapeamento), nomeAba);
  return { cabecalho, linhas: dados, linha_inicial: idx + 1, mapeamento, tipo, vendedor_aba, hoje };
}
