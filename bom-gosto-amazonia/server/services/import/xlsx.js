// Leitor de planilhas .xlsx/.xlsm próprio (JSZip + fast-xml-parser).
//
// Por que não usar o ExcelJS aqui: ele "trava" com planilhas geradas por alguns programas (ex.: Python/openpyxl com
// comentários nas células: "Cannot read properties of undefined (reading 'comments')") e o painel não conseguia nem abrir
// o arquivo. Este leitor só precisa do essencial — texto, números, datas, valores guardados das fórmulas — e ignora o resto
// (estilos, comentários, imagens, gráficos), então não quebra por causa deles.
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const MAX_LINHAS = 30000;
const MAX_COLUNAS = 60;
const TAMANHO_MAX_PARTE = 80 * 1024 * 1024; // proteção contra "zip bomba"

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true, // &#199; vira Ç (a planilha guarda acentos assim)
  isArray: (nome) => ['sheet', 'Relationship', 'si', 'r', 'row', 'c', 'xf', 'numFmt', 'mergeCell'].includes(nome),
});

const texto = (n) => {
  if (n === undefined || n === null) return '';
  if (typeof n === 'object') return Array.isArray(n) ? n.map(texto).join('') : n['#text'] !== undefined ? String(n['#text']) : '';
  return String(n);
};

/** Texto de um item de "sharedStrings" ou de uma célula inlineStr (ignora a pronúncia fonética <rPh>). */
function textoDeItem(si) {
  if (!si) return '';
  if (si.t !== undefined) return texto(si.t);
  if (Array.isArray(si.r)) return si.r.map((r) => texto(r.t)).join('');
  return '';
}

// ------------------------------------------------------------------ datas
const FORMATOS_DATA_NATIVOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function ehFormatoData(codigo) {
  const c = String(codigo || '').replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!h|m|s)[^\]]*\]/gi, '').replace(/_./g, '').replace(/\*./g, '');
  return /[dmyhs]/i.test(c);
}
function serialParaISO(serial, sistema1904) {
  if (!Number.isFinite(serial)) return null;
  const dias = Math.floor(serial + 1e-9);
  const base = sistema1904 ? Date.UTC(1904, 0, 1) : serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30); // o Excel conta um 29/02/1900 que não existe
  const d = new Date(base + dias * 86400000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ fórmulas só com contas (ex.: =11180*2)
/** Calcula contas simples (+ - * / e parênteses). Qualquer outra coisa (referência a célula, função) devolve null. */
export function calcularConta(formula) {
  const s = String(formula || '').replace(/\s+/g, '');
  if (!s || !/^[0-9+\-*/().,]+$/.test(s) || s.length > 200) return null;
  const toks = s.replace(/,/g, '.').match(/\d+(?:\.\d+)?|[+\-*/()]/g);
  if (!toks || toks.join('') !== s.replace(/,/g, '.')) return null;
  let i = 0;
  const expr = () => {
    let v = termo();
    while (toks[i] === '+' || toks[i] === '-') { const op = toks[i++]; const t = termo(); v = op === '+' ? v + t : v - t; }
    return v;
  };
  const termo = () => {
    let v = fator();
    while (toks[i] === '*' || toks[i] === '/') { const op = toks[i++]; const f = fator(); v = op === '*' ? v * f : v / f; }
    return v;
  };
  const fator = () => {
    if (toks[i] === '-') { i++; return -fator(); }
    if (toks[i] === '+') { i++; return fator(); }
    if (toks[i] === '(') { i++; const v = expr(); if (toks[i++] !== ')') throw new Error('x'); return v; }
    const n = Number(toks[i++]);
    if (!Number.isFinite(n)) throw new Error('x');
    return n;
  };
  try {
    const v = expr();
    return i === toks.length && Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ leitura
const colunaDe = (ref) => {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const caminho = (alvo, base = 'xl/') => {
  const t = String(alvo || '');
  return t.startsWith('/') ? t.slice(1) : `${base}${t}`.replace(/[^/]+\/\.\.\//g, '');
};

async function parte(zip, nome) {
  const f = zip.file(nome);
  if (!f) return null;
  const texto = await f.async('string');
  if (texto.length > TAMANHO_MAX_PARTE) throw new Error('A planilha tem uma parte grande demais para ser lida.');
  return texto;
}

/**
 * Lê todas as abas VISÍVEIS. Devolve [{ nome, matriz, linhas, formulas }]:
 *  - matriz: lista de linhas (só as que têm algum valor); cada linha é uma lista de valores por coluna
 *    (texto, número, "AAAA-MM-DD" para datas, ou null);
 *  - linhas: o número da linha original na planilha de cada linha da matriz (para ligar com fórmulas e mensagens);
 *  - formulas: { "AU21": "SUM(AK541:AK542)" } — só quando pedido com { formulas: true }.
 */
export async function lerXlsx(buffer, { formulas: querFormulas = false } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await parte(zip, 'xl/workbook.xml');
  if (!wbXml) throw new Error('Este arquivo não parece uma planilha do Excel (.xlsx).');
  const wb = xml.parse(wbXml).workbook || {};
  const sistema1904 = wb.workbookPr?.['@_date1904'] === '1' || wb.workbookPr?.['@_date1904'] === 'true';
  const abas = [].concat(wb.sheets?.sheet || []);
  const rels = {};
  const relXml = await parte(zip, 'xl/_rels/workbook.xml.rels');
  if (relXml) for (const r of [].concat(xml.parse(relXml).Relationships?.Relationship || [])) rels[r['@_Id']] = r['@_Target'];

  // textos compartilhados
  const textos = [];
  const ssXml = await parte(zip, 'xl/sharedStrings.xml');
  if (ssXml) for (const si of [].concat(xml.parse(ssXml).sst?.si || [])) textos.push(textoDeItem(si));

  // quais estilos são de data
  const estiloEData = [];
  const stXml = await parte(zip, 'xl/styles.xml');
  if (stXml) {
    const st = xml.parse(stXml).styleSheet || {};
    const codigos = {};
    for (const nf of [].concat(st.numFmts?.numFmt || [])) codigos[nf['@_numFmtId']] = nf['@_formatCode'];
    for (const xf of [].concat(st.cellXfs?.xf || [])) {
      const id = Number(xf['@_numFmtId'] || 0);
      estiloEData.push(FORMATOS_DATA_NATIVOS.has(id) || (id >= 164 && ehFormatoData(codigos[id])));
    }
  }

  const resultado = [];
  for (const aba of abas) {
    const estado = aba['@_state'];
    if (estado && estado !== 'visible') continue;
    const alvo = rels[aba['@_id']];
    if (!alvo) continue;
    const sheetXml = await parte(zip, caminho(alvo));
    if (!sheetXml) continue;
    const ws = xml.parse(sheetXml).worksheet || {};
    const linhas = [];
    const numeros = [];
    const formulas = {};
    let maxCol = 0;
    let seq = 0;
    for (const row of [].concat(ws.sheetData?.row || [])) {
      const nLinha = Number(row['@_r']) || seq + 1;
      seq = nLinha;
      if (nLinha > MAX_LINHAS) break;
      const celulas = [];
      let temValor = false;
      let colSeq = -1;
      for (const c of row.c || []) {
        let col = colunaDe(c['@_r']);
        if (col < 0) col = colSeq + 1;
        colSeq = col;
        if (col >= MAX_COLUNAS) continue;
        const v = leitorDeCelula(c, textos, estiloEData, sistema1904);
        if (querFormulas && c.f !== undefined && c['@_r']) { const ft = texto(c.f); if (ft) formulas[c['@_r']] = ft; }
        if (v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '')) {
          celulas[col] = v;
          temValor = true;
          if (col + 1 > maxCol) maxCol = col + 1;
        }
      }
      if (temValor) { linhas.push(celulas); numeros.push(nLinha); }
    }
    if (linhas.length) resultado.push({ nome: aba['@_name'], matriz: linhas.map((l) => Array.from({ length: maxCol }, (_, i) => (l[i] === undefined ? null : l[i]))), linhas: numeros, ...(querFormulas ? { formulas } : {}) });
  }
  return resultado;
}

function leitorDeCelula(c, textos, estiloEData, sistema1904) {
  const tipo = c['@_t'];
  const bruto = c.v !== undefined ? texto(c.v) : undefined;
  if (tipo === 'inlineStr') return textoDeItem(c.is);
  if (tipo === 's') return bruto === undefined ? null : (textos[Number(bruto)] ?? null);
  if (tipo === 'str') return bruto ?? null;
  if (tipo === 'b') return bruto === '1' || bruto === 'true' ? 'Sim' : 'Não';
  if (tipo === 'e') return null; // #N/A, #REF! etc.
  if (tipo === 'd') return bruto ? bruto.slice(0, 10) : null;
  if (bruto === undefined || bruto === '') {
    // fórmula sem resultado guardado (arquivos gerados por programas): só aproveitamos contas simples como =11180*2
    return c.f !== undefined ? calcularConta(texto(c.f)) : null;
  }
  const n = Number(bruto);
  if (!Number.isFinite(n)) return bruto;
  if (estiloEData[Number(c['@_s'] || 0)]) return serialParaISO(n, sistema1904);
  return n;
}
