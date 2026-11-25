// Notas fiscais (XML), relatório de vendas do sistema e relatório de boletos do banco → operações para a SINCRONIZAÇÃO
// (a mesma usada pelas planilhas da empresa: criar o que é novo, atualizar o que mudou, não duplicar nada).
//
//   op: 'venda'    — uma nota (fonte 'nfe' = XML completo; fonte 'relatorio' = só o que o relatório do sistema informa)
//   op: 'cancelar' — a SEFAZ cancelou a nota: se ela estiver no painel, é cancelada (e a nota cancelada NUNCA vira venda)
//   op: 'boleto'   — título do banco (fonte 'banco'): confirma a dívida em aberto e guarda o "nosso número"
import { addDays } from '../../../shared/dates.js';
import { FORMAS_AVISTA } from '../finance.js';
import { canonizarVendedores } from './perfis-bomgosto.js';
import { numeroNorm } from './sync-comum.js';

/** Número da nota dentro da chave de acesso (44 dígitos: UF 2, AAMM 4, CNPJ 14, modelo 2, série 3, número 9, ...). */
export const numeroDaChave = (chave) => (/^\d{44}$/.test(String(chave || '')) ? numeroNorm(String(chave).slice(25, 34)) : null);

const STATUS_OK = /autorizad|^100$|^150$/i;
const nomeDoMotivo = (n) => (n.avisos || []).find((a) => /n[aã]o autorizada/i.test(a));

/** Parcelas da nota: boleto "NNN-01", "NNN-02"… quando são várias; "NNN" quando é uma só. À vista já nasce paga. */
function parcelasDaNota(n) {
  const numero = numeroNorm(n.numero);
  const aVista = !n.parcelas.length && (/vista/i.test(n.natureza || '') || FORMAS_AVISTA.includes(n.forma_pagamento) || !n.forma_pagamento);
  if (!n.parcelas.length) {
    return [{ documento: numero, vencimento: n.data, valor_centavos: n.total_centavos, pago: aVista, data_pagamento: aVista ? n.data : null, forma: aVista ? (n.forma_pagamento || 'dinheiro') : null }];
  }
  return n.parcelas.map((p, i) => ({
    documento: n.parcelas.length > 1 ? `${numero}-${String(i + 1).padStart(2, '0')}` : numero,
    vencimento: p.vencimento,
    valor_centavos: p.valor_centavos,
    pago: false,
    data_pagamento: null,
    forma: null,
  }));
}

/**
 * @param nfes          notas lidas de XML (nfe.js)
 * @param cancelamentos eventos de cancelamento lidos de XML
 * @param relatorios    relatórios de vendas do sistema (relatorios.js)
 */
export function operacoesDeNotas({ nfes = [], cancelamentos = [], relatorios = [] }, { vendedoresExistentes = [] } = {}) {
  const registros = [];
  const avisos = [];
  const canceladas = new Map(); // chave → motivo
  for (const c of cancelamentos) canceladas.set(c.chave, c.motivo || '');

  // vendedor de cada nota, vindo do relatório do sistema (a nota fiscal não diz quem vendeu)
  const linhasRel = relatorios.flatMap((r) => r.linhas);
  const canon = canonizarVendedores(linhasRel.map((l) => l.vendedor).concat(nfes.map((n) => n.vendedor_nome)), vendedoresExistentes);
  const relPorNumero = new Map();
  for (const l of linhasRel) if (l.numero) relPorNumero.set(numeroNorm(l.numero), l);

  const vistos = new Set();
  for (const n of nfes) {
    const numero = numeroNorm(n.numero);
    const chaveKey = n.chave || `numero:${numero}`;
    if (vistos.has(chaveKey)) { avisos.push(`NF ${numero}: o mesmo XML veio mais de uma vez — usei só um.`); continue; }
    vistos.add(chaveKey);
    if (canceladas.has(n.chave)) continue; // vira a operação 'cancelar' mais abaixo; a nota cancelada não é venda
    const rel = relPorNumero.get(numero);
    const aviso = [...(n.avisos || [])];
    if (rel && rel.valor_centavos !== n.total_centavos) aviso.push(`O relatório de vendas tem esta nota com outro valor (${(rel.valor_centavos / 100).toFixed(2).replace('.', ',')}); valeu o da nota fiscal.`);
    if (rel && rel.data !== n.data) aviso.push('O relatório de vendas tem esta nota em outra data; valeu a da nota fiscal.');
    const naoAutorizada = nomeDoMotivo(n);
    if (naoAutorizada) avisos.push(`NF ${numero} (${n.cliente.nome}): ${naoAutorizada} Não entra como venda nova; confira com o contador.`);
    registros.push({
      op: 'venda',
      fonte: 'nfe',
      _linha: `NF ${numero}`,
      numero,
      serie: n.serie || null,
      chave_nfe: n.chave || null,
      data: n.data,
      cliente: { nome: n.cliente.nome, documento: n.cliente.documento, telefone: n.cliente.telefone, cidade: n.cliente.cidade, endereco: n.cliente.endereco, email: n.cliente.email },
      vendedor_nome: canon(rel?.vendedor || n.vendedor_nome),
      itens: n.itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade || 'cx', preco_centavos: i.preco_centavos, total_centavos: i.total_centavos })),
      total_centavos: n.total_centavos,
      forma_pagamento: n.parcelas.length ? 'prazo' : n.forma_pagamento || 'dinheiro',
      parcelas: parcelasDaNota(n),
      observacoes: n.observacoes || null,
      _avisos: aviso,
      _nao_incluir: !!naoAutorizada || /devolu/i.test(aviso.join(' ')),
    });
  }

  // notas canceladas: se já estiverem no painel, são canceladas lá também
  const jaFeitas = new Set();
  for (const [chave, motivo] of canceladas) {
    const numero = numeroDaChave(chave) || numeroNorm(nfes.find((n) => n.chave === chave)?.numero);
    if (!numero || jaFeitas.has(numero)) continue;
    jaFeitas.add(numero);
    const nota = nfes.find((n) => n.chave === chave);
    registros.push({
      op: 'cancelar',
      fonte: 'nfe',
      _linha: `NF ${numero} (cancelada)`,
      numero,
      chave_nfe: chave,
      data: nota?.data || null,
      cliente: nota ? { nome: nota.cliente.nome } : null,
      total_centavos: nota?.total_centavos ?? null,
      motivo,
      _avisos: [`Nota cancelada na SEFAZ${motivo ? ` ("${motivo}")` : ''}: não entra como venda.`],
    });
  }
  if (jaFeitas.size) avisos.unshift(`${jaFeitas.size} ${jaFeitas.size === 1 ? 'nota cancelada foi deixada de fora' : 'notas canceladas foram deixadas de fora'}: ${[...jaFeitas].sort((a, b) => a - b).join(', ')}.`);

  // vendas que o relatório do sistema mostra e que não têm XML junto (ou ainda não têm nota emitida)
  const comXml = new Set(registros.filter((r) => r.op === 'venda').map((r) => r.numero));
  for (const l of linhasRel) {
    if (l.numero && (comXml.has(numeroNorm(l.numero)) || canceladas.size && [...jaFeitas].includes(numeroNorm(l.numero)))) continue;
    const aVista = /vista/i.test(l.saida || '') || /dinheiro|pix|cart/i.test(l.recebimento || '');
    const sem = !l.numero;
    const parcela = aVista
      ? { documento: l.numero ? numeroNorm(l.numero) : null, vencimento: l.data, valor_centavos: l.valor_centavos, pago: true, data_pagamento: l.data, forma: /pix/i.test(l.recebimento || '') ? 'pix' : 'dinheiro' }
      : { documento: l.numero ? numeroNorm(l.numero) : null, vencimento: addDays(l.data, 30), valor_centavos: l.valor_centavos, pago: false, data_pagamento: null, forma: null, provisorio: true };
    const av = [];
    if (sem) av.push('Venda sem número de nota fiscal no relatório (a nota ainda não foi emitida): entra sem número e será ligada à nota quando o XML chegar.');
    if (!aVista) av.push('O relatório não informa o vencimento: usei 30 dias depois da venda, provisório. Quando o XML da nota chegar, as parcelas são acertadas.');
    registros.push({
      op: 'venda',
      fonte: 'relatorio',
      _linha: sem ? `Relatório: sem nota, ${l.cliente}` : `Relatório: NF ${numeroNorm(l.numero)}`,
      numero: l.numero ? numeroNorm(l.numero) : null,
      data: l.data,
      cliente: { nome: l.cliente },
      cliente_cortado: true, // o relatório corta o nome do cliente na coluna
      vendedor_nome: canon(l.vendedor),
      itens: [],
      total_centavos: l.valor_centavos,
      forma_pagamento: aVista ? 'dinheiro' : 'prazo',
      parcelas: [parcela],
      observacoes: sem ? 'Venda sem nota fiscal emitida na data da importação.' : null,
      _avisos: av,
    });
  }

  registros.sort((a, b) => (a.data || '').localeCompare(b.data || '') || Number(a.numero || 0) - Number(b.numero || 0));
  return { registros, produtos: [], avisos };
}

/** Relatório de títulos do banco (Sicoob) → operações 'boleto'. */
export function operacoesDeBanco(rel) {
  const registros = [];
  const avisos = [];
  for (const l of rel.linhas) {
    registros.push({
      op: 'boleto',
      fonte: 'banco',
      _linha: `Sicoob ${l.nosso_numero}`,
      documento: l.seu_numero,
      nosso_numero: l.nosso_numero,
      cliente: { nome: l.sacado },
      vendedor_nome: null,
      emissao: l.entrada,
      vencimento: l.vencimento,
      valor_centavos: l.valor_centavos,
      situacao: 'aberto',
      data_pagamento: null,
      forma: 'boleto',
      observacoes: `Boleto Sicoob nº ${l.nosso_numero}`,
      _avisos: [],
    });
  }
  return { registros, produtos: [], avisos, periodo: rel.periodo, consulta: rel.consulta };
}
