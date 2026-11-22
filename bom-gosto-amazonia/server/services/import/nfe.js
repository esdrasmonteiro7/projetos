// Leitura de XML de NF-e / NFC-e (nota fiscal eletrônica) — padrão nacional.
import { XMLParser } from 'fast-xml-parser';
import { digits } from '../../../shared/text.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name) => ['det', 'dup', 'detPag', 'obsCont', 'vol'].includes(name),
});

const cents = (v) => (v === undefined || v === null || v === '' ? 0 : Math.round(Number(String(v).replace(',', '.')) * 100) || 0);
const txt = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();

const FORMA_POR_TPAG = {
  '01': 'dinheiro', '02': 'cheque', '03': 'cartao', '04': 'cartao', '05': 'prazo', '14': 'prazo', '15': 'boleto', '16': 'transferencia',
  '17': 'pix', '18': 'transferencia', '20': 'pix', '99': 'outro',
};

const PARAR_NOME = new Set(['pedido', 'ped', 'obrigado', 'obrigada', 'cond', 'obs', 'frete', 'pagamento', 'pag', 'nf', 'nota', 'tel', 'fone', 'cliente', 'entrega', 'data', 'vencimento', 'venc', 'icms', 'ref']);
function adivinharVendedor(texto) {
  const m = String(texto || '').match(/(?:vend(?:edor(?:a)?)?|representante|rep|vdr)\.?\s*[:\-–]\s*([A-Za-zÀ-ÿ']+(?:\s+[A-Za-zÀ-ÿ']+){0,3})/i);
  if (!m) return null;
  const palavras = [];
  for (const w of m[1].split(/\s+/)) {
    if (PARAR_NOME.has(w.toLowerCase())) break;
    palavras.push(w);
  }
  const nome = palavras.join(' ').trim();
  return nome.length >= 2 ? nome : null;
}

/** @returns {{ok:true, tipo:'venda'|'cancelamento', ...}|{ok:false, motivo:string}} */
export function lerNFe(xmlText) {
  let j;
  try {
    j = parser.parse(xmlText);
  } catch {
    return { ok: false, motivo: 'XML inválido ou corrompido.' };
  }
  // evento de cancelamento
  const ev = j.procEventoNFe?.evento?.infEvento || j.evento?.infEvento || j.envEvento?.evento?.infEvento;
  if (ev) {
    if (txt(ev.tpEvento) === '110111') return { ok: true, tipo: 'cancelamento', chave: txt(ev.chNFe), motivo: txt(ev.detEvento?.xJust) };
    return { ok: false, motivo: `XML de evento da nota (${txt(ev.tpEvento) || 'sem tipo'}) — não contém venda.` };
  }
  const nfe = j.nfeProc?.NFe || j.NFe || j.enviNFe?.NFe;
  if (!nfe?.infNFe) {
    if (j.resNFe) return { ok: false, motivo: 'Este XML é só o resumo da nota (sem itens). Baixe o XML completo da NF-e.' };
    return { ok: false, motivo: 'Este XML não parece uma nota fiscal eletrônica (NF-e).' };
  }
  const inf = nfe.infNFe;
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const dest = inf.dest || {};
  const prot = j.nfeProc?.protNFe?.infProt;
  const avisos = [];
  const cStat = prot ? txt(prot.cStat) : null;
  if (cStat && !['100', '150'].includes(cStat)) avisos.push(`Nota não autorizada pela SEFAZ (status ${cStat}).`);
  if (txt(ide.finNFe) === '4') avisos.push('Nota de devolução: confira antes de importar.');

  const chave = txt(inf['@_Id']).replace(/^NFe/, '');
  const dataEmissao = txt(ide.dhEmi || ide.dEmi).slice(0, 10);

  const itens = (inf.det || []).map((d) => {
    const p = d.prod || {};
    const qtd = Number(txt(p.qCom).replace(',', '.')) || 0;
    const unit = cents(p.vUnCom);
    return {
      codigo: txt(p.cProd),
      descricao: txt(p.xProd),
      unidade: txt(p.uCom).toLowerCase() || null,
      quantidade: qtd,
      preco_centavos: unit,
      total_centavos: cents(p.vProd) - cents(p.vDesc) + cents(p.vFrete) + cents(p.vOutro),
    };
  });

  const total = inf.total?.ICMSTot || {};
  const totalNota = cents(total.vNF);
  const cobr = inf.cobr || {};
  const parcelas = (cobr.dup || []).map((d, i) => ({
    documento: txt(d.nDup) || null,
    vencimento: txt(d.dVenc).slice(0, 10),
    valor_centavos: cents(d.vDup),
    ordem: i + 1,
  })).filter((p) => p.vencimento && p.valor_centavos > 0);

  const detPag = (inf.pag?.detPag || []).filter((p) => p && txt(p.tPag) !== '90');
  const formas = [...new Set(detPag.map((p) => FORMA_POR_TPAG[txt(p.tPag)] || 'outro'))];
  let forma = formas.length === 1 ? formas[0] : formas.length > 1 ? 'outro' : null;
  if (parcelas.length && !forma) forma = 'prazo';

  const infCpl = [txt(inf.infAdic?.infCpl), ...(inf.infAdic?.obsCont || []).map((o) => `${o['@_xCampo'] || ''}: ${txt(o.xTexto)}`)].filter(Boolean).join(' | ');
  const vendedorCampo = (inf.infAdic?.obsCont || []).find((o) => /vendedor|representante/i.test(o['@_xCampo'] || ''));
  const vendedor = vendedorCampo ? txt(vendedorCampo.xTexto) : adivinharVendedor(infCpl);

  const ender = dest.enderDest || {};
  const docDest = txt(dest.CNPJ || dest.CPF);
  return {
    ok: true,
    tipo: 'venda',
    chave,
    numero: txt(ide.nNF),
    serie: txt(ide.serie),
    modelo: txt(ide.mod),
    data: dataEmissao,
    natureza: txt(ide.natOp),
    emitente: { nome: txt(emit.xNome), documento: txt(emit.CNPJ || emit.CPF) },
    cliente: {
      nome: txt(dest.xNome) || 'Consumidor final',
      documento: digits(docDest) || null,
      telefone: txt(ender.fone) || null,
      cidade: txt(ender.xMun) || null,
      endereco: [txt(ender.xLgr), txt(ender.nro), txt(ender.xBairro)].filter(Boolean).join(', ') || null,
      email: txt(dest.email) || null,
    },
    itens,
    total_centavos: totalNota || itens.reduce((s, i) => s + i.total_centavos, 0),
    parcelas,
    forma_pagamento: forma,
    vendedor_nome: vendedor || null,
    observacoes: infCpl ? infCpl.slice(0, 400) : null,
    avisos,
  };
}
