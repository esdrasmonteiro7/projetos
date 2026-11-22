// Monta o painel para a hospedagem sem servidor: Express + banco no Blobs + arquivos enviados no Blobs.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { createApp } from '../app.js';
import { hospedagem } from '../services/hospedagem.js';
import { redefinirSenhaPorVariavel } from '../services/redefinir-senha.js';
import { PersistenciaBlobs } from './persistencia.js';
import { criarManipulador } from './manipulador.js';

/**
 * @param opts.obterStore  () => store do Netlify Blobs (chamado a cada requisição)
 * @param opts.app         aplicativo Express (padrão: o painel completo)
 */
export function montarSemServidor({ obterStore, app = createApp(), persistencia: opPersistencia = {}, manipulador: opManipulador = {} }) {
  const persistencia = new PersistenciaBlobs({
    banco: db,
    lerLocal: (rel) => {
      try { return fs.readFileSync(path.join(config.uploadDir, rel)); } catch { return null; }
    },
    ...opPersistencia,
  });
  // os arquivos enviados (comprovantes, PDFs, planilhas) também vão para o Blobs
  hospedagem.aoSalvarArquivo = (rel) => persistencia.registrarArquivo(rel);
  hospedagem.buscarArquivo = (rel) => persistencia.obterArquivo(rel);
  hospedagem.info = () => persistencia.info();

  const manipulador = criarManipulador({ app, persistencia, db, obterStore, depoisDeSincronizar: redefinirSenhaPorVariavel, ...opManipulador });
  return { manipulador, persistencia };
}
