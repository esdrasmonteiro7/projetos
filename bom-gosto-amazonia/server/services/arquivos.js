// Guarda os arquivos enviados (PDF, planilhas, XML, comprovantes) no disco, sem repetir o mesmo arquivo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';

const EXT_OK = new Set(['.pdf', '.xml', '.csv', '.tsv', '.txt', '.xlsx', '.xlsm', '.xls', '.ofx', '.zip', '.png', '.jpg', '.jpeg', '.webp']);

export function extensaoSegura(nome) {
  const ext = path.extname(String(nome || '')).toLowerCase();
  return EXT_OK.has(ext) ? ext : '';
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Salva o arquivo (se ainda não existir) e registra em `arquivos`. */
export function salvarArquivo({ buffer, nome, mime, user_id }) {
  const hash = sha256(buffer);
  const ext = extensaoSegura(nome);
  const rel = path.join(hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
  const abs = path.join(config.uploadDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buffer, { mode: 0o640 });
  const nomeLimpo = path.basename(String(nome || 'arquivo')).replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'arquivo';
  const r = db.run(
    'INSERT INTO arquivos (nome_original, hash, tamanho, mime, caminho, criado_por) VALUES (?,?,?,?,?,?)',
    nomeLimpo, hash, buffer.length, mime || null, rel, user_id || null,
  );
  return { id: r.id, hash, caminho: rel };
}

const MIME_POR_EXT = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.xml': 'application/xml', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.txt': 'text/plain', '.ofx': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel', '.zip': 'application/zip',
};
const INLINE_OK = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

/** Comprovantes só podem ser PDF ou imagem. */
export function exigirComprovante(file) {
  const ext = extensaoSegura(file?.originalname);
  if (!['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const e = new Error('O comprovante precisa ser um PDF ou uma imagem (PNG/JPG).');
    e.status = 400;
    throw e;
  }
}

/** Envia o arquivo com tipo decidido pelo servidor (nunca pelo que o usuário declarou). */
export function enviarArquivo(res, a, { inline = true } = {}) {
  const tipo = MIME_POR_EXT[path.extname(a.caminho).toLowerCase()] || 'application/octet-stream';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.type(tipo);
  res.setHeader('Content-Disposition', `${inline && INLINE_OK.has(tipo) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`);
  res.sendFile(a.abs);
}

export function abrirArquivo(id) {
  const a = db.get('SELECT * FROM arquivos WHERE id = ?', id);
  if (!a) return null;
  const abs = path.resolve(config.uploadDir, a.caminho);
  if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep)) return null; // nunca sai da pasta de uploads
  if (!fs.existsSync(abs)) return null;
  return { ...a, abs };
}
