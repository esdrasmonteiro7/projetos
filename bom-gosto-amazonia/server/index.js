import { config } from './config.js';
import { createApp } from './app.js';
import { closeDb } from './db.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`\n  Painel Bom Gosto da Amazônia no ar: http://localhost:${config.port}`);
  console.log(`  Dados em: ${config.dataDir}${config.isProd && !config.setupCode ? '\n  ATENÇÃO: defina SETUP_CODE para liberar o primeiro acesso.' : ''}\n`);
});

function parar() {
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', parar);
process.on('SIGINT', parar);
