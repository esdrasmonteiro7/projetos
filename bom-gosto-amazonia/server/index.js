import crypto from 'node:crypto';
import { config } from './config.js';
import { createApp } from './app.js';
import { db, closeDb, backupRemoto, getSetting, setSetting } from './db.js';
import { hashPassword } from './auth.js';

// Recuperação de acesso em hospedagens sem terminal (ex.: Render grátis):
// defina REDEFINIR_SENHA_EMAIL e REDEFINIR_SENHA_NOVA, reinicie, entre, e DEPOIS apague as duas variáveis.
// Só vale uma vez para cada par e-mail/senha (não repete a cada reinício).
async function redefinirSenhaPorVariavel() {
  const email = (process.env.REDEFINIR_SENHA_EMAIL || '').trim().toLowerCase();
  const nova = process.env.REDEFINIR_SENHA_NOVA || '';
  if (!email || !nova) return;
  const marca = crypto.createHash('sha256').update(`${email}|${nova}`).digest('hex');
  if (getSetting('reset_senha_aplicado', '') === marca) return;
  const u = db.get('SELECT id, nome FROM usuarios WHERE email = ?', email);
  if (!u) { console.error(`[senha] Nenhum usuário com o e-mail ${email}.`); return; }
  if (nova.length < 8) { console.error('[senha] REDEFINIR_SENHA_NOVA precisa ter pelo menos 8 caracteres.'); return; }
  db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, ativo = 1 WHERE id = ?', await hashPassword(nova), u.id);
  db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.id);
  setSetting('reset_senha_aplicado', marca);
  db.run("INSERT INTO auditoria (usuario_nome, acao, entidade, entidade_id) VALUES ('Servidor', 'Senha redefinida por variável de ambiente', 'usuario', ?)", u.id);
  console.log(`[senha] Senha de ${u.nome} (${email}) redefinida. Entre com a senha provisória e APAGUE as variáveis REDEFINIR_SENHA_*.`);
}
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
