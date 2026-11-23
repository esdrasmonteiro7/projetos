// Leitura das planilhas da própria empresa (modelos que ela já usa):
//   • "Lista de Devedores"  — uma aba por mês com a lista de boletos (SACADOS, NFE, ENTRADA, VENCIMENTO, VENDEDOR, VALOR, BOLETO, SITUAÇÃO…)
//   • "Controle" (vendedores) — blocos de vendas por vendedor (DATA, NFE, CLIENTES, caixas por produto, RECEBIMENTO, VENCIMENTO, VALOR,
//     SITUAÇÃO), a aba DEPÓSITO (entradas e saídas) e a aba PRODUÇÃO.
// Aqui só se LÊ e se organiza (sem tocar no banco). Quem grava é o importador (analisar.js / confirmar.js).
import { norm } from '../../../shared/text.js';

// ------------------------------------------------------------------ utilidades
const T = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const N = (v) => norm(T(v));
const ehData = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dinheiro = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  const t = T(v).replace(/^R\$\s*/i, '');
  if (!/^-?[\d.,]+$/.test(t)) return null;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "0793-01" → { base: '793', suf: '01', chave: '793-01' } ; "821" → { base: '821', suf: null, chave: '821' } ; texto livre → null */
export function parseNF(v) {
  const t = T(v);
  const m = /^0*(\d+)(?:\s*[-/.]\s*(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const suf = m[2] ? m[2].padStart(2, '0') : null;
  return { base: m[1], suf, chave: suf ? `${m[1]}-${suf}` : m[1], texto: t };
}

const addAno = (iso, dia, mes) => {
  // "18/11" + data de referência → AAAA-MM-DD (o ano é o da referência; se o mês for menor, é do ano seguinte)
  const [a, m] = iso.split('-').map(Number);
  const ano = mes < m - 1 ? a + 1 : a; // tolera pagamento um mês antes da data de referência
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
};
/** Acha datas "dd/mm" ou "dd/mm/aaaa" dentro de um texto. */
export function datasNoTexto(texto, referencia) {
  const out = [];
  for (const m of String(texto || '').matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) {
    const d = Number(m[1]);
    const mes = Number(m[2]);
    if (d < 1 || d > 31 || mes < 1 || mes > 12) continue;
    if (m[3]) { const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); out.push(`${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`); } else if (referencia) out.push(addAno(referencia, d, mes));
  }
  return out;
}

// ------------------------------------------------------------------ reconhecimento
/** 'devedores' | 'controle' | null — olha só os cabeçalhos das abas. */
export function reconhecerPlanilha(abas) {
  let devedores = 0;
  let controle = 0;
  for (const a of abas) {
    for (const linha of a.matriz.slice(0, 60)) {
      const ns = linha.map((c) => N(c));
      if (ns.includes('sacados') || ns.includes('sacado')) if (ns.includes('vencimento') && (ns.includes('situacao') || ns.includes('valor'))) devedores++;
      const i = ns.indexOf('nfe');
      if (i >= 0 && ns[i + 1] === 'clientes') controle++;
    }
  }
  if (controle) return 'controle';
  if (devedores) return 'devedores';
  return null;
}

// ================================================================== LISTA DE DEVEDORES
const STATUS = (v) => {
  const t = N(v);
  if (!t) return '';
  if (/^pago|^paga|quitad|liquidad/.test(t)) return 'pago';
  if (/baixad/.test(t)) return 'baixado';
  if (/vencid/.test(t)) return 'vencido';
  if (/aberto/.test(t)) return 'aberto';
  return t;
};

/** Lê todas as abas de "Lista de Devedores". Devolve { boletos, avisos }. */
export function lerListaDevedores(abas) {
  const boletos = [];
  const avisos = [];
  for (const aba of abas) {
    const iCab = aba.matriz.findIndex((l) => {
      const ns = l.map((c) => N(c));
      return (ns.includes('sacados') || ns.includes('sacado')) && ns.includes('vencimento');
    });
    if (iCab < 0) continue;
    const cab = aba.matriz[iCab].map((c) => N(c));
    const col = {};
    const obs = [];
    cab.forEach((h, i) => {
      if (!h) return;
      if (h === 'sacados' || h === 'sacado') col.cliente = i;
      else if (h === 'nfe' || h === 'nf') col.doc = i;
      else if (h === 'entrada' || h === 'emissao') col.emissao = i;
      else if (h === 'vencimento') col.venc = i;
      else if (h === 'vendedor') col.vendedor = i;
      else if (h === 'valor') col.valor = i;
      else if (h === 'boleto') col.boleto = i;
      else if (h === 'situacao') col.situacao = i;
      else if (h.startsWith('observ')) obs.push(i);
      else if (/^(pagamento data|data pagamento|data|data do pagamento|pago em)$/.test(h)) col.dataPg = i;
      else if (/^valores? pagos?$/.test(h)) col.pago = i;
    });
    if (col.cliente === undefined || col.venc === undefined) continue;
    const dados = aba.matriz.slice(iCab + 1);
    // colunas de observação: a numérica guarda o valor pago (modelo de setembro); a de texto é a observação
    const mostraNumerica = (i) => { const v = dados.map((l) => l[i]).filter((x) => x !== null && x !== undefined); return v.length > 0 && v.filter((x) => typeof x === 'number').length / v.length >= 0.6; };
    for (const i of obs) { if (mostraNumerica(i) && col.pago === undefined) col.pago = i; else if (col.obs === undefined) col.obs = i; }
    // coluna sem título logo depois da data do pagamento: valor pago (modelo de outubro/novembro)
    if (col.pago === undefined && col.dataPg !== undefined && !cab[col.dataPg + 1]) col.pago = col.dataPg + 1;
    // limite à direita: onde começam os quadros de resumo ("FATURAMENTO DO MÊS"...)
    const fim = cab.findIndex((h, i) => i > (col.dataPg ?? col.situacao ?? 0) && /faturamento|comparativo|em aberto/.test(h));
    const ultima = fim >= 0 ? fim : cab.length;
    if (col.pago !== undefined && col.pago >= ultima) delete col.pago;

    dados.forEach((l, k) => {
      const linhaOrig = aba.linhas?.[iCab + 1 + k] ?? null;
      const cliente = T(l[col.cliente]);
      if (!cliente) return; // linhas "EM ABERTO" em branco e totais
      const docTxt = col.doc !== undefined ? T(l[col.doc]) : '';
      const nf = parseNF(docTxt);
      const valor = col.valor !== undefined ? dinheiro(l[col.valor]) : null;
      const pagoCent = col.pago !== undefined ? dinheiro(l[col.pago]) : null;
      const situacao = col.situacao !== undefined ? STATUS(l[col.situacao]) : '';
      const emissao = col.emissao !== undefined && ehData(l[col.emissao]) ? l[col.emissao] : null;
      const vencimento = ehData(l[col.venc]) ? l[col.venc] : null;
      if (!docTxt && valor === null && pagoCent === null) return;
      boletos.push({
        aba: aba.nome,
        linha: linhaOrig,
        cliente,
        nf,
        documento: nf?.chave || docTxt,
        emissao,
        vencimento,
        vendedor: col.vendedor !== undefined ? T(l[col.vendedor]) : '',
        valor_centavos: valor,
        pago_centavos: pagoCent,
        boleto: col.boleto !== undefined ? T(l[col.boleto]) : '',
        situacao,
        observacao: col.obs !== undefined ? T(l[col.obs]) : '',
        data_pagamento: col.dataPg !== undefined && ehData(l[col.dataPg]) ? l[col.dataPg] : null,
      });
    });
  }
  if (!boletos.length) avisos.push('Não encontrei boletos nesta planilha.');
  return { boletos, avisos };
}

// ================================================================== NOMES DE VENDEDORES
const distancia = (a, b) => {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
};
const bonito = (s) => String(s).toLowerCase().replace(/(^|[\s-])([a-zà-ú])/g, (_, p, c) => p + c.toUpperCase());

/**
 * Junta grafias do mesmo vendedor (PETERSON / PETERSSON / PETTERSON, BRITO → VALTER BRITO).
 * @param nomes lista de nomes como aparecem nas planilhas (pode repetir; a mais frequente vira o nome oficial)
 * @returns função (nome) → nome oficial (em "Maiúsculas Iniciais") ou null se vazio
 */
export function canonizarVendedores(nomes, existentes = []) {
  const freq = new Map();
  for (const n of nomes) { const t = T(n); if (t) freq.set(t, (freq.get(t) || 0) + 1); }
  // vendedores que já estão no painel têm preferência: as outras grafias passam a usar o nome já cadastrado
  for (const n of existentes) { const t = T(n); if (t) freq.set(t, (freq.get(t) || 0) + 100000); }
  const grupos = []; // { chave, nomes: Set, n }
  const lista = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  for (const [nome, n] of lista) {
    const k = norm(nome);
    let g = grupos.find((x) => x.chaves.some((c) => c === k));
    if (!g) {
      g = grupos.find((x) => x.chaves.some((c) => {
        const ta = c.split(' ');
        const tb = k.split(' ');
        const sufixo = (ta.length > tb.length ? ta : tb).slice(-Math.min(ta.length, tb.length)).join(' ') === (ta.length > tb.length ? tb : ta).join(' ') && Math.min(ta.length, tb.length) >= 1 && Math.min(c.length, k.length) >= 4;
        const parecido = Math.min(c.length, k.length) >= 6 && c[0] === k[0] && distancia(c, k) <= 2;
        return sufixo || parecido;
      }));
    }
    if (g) { g.chaves.push(k); g.nomes.set(nome, n); g.n += n; } else grupos.push({ chaves: [k], nomes: new Map([[nome, n]]), n });
  }
  const mapa = new Map();
  const jaCadastrados = new Set(existentes.map((n) => norm(n)));
  for (const g of grupos) {
    // nome oficial: o que já está cadastrado; senão o mais completo (VALTER BRITO, não BRITO); depois o mais curto (erros de digitação
    // costumam SOBRAR letras: PETERSSON, PETTERSON) e por fim o mais usado
    const tokens = (n) => norm(n).split(' ').length;
    const oficial = [...g.nomes.entries()].sort((a, b) => (jaCadastrados.has(norm(b[0])) - jaCadastrados.has(norm(a[0]))) || (tokens(b[0]) - tokens(a[0])) || (a[0].length - b[0].length) || (b[1] - a[1]))[0][0];
    for (const k of g.chaves) mapa.set(k, bonito(oficial));
  }
  return (nome) => {
    const t = T(nome);
    return t ? mapa.get(norm(t)) || bonito(t) : null;
  };
}

// ================================================================== CONTROLE (vendas por vendedor, depósito, produção)
const PRODUTOS_PADRAO = ['400BG', '300BG', 'CRAK', 'FOLHADO', '30GR', 'AMANT', 'DOCE', 'MAIZENA', '400G', '300G', '200G', 'ROSCA', 'PALITO'];
// colunas da aba PRODUÇÃO (na ordem) → produto do depósito (confere com as fórmulas da própria planilha)
const PRODUCAO_PARA_DEPOSITO = ['400BG', '300BG', 'CRAK', 'FOLHADO', 'FOLH.DOCE', '30GR', 'AMANT', 'DOCE', 'MAIZENA'];

const colunaDaCelula = (ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
  return { col: n - 1, linha: Number(m[2]) };
};

/**
 * Quem é o vendedor de cada faixa de linhas, segundo o quadro "RELATÓRIO GERAL" da própria planilha:
 * uma linha "VENDEDOR | FATURAMENTO…" e abaixo, para cada vendedor, uma fórmula =SUM(AK541:AK542) com as linhas dele.
 * (É assim que a planilha separa, por exemplo, DEWID FURTADO e GRACY NEY dentro de um mesmo bloco.)
 */
function faixasDeVendedores(aba) {
  const faixas = [];
  const m = aba.matriz;
  for (let i = 0; i < m.length; i++) {
    const c = m[i].findIndex((v, k) => N(v) === 'vendedor' && N(m[i][k + 1]).startsWith('faturamento'));
    if (c < 0) continue;
    for (let j = i + 1; j < m.length; j++) {
      const nome = T(m[j][c]);
      if (!nome) break;
      const ref = Object.entries(aba.formulas || {}).find(([r]) => { const p = colunaDaCelula(r); return p && p.linha === aba.linhas[j] && p.col === c + 1; });
      const mm = ref && /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(ref[1].replace(/\s+/g, ''));
      if (mm && mm[1] === mm[3] && !/^total/.test(N(nome))) faixas.push({ nome, de: Number(mm[2]), ate: Number(mm[4]) });
    }
  }
  return faixas;
}

function lerAbaDeVendas(aba, avisos) {
  const cabs = [];
  aba.matriz.forEach((l, i) => l.forEach((v, c) => { if (N(v) === 'nfe' && N(l[c + 1]) === 'clientes') cabs.push({ i, c }); }));
  if (!cabs.length) return null;

  // produtos (rótulos oficiais) e preços de vendedor
  const iRet = aba.matriz.findIndex((l) => N(l[0]) === 'retiradas');
  let produtos = PRODUTOS_PADRAO;
  if (iRet >= 0) {
    const l = aba.matriz[iRet];
    const ini = l.findIndex((v, i) => i > 0 && N(v) === 'vendedor') + 1;
    const fim = l.findIndex((v, i) => i >= ini && N(v) === 'valor');
    const lista = l.slice(ini, fim > 0 ? fim : undefined).map(T).filter(Boolean);
    if (lista.length >= 5) produtos = lista;
  }
  const precos = {};
  const iPreco = aba.matriz.findIndex((l) => N(l[0]) === 'preco' && N(l[1]).includes('vendedor'));
  if (iPreco >= 0 && iRet >= 0) {
    const ini = aba.matriz[iRet].findIndex((v, i) => i > 0 && N(v) === 'vendedor') + 1;
    produtos.forEach((p, k) => { const v = dinheiro(aba.matriz[iPreco][ini + k]); if (v) precos[p] = v; });
  }

  const faixas = faixasDeVendedores(aba);
  const linhas = [];
  cabs.forEach((cab, bi) => {
    const cabLinha = aba.matriz[cab.i];
    const vendedorBloco = T(cabLinha[cab.c - 1]);
    const idx = (nome, desde) => { for (let k = desde; k < cabLinha.length; k++) if (N(cabLinha[k]) === nome) return k; return -1; };
    const iRec = idx('recebimento', cab.c + 2);
    const iVen = idx('vencimento', iRec);
    const iVal = idx('valor', iVen);
    const iSit = idx('situacao', iVal);
    if (iRec < 0 || iVen < 0 || iVal < 0 || iSit < 0) { avisos.push(`Bloco "${vendedorBloco}": não achei todas as colunas (recebimento, vencimento, valor, situação).`); return; }
    const nProd = iRec - (cab.c + 2);
    const fim = bi + 1 < cabs.length ? cabs[bi + 1].i : aba.matriz.length;
    for (let i = cab.i + 1; i < fim; i++) {
      const l = aba.matriz[i];
      const data = l[cab.c - 1];
      const nf = parseNF(l[cab.c]);
      const cliente = T(l[cab.c + 1]);
      if (!ehData(data) || !nf || !cliente) {
        const v = dinheiro(l[iVal]);
        if (v && ehData(data) !== undefined && (T(l[cab.c]) || cliente)) avisos.push(`Linha ${aba.linhas[i]} (${cliente || 'sem cliente'}, NF ${T(l[cab.c]) || '?'}): tem valor mas faltou data, nota ou cliente — não importada.`);
        continue;
      }
      const linhaOrig = aba.linhas[i];
      const valor = dinheiro(l[iVal]);
      const qtd = [];
      void qtd;
      for (let k = 0; k < nProd; k++) { const q = numero(l[cab.c + 2 + k]); if (q && q > 0) qtd.push({ produto: produtos[k] || T(cabLinha[cab.c + 2 + k]), quantidade: q }); }
      if (valor === null || !(valor > 0)) { avisos.push(`NF ${nf.chave} (${cliente}): sem valor na planilha — linha ${linhaOrig} ignorada.`); continue; }
      const faixa = faixas.find((f) => linhaOrig >= f.de && linhaOrig <= f.ate);
      linhas.push({
        aba: aba.nome,
        linha: linhaOrig,
        data,
        nf,
        cliente,
        vendedor: faixa?.nome || vendedorBloco,
        itens: qtd,
        recebimento: T(l[iRec]),
        vencimento: ehData(l[iVen]) ? l[iVen] : null,
        valor_centavos: valor,
        situacao: N(l[iSit]),
      });
    }
  });
  return { produtos, precos, linhas };
}

/** Lê as abas de "Controle": vendas (por vendedor), depósito (entradas/saídas) e produção. */
export function lerControle(abas) {
  const avisos = [];
  const vendas = [];
  const precos = {};
  let produtosVenda = PRODUTOS_PADRAO;
  for (const aba of abas) {
    const r = lerAbaDeVendas(aba, avisos);
    if (!r) continue;
    vendas.push(...r.linhas);
    Object.assign(precos, r.precos);
    produtosVenda = r.produtos;
  }
  const deposito = { entradas: [], saidas: [], produtos: [] };
  const producao = [];
  for (const aba of abas) {
    const n = N(aba.nome);
    if (n.includes('deposito')) lerDeposito(aba, deposito, avisos);
    else if (n.includes('producao')) lerProducao(aba, deposito.produtos, producao, avisos);
  }
  return { vendas, precos, produtos: [...new Set([...produtosVenda, ...deposito.produtos])], deposito, producao, avisos };
}

function lerDeposito(aba, out, avisos) {
  const m = aba.matriz;
  const iEnt = m.findIndex((l) => N(l[0]) === 'data' && N(l[1]).startsWith('descricao'));
  if (iEnt < 0) { avisos.push('Aba de depósito sem o cabeçalho "DATA / DESCRIÇÃO / ORIGEM".'); return; }
  const cab = m[iEnt];
  // entradas: A=data, B=descrição, C.. produtos (até a coluna vazia antes de "SAÍDAS")
  let fimEnt = cab.findIndex((v, i) => i > 1 && (v === null || N(v) === 'data'));
  if (fimEnt < 0) fimEnt = cab.length;
  const prodEnt = cab.slice(2, fimEnt).map(T);
  // saídas: S=data, T=vendedor, U=destino/motivo, V.. produtos
  const iS = cab.findIndex((v, i) => i > 2 && N(v) === 'data');
  const prodSai = iS >= 0 ? cab.slice(iS + 3).map(T) : [];
  out.produtos = [...new Set([...prodEnt.filter(Boolean), ...prodSai.filter(Boolean)])];
  for (let i = iEnt + 1; i < m.length; i++) {
    const l = m[i];
    const linhaOrig = aba.linhas[i];
    if (ehData(l[0])) {
      prodEnt.forEach((p, k) => { const q = numero(l[2 + k]); if (p && q && q > 0) out.entradas.push({ data: l[0], produto: p, quantidade: q, descricao: T(l[1]), linha: linhaOrig }); });
    }
    if (iS >= 0 && ehData(l[iS])) {
      prodSai.forEach((p, k) => { const q = numero(l[iS + 3 + k]); if (p && q && q > 0) out.saidas.push({ data: l[iS], produto: p, quantidade: q, vendedor: T(l[iS + 1]), destino: T(l[iS + 2]), linha: linhaOrig }); });
    }
  }
}

function lerProducao(aba, produtosDeposito, out, avisos) {
  const m = aba.matriz;
  const iCab = m.findIndex((l) => N(l[0]) === 'data');
  if (iCab < 0) { avisos.push('Aba de produção sem a coluna DATA.'); return; }
  const rotulos = (produtosDeposito.length >= 9 ? produtosDeposito : PRODUCAO_PARA_DEPOSITO);
  const nomes = PRODUCAO_PARA_DEPOSITO; // posição a posição (igual às fórmulas da planilha)
  void rotulos;
  for (let i = iCab + 1; i < m.length; i++) {
    const l = m[i];
    if (!ehData(l[0])) continue;
    nomes.forEach((p, k) => { const q = numero(l[1 + k]); if (q && q > 0) out.push({ data: l[0], produto: p, quantidade: q, linha: aba.linhas[i] }); });
  }
}
