// Configuração central. Tudo vem de variáveis de ambiente (ver .env.example).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pasta do projeto. Na Netlify o código é empacotado num arquivo só, então ali a pasta vem de PAINEL_ROOT (ver serverless/ambiente.js).
const root = process.env.PAINEL_ROOT ? path.resolve(process.env.PAINEL_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carrega .env se existir (uso local). Em hospedagem, use as variáveis do painel do serviço.
try {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
} catch { /* ignora .env inválido */ }

function validTZ(tz) {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}

const env = process.env;
const tzEnv = env.TZ && validTZ(env.TZ) && env.TZ !== 'UTC' ? env.TZ : null;

export const config = {
  root,
  isProd: env.NODE_ENV === 'production',
  // Hospedagem "sem servidor" (Netlify Functions): o disco é temporário e o banco fica guardado no Netlify Blobs.
  // Ligado pelo arquivo netlify/functions/_ambiente.mjs; no modo normal (computador/Docker) fica desligado.
  serverless: env.PAINEL_SERVERLESS === '1',
  port: Number(env.PORT) || 3000,
  dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
  setupCode: env.SETUP_CODE || '',
  defaultTZ: tzEnv || 'America/Manaus',
  // Na Netlify cada requisição aceita no máximo ~6 MB (limite da plataforma), então o padrão é menor.
  maxUploadMB: Number(env.MAX_UPLOAD_MB) || (env.PAINEL_SERVERLESS === '1' ? 5 : 30),
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
};

config.uploadDir = path.join(config.dataDir, 'uploads');
config.dbPath = path.join(config.dataDir, 'painel.db');
fs.mkdirSync(config.uploadDir, { recursive: true });
