// Leitura de PDFs com texto: tabelas (relatórios, extratos) e comprovantes de Pix.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseDate } from '../../../shared/dates.js';
import { parseMoney } from '../../../shared/money.js';
import { digits } from '../../../shared/text.js';
import { acharCabecalho } from './tabela.js';

export async function extrairPaginas(buffer) {
  let doc;
  let tarefa;
  try {
    tarefa = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
    doc = await tarefa.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('Este PDF tem senha. Abra-o, salve sem senha e envie de novo.');
    throw new Error('Não consegui abrir este PDF (arquivo corrompido?).');
  }
  const paginas = [];
  const total = Math.min(doc.numPages, 300);
  for (let p = 1; p <= total; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const itens = tc.items
      .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || i.height || 10 }));
    paginas.push({ numero: p, itens, linhas: montarLinhas(itens) });
  }
  await tarefa.destroy();
  return paginas;
}

function montarCelulas(L) {
  const limite = Math.max(4, L.h * 0.75);
  const cels = [];
  let cur = null;
  for (const it of L.itens) {
    if (cur && it.x - cur.x1 <= limite) {
      const gap = it.x - cur.x1;
      cur.texto += (gap > L.h * 0.12 && !cur.texto.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      cur.x1 = Math.max(cur.x1, it.x + it.w);
    } else {
      cur = { x0: it.x, x1: it.x + it.w, texto: it.str };
      cels.push(cur);
    }
  }
  for (const c of cels) c.texto = c.texto.replace(/\s+/g, ' ').trim();
  return cels.filter((c) => c.texto);
}

export function montarLinhas(itens) {
  const ord = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas = [];
  for (const it of ord) {
    const atual = linhas[linhas.length - 1];
    if (atual && Math.abs(atual.y - it.y) <= Math.max(2, it.h * 0.45)) {
      atual.itens.push(it);
      atual.h = Math.max(atual.h, it.h);
    } else linhas.push({ y: it.y, h: it.h, itens: [it] });
  }
  for (const L of linhas) {
    L.itens.sort((a, b) => a.x - b.x);
    L.celulas = montarCelulas(L);
    L.texto = L.celulas.map((c) => c.texto).join(' ');
  }
  return linhas.filter((L) => L.celulas.length);
}

// ------------------------------------------------------------------ tabela
const RODAPE = /^(p[aá]gina|pag\.?|page)\s*\d+|^\d+\s*(\/|de)\s*\d+$|emitid[oa] em|gerado em|impress[aã]o|^www\.|^https?:/i;

export function tabelaDePdf(paginas) {
  const linhas = [];
  for (const p of paginas) for (const L of p.linhas) linhas.push(L);
  if (!linhas.length) return null;
  const hIdx = acharCabecalho(linhas.map((L) => L.celulas.map((c) => c.texto)));
  const cab = hIdx >= 0 ? linhas[hIdx] : null;
  const regiao = linhas.slice(hIdx + 1).filter((L) => !(L.celulas.length === 1 && RODAPE.test(L.texto)));
  // as colunas nascem das linhas de DADOS (o cabeçalho pode estar alinhado diferente dos valores)
  const dados = regiao.filter((L) => L.celulas.length >= 2 && !/^(total|subtotal|soma|totais)\b/i.test(L.texto) && !/^[^:]{2,25}:\s/.test(L.celulas[0].texto));
  const base = dados.length ? dados : cab ? [cab] : [];
  const intervalos = [];
  for (const L of base) for (const c of L.celulas) intervalos.push([c.x0, c.x1]);
  if (!intervalos.length) return null;
  const tol = 1.5;
  const fundir = (lista) => {
    const ord = [...lista].sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, b] of ord) {
      const ult = out[out.length - 1];
      if (ult && a <= ult[1] + tol) ult[1] = Math.max(ult[1], b);
      else out.push([a, b]);
    }
    return out;
  };
  let bandas = fundir(intervalos);
  const distancia = (c, [a, b]) => {
    const centro = (c.x0 + c.x1) / 2;
    return centro >= a - tol && centro <= b + tol ? 0 : Math.min(Math.abs(centro - a), Math.abs(centro - b), Math.abs(c.x0 - b), Math.abs(c.x1 - a));
  };
  const maisProxima = (c) => {
    let melhor = 0;
    let dist = Infinity;
    bandas.forEach((bd, i) => { const d = distancia(c, bd); if (d < dist) { dist = d; melhor = i; } });
    return { i: melhor, dist };
  };
  // títulos de coluna sem dados por perto ganham coluna própria
  if (cab && dados.length) {
    const orfas = cab.celulas.filter((c) => maisProxima(c).dist > 28).map((c) => [c.x0, c.x1]);
    if (orfas.length) bandas = fundir([...bandas, ...orfas]);
  }
  const paraLinha = (L) => {
    const row = Array(bandas.length).fill('');
    for (const c of L.celulas) {
      const { i } = maisProxima(c);
      row[i] = row[i] ? `${row[i]} ${c.texto}` : c.texto;
    }
    return row;
  };
  const matriz = [];
  if (cab) matriz.push(paraLinha(cab));
  for (const L of regiao) matriz.push(paraLinha(L));
  if (!cab) matriz.unshift(Array.from({ length: bandas.length }, (_, i) => `Coluna ${i + 1}`));
  return matriz;
}

// ------------------------------------------------------------------ comprovante de Pix
const RE_E2E = /\b[ED]\d{8}\d{12}[A-Za-z0-9]{11}\b/;
const SEC_ORIGEM = /^(origem|dados de quem pagou|quem pagou|pagador|remetente|enviado por|dados do pagador|de)\s*:?$/i;
const SEC_DESTINO = /^(destino|dados de quem recebeu|quem recebeu|favorecido|benefici[aá]rio|recebedor|destinat[aá]rio|dados do recebedor|para)\s*:?$/i;

function dataDoTexto(texto) {
  let m = texto.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})(?:\s*(?:[-–às,]|as|às)?\s*(\d{2}:\d{2}(?::\d{2})?))?/i);
  if (m) return { data: parseDate(m[1]), hora: m[2] || null };
  m = texto.match(/\b(\d{1,2}\s*(?:de\s+)?(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\s*(?:de\s+)?\d{4})(?:\s*(?:[-–às,]|as)?\s*(\d{2}:\d{2}(?::\d{2})?))?/i);
  if (m) return { data: parseDate(m[1]), hora: m[2] || null };
  return { data: null, hora: null };
}

function valorDoTexto(flat) {
  const rotulo = /^(valor(?:\s+(?:pago|da\s+transfer[eê]ncia|transferido|do\s+pix|enviado|recebido|total))?|total|valor\s*\(r\$\))\s*:?\s*(.*)$/i;
  for (let i = 0; i < flat.length; i++) {
    const m = flat[i].match(rotulo);
    if (!m) continue;
    const mesma = (m[2] || '').match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (mesma) return parseMoney(mesma[1]);
    const prox = (flat[i + 1] || '').match(/^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})$/);
    if (prox) return parseMoney(prox[1]);
  }
  const todos = [...flat.join('\n').matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map((x) => parseMoney(x[1])).filter((v) => v > 0);
  return todos.length ? todos[0] : null;
}

function secao(flat, regex, outra) {
  const i = flat.findIndex((l) => regex.test(l.trim()));
  if (i < 0) return null;
  let fim = flat.length;
  for (let j = i + 1; j < flat.length; j++) if (outra.test(flat[j].trim())) { fim = j; break; }
  return flat.slice(i + 1, Math.min(fim, i + 9));
}

function dadosDaSecao(linhas) {
  if (!linhas) return null;
  let nome = null;
  let documento = null;
  let banco = null;
  for (const l of linhas) {
    let m;
    if (!nome && (m = l.match(/^nome(?:\s+completo)?\s*:?\s*(.+)$/i))) nome = m[1].trim();
    else if (!documento && (m = l.match(/(?:cpf|cnpj|cpf\/cnpj|documento)\s*:?\s*([\d.\-/*•x]{6,})/i))) documento = m[1].trim();
    else if (!banco && (m = l.match(/^(?:institui[cç][aã]o|banco)\s*:?\s*(.+)$/i))) banco = m[1].trim();
  }
  if (!nome) {
    const cand = linhas.find((l) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'. &-]{3,80}$/.test(l) && l.trim().split(/\s+/).length >= 2 && !/^(cpf|cnpj|ag[eê]ncia|conta|institui|banco|tipo|chave)/i.test(l));
    if (cand) nome = cand.trim();
  }
  return { nome, documento, banco };
}

/** Tenta entender uma página como comprovante de Pix. Retorna null se não parecer. */
export function lerComprovantePix(pagina) {
  const flat = pagina.linhas.map((L) => L.celulas.map((c) => c.texto).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const texto = flat.join('\n');
  if (!/pix/i.test(texto) && !RE_E2E.test(texto)) return null;
  const tabelar = pagina.linhas.filter((L) => L.celulas.length >= 4).length;
  const e2eMatch = texto.match(RE_E2E);
  const pareceComprovante = (e2eMatch || (/comprovante|recibo/i.test(texto) && /pix/i.test(texto))) && tabelar < 6;
  if (!pareceComprovante) return null;
  const valor = valorDoTexto(flat);
  if (!valor) return null;
  const { data, hora } = dataDoTexto(texto);
  const origem = dadosDaSecao(secao(flat, SEC_ORIGEM, SEC_DESTINO));
  const destino = dadosDaSecao(secao(flat, SEC_DESTINO, SEC_ORIGEM));
  let e2e = e2eMatch ? e2eMatch[0] : null;
  if (!e2e) {
    const i = flat.findIndex((l) => /id\s*(?:da\s*)?transa[cç][aã]o|end\s*to\s*end|e2e|c[oó]digo de identifica[cç][aã]o/i.test(l));
    if (i >= 0) {
      const m = (flat[i] + ' ' + (flat[i + 1] || '')).match(/\b([A-Za-z0-9]{20,40})\b/);
      if (m) e2e = m[1];
    }
  }
  return { valor_centavos: valor, data, hora, pagador: origem, favorecido: destino, e2e, pagina: pagina.numero };
}

export const apenasDigitos = digits;
