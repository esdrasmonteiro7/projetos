import { config } from './config.js';
import { createApp } from './app.js';
import { closeDb, backupRemoto } from './db.js';
import { redefinirSenhaPorVariavel } from './services/redefinir-senha.js';

await redefinirSenhaPorVariavel();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`\n  Painel Bom Gosto da Amazônia no ar: http://localhost:${config.port}`);
  console.log(`  Dados em: ${config.dataDir}`);
  console.log(`  Backup externo (GitHub): ${backupRemoto.ativo ? `LIGADO (${backupRemoto.cfg.repo})` : 'desligado'}`);
  if (config.isProd && !config.setupCode) console.log('  ATENÇÃO: defina SETUP_CODE para liberar o primeiro acesso.');
  console.log('');
});

let parando = false;
async function parar() {
  if (parando) return;
  parando = true;
  server.close();
  server.closeIdleConnections?.();
  try {
    await Promise.race([backupRemoto.finalizar(), new Promise((r) => setTimeout(r, 20000))]);
  } catch (e) {
    console.error('[backup] erro no backup final:', e.message);
  }
  closeDb();
  process.exit(0);
}
process.on('SIGTERM', parar);
process.on('SIGINT', parar);
