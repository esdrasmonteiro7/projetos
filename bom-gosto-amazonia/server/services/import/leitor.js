// Abre qualquer arquivo enviado e devolve "documentos" prontos para a prévia.
import path from 'node:path';
import JSZip from 'jszip';
import { lerNFe } from './nfe.js';
import { lerOFX } from './ofx.js';
import { extrairPaginas, tabelaDePdf, lerComprovantePix } from './pdf.js';
import { lerRelatorio } from './relatorios.js';
import { prepararTabela } from './tabela.js';
import { lerXlsx } from './xlsx.js';
import { reconhecerPlanilha } from './perfis-bomgosto.js';

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

async function lerXLSX(buffer, nomeArquivo) {
  const abas = await lerXlsx(buffer, { formulas: true });
  // planilhas que a própria empresa usa (Lista de Devedores / Controle): leitura própria, com atualização do que já existe
  const perfil = reconhecerPlanilha(abas);
  if (perfil) return [{ nome: nomeArquivo, formato: 'xlsx', kind: 'empresa', perfil, abas }];
  return abas
    .filter((a) => a.matriz.length >= 2)
    .map((a) => ({ nome: `${nomeArquivo} · aba "${a.nome}"`, formato: 'xlsx', kind: 'tabela', aba: a.nome, matriz: a.matriz }));
}

/** Retorna lista de documentos: { nome, formato, kind: 'tabela'|'nfe'|'cancelamento_nfe'|'pix'|'ofx'|'erro', ... } */
export async function lerArquivo({ buffer, nome }, profundidade = 0) {
  const ext = path.extname(nome).toLowerCase();
  try {
    if (ext === '.zip') {
      if (profundidade > 0) return [{ nome, formato: 'zip', kind: 'erro', motivo: 'ZIP dentro de ZIP não é aceito.' }];
      const zip = await JSZip.loadAsync(buffer);
      const entradas = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name) && /\.(xml|pdf|csv|tsv|xlsx|xlsm|ofx|txt)$/i.test(f.name) && !/conte.{1,8}do desta pasta\.txt$/i.test(f.name)); // (o sistema de notas põe um "Conteúdo desta pasta.txt" em cada ZIP)
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
      // relatórios que a empresa tira do sistema e do banco: leitura própria (por posição das colunas)
      const rel = lerRelatorio(comTexto);
      if (rel) {
        if (rel.motivo) return [{ nome, formato: 'pdf', kind: 'erro', motivo: rel.motivo }];
        if (!rel.linhas.length) return [{ nome, formato: 'pdf', kind: 'erro', motivo: 'Reconheci o relatório, mas não encontrei nenhuma linha para ler.' }];
        return [{ nome, formato: 'pdf', kind: 'relatorio', relatorio: rel }];
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
