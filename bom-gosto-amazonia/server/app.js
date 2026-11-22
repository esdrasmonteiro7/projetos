import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config.js';
import { HttpError } from './lib/http.js';
import { sessionMiddleware, csrfProtect } from './auth.js';
import { router as acesso } from './routes/acesso.js';
import { router as cadastros } from './routes/cadastros.js';
import { router as financeiro } from './routes/financeiro.js';
import { router as deposito } from './routes/deposito.js';
import { router as admin } from './routes/admin.js';
import { router as importacoes } from './routes/importacoes.js';
import { router as relatorios } from './routes/relatorios.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.isProd ? { maxAge: 15552000 } : false,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', sessionMiddleware, csrfProtect);
  for (const r of [acesso, cadastros, financeiro, deposito, admin, importacoes, relatorios]) app.use('/api', r);
  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  app.use('/fonts', express.static(path.join(config.root, 'public', 'fonts'), { maxAge: '30d', immutable: true }));
  app.use('/shared', express.static(path.join(config.root, 'shared'), { maxAge: 0, etag: true }));
  app.use(express.static(path.join(config.root, 'public'), { maxAge: 0, etag: true, index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError || (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500)) {
      return res.status(err.status).json({ erro: err.message, ...(err.extra || {}) });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: `Arquivo grande demais (máximo ${config.maxUploadMB} MB).` });
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ erro: 'Quantidade de arquivos acima do permitido.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados inválidos enviados ao servidor.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ erro: 'Dados grandes demais.' });
    const msg = String(err?.message || '');
    if (msg.includes('FOREIGN KEY')) return res.status(409).json({ erro: 'Não foi possível: existem registros ligados a este item.' });
    if (msg.includes('UNIQUE')) return res.status(409).json({ erro: 'Já existe um registro igual a este.' });
    console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ erro: 'Erro interno. Tente novamente; se continuar, avise o suporte.' });
  });
  return app;
}
