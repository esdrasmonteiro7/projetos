// Abre qualquer arquivo enviado e devolve "documentos" prontos para a prévia.
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { lerNFe } from './nfe.js';
import { lerOFX } from './ofx.js';
import { extrairPaginas, tabelaDePdf, lerComprovantePix } from './pdf.js';
import { prepararTabela } from './tabela.js';

export function decodificar(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf); // CSV do Excel brasileiro
  }
}

/** CSV com separador automático (; , tab |) e aspas. */
export function lerCSV(texto) {
  const amostra = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  const cont = (c) => amostra.map((l) => l.split(c).length - 1);
  let melhor = ';';
  let melhorN = -1;
  for (const c of [';', '\t', ',', '|']) {
    const n = cont(c);
    const consistente = n.length ? n.filter((x) => x === n[0]).length / n.length : 0;
    const score = (n[0] || 0) * (0.5 + consistente);
    if (n[0] > 0 && score > melhorN) { melhorN = score; melhor = c; }
  }
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === melhor) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      campo = '';
      if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
      linha = [];
      if (linhas.length > 50000) break;
    } else campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); if (linha.some((c) => c.trim() !== '')) linhas.push(linha); }
  return linhas;
}

function valorDaCelula(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return valorDaCelula(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
    return String(v);
  }
  return v;
}

async function lerXLSX(buffer, nomeArquivo) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const docs = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    const matriz = [];
    const colunas = Math.min(ws.columnCount || 0, 60);
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      if (n > 30000) return;
      const linha = [];
      for (let c = 1; c <= colunas; c++) linha.push(valorDaCelula(row.getCell(c).value));
      matriz.push(linha);
    });
    const util = matriz.filter((l) => l.some((c) => c !== null && String(c).trim() !== ''));
    if (util.length < 2) return;
    docs.push({ nome: `${nomeArquivo} · aba "${ws.name}"`, formato: 'xlsx', kind: 'tabela', aba: ws.name, matriz: util });
  });
  return docs;
}

/** Retorna lista de documentos: { nome, formato, kind: 'tabela'|'nfe'|'cancelamento_nfe'|'pix'|'ofx'|'erro', ... } */
export async function lerArquivo({ buffer, nome }, profundidade = 0) {
  const ext = path.extname(nome).toLowerCase();
  try {
    if (ext === '.zip') {
      if (profundidade > 0) return [{ nome, formato: 'zip', kind: 'erro', motivo: 'ZIP dentro de ZIP não é aceito.' }];
      const zip = await JSZip.loadAsync(buffer);
      const entradas = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name) && /\.(xml|pdf|csv|tsv|xlsx|xlsm|ofx|txt)$/i.test(f.name));
      if (entradas.length > 800) return [{ nome, formato: 'zip', kind: 'erro', motivo: 'ZIP com arquivos demais (máximo 800).' }];
      let total = 0;
      const docs = [];
      for (const e of entradas) {
        const buf = await e.async('nodebuffer');
        total += buf.length;
        if (total > 300 * 1024 * 1024) { docs.push({ nome, formato: 'zip', kind: 'erro', motivo: 'Conteúdo do ZIP grande demais.' }); break; }
        docs.push(...(await lerArquivo({ buffer: buf, nome: path.basename(e.name) }, profundidade + 1)));
      }
      if (!docs.length) docs.push({ nome, formato: 'zip', kind: 'erro', motivo: 'Nenhum arquivo aproveitável dentro do ZIP.' });
      return docs;
    }
    if (ext === '.xlsx' || ext === '.xlsm') {
      const docs = await lerXLSX(buffer, nome);
      return docs.length ? docs : [{ nome, formato: 'xlsx', kind: 'erro', motivo: 'A planilha está vazia ou só tem abas ocultas.' }];
    }
    if (ext === '.xls') {
      return [{ nome, formato: 'xls', kind: 'erro', motivo: 'Planilha .xls (formato antigo). Abra no Excel e use "Salvar como" → Pasta de Trabalho do Excel (.xlsx) ou CSV, e envie de novo.' }];
    }
    if (ext === '.xml') {
      const r = lerNFe(decodificar(buffer));
      if (!r.ok) return [{ nome, formato: 'xml', kind: 'erro', motivo: r.motivo }];
      return [{ nome, formato: 'xml', kind: r.tipo === 'cancelamento' ? 'cancelamento_nfe' : 'nfe', nfe: r }];
    }
    if (ext === '.ofx') {
      const r = lerOFX(decodificar(buffer));
      return r.ok ? [{ nome, formato: 'ofx', kind: 'ofx', ofx: r }] : [{ nome, formato: 'ofx', kind: 'erro', motivo: r.motivo }];
    }
    if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
      const texto = decodificar(buffer);
      if (/<OFX>|OFXHEADER/i.test(texto.slice(0, 2000))) {
        const r = lerOFX(texto);
        return r.ok ? [{ nome, formato: 'ofx', kind: 'ofx', ofx: r }] : [{ nome, formato: 'ofx', kind: 'erro', motivo: r.motivo }];
      }
      const matriz = lerCSV(texto);
      if (matriz.length < 2) return [{ nome, formato: 'csv', kind: 'erro', motivo: 'O arquivo está vazio ou não parece uma tabela.' }];
      return [{ nome, formato: 'csv', kind: 'tabela', matriz }];
    }
    if (ext === '.pdf') {
      const paginas = await extrairPaginas(buffer);
      const comTexto = paginas.filter((p) => p.itens.length > 0);
      if (!comTexto.length) {
        return [{ nome, formato: 'pdf', kind: 'erro', motivo: 'Este PDF é uma imagem (escaneado/foto) e não tem texto para ler. Envie o PDF original do sistema ou do banco, ou use o lançamento manual.' }];
      }
      const recibos = comTexto.map((p) => lerComprovantePix(p)).filter(Boolean);
      if (recibos.length && recibos.length >= comTexto.length * 0.5) {
        return [{ nome, formato: 'pdf', kind: 'pix', recibos }];
      }
      const matriz = tabelaDePdf(comTexto);
      if (!matriz || matriz.length < 2) return [{ nome, formato: 'pdf', kind: 'erro', motivo: 'Não encontrei uma tabela de dados nesse PDF.' }];
      return [{ nome, formato: 'pdf', kind: 'tabela', matriz }];
    }
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      return [{ nome, formato: 'imagem', kind: 'erro', motivo: 'Imagens ainda não são lidas automaticamente. Use o PDF original do comprovante ou lance manualmente.' }];
    }
    return [{ nome, formato: ext.replace('.', '') || 'arquivo', kind: 'erro', motivo: 'Tipo de arquivo não suportado. Use PDF, XML (NF-e), XLSX, CSV, OFX ou ZIP.' }];
  } catch (e) {
    return [{ nome, formato: ext.replace('.', ''), kind: 'erro', motivo: e.message || 'Não consegui ler este arquivo.' }];
  }
}

export { prepararTabela };
