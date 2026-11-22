// Login, primeiro acesso, troca de senha e gestão de usuários.
import crypto from 'node:crypto';
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { config } from '../config.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH, checkPasswordRules, createSession, destroySession, destroyUserSessions,
  currentTokenHash, loginLimiter, requireAuth, requireAdmin, audit,
} from '../auth.js';
import { HttpError, bad, conflict, notFound, str, int, oneOf, flag } from '../lib/http.js';

export const router = Router();

const publicUser = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, vendedor_id: u.vendedor_id, trocar_senha: !!u.trocar_senha });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

router.get('/sessao', (req, res) => {
  const total = db.get('SELECT COUNT(*) AS n FROM usuarios').n;
  res.json({
    usuario: req.user ? publicUser(req.user) : null,
    csrf: req.user ? req.csrf : null,
    precisa_setup: total === 0,
    setup_requer_codigo: config.isProd || !!config.setupCode,
    empresa: getSetting('empresa_nome', 'Bom Gosto da Amazônia'),
    // hospedagem sem servidor (Netlify) aceita ~6 MB por envio: a tela divide os arquivos em lotes
    limite_envio_mb: config.serverless ? 4.5 : null,
  });
});

router.post('/setup', async (req, res) => {
  if (db.get('SELECT COUNT(*) AS n FROM usuarios').n > 0) throw new HttpError(403, 'O sistema já foi configurado.');
  const limiteKey = `setup|${req.ip}`;
  loginLimiter.check(limiteKey);
  if (config.isProd && !config.setupCode) {
    throw new HttpError(500, 'Falta configurar SETUP_CODE no servidor (veja o README). Por segurança o primeiro acesso está bloqueado.');
  }
  if (config.setupCode) {
    const a = Buffer.from(String(req.body.codigo || ''));
    const b = Buffer.from(config.setupCode);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      loginLimiter.hit(limiteKey);
      throw new HttpError(403, 'Código de instalação incorreto.');
    }
  }
  const nome = str(req.body.nome, { required: true, name: 'nome', max: 120 });
  const email = str(req.body.email, { required: true, name: 'e-mail', max: 160 }).toLowerCase();
  if (!emailOk(email)) throw bad('E-mail inválido.');
  checkPasswordRules(req.body.senha);
  const r = db.run('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?,?,?,?)', nome, email, await hashPassword(req.body.senha), 'admin');
  const csrf = createSession(req, res, r.id, true);
  audit({ ...req, user: { id: r.id, nome } }, 'Primeiro acesso: administrador criado', 'usuario', r.id);
  res.json({ ok: true, csrf, usuario: { id: r.id, nome, email, papel: 'admin', vendedor_id: null, trocar_senha: false } });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  if (!email || !senha) throw bad('Informe e-mail e senha.');
  const keyIp = `ip|${req.ip}`;
  const keyUser = `${req.ip}|${email}`;
  loginLimiter.check(keyUser);
  loginLimiter.check(keyIp, 60); // por IP o limite é maior (atrás de proxy, vários usuários podem aparecer com o mesmo IP)
  const u = db.get('SELECT * FROM usuarios WHERE email = ?', email);
  const ok = await verifyPassword(senha, u ? u.senha_hash : DUMMY_HASH);
  if (!u || !ok || !u.ativo) {
    loginLimiter.hit(keyUser);
    loginLimiter.hit(keyIp);
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  loginLimiter.reset(keyUser);
  const csrf = createSession(req, res, u.id, flag(req.body.lembrar));
  db.run("UPDATE usuarios SET ultimo_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", u.id);
  audit({ ...req, user: u }, 'Login', 'usuario', u.id);
  res.json({ ok: true, csrf, usuario: publicUser(u) });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.post('/minha-senha', requireAuth, async (req, res) => {
  const u = db.get('SELECT * FROM usuarios WHERE id = ?', req.user.id);
  if (!(await verifyPassword(String(req.body.atual || ''), u.senha_hash))) throw new HttpError(400, 'A senha atual está incorreta.');
  checkPasswordRules(req.body.nova);
  db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', await hashPassword(req.body.nova), u.id);
  destroyUserSessions(u.id, currentTokenHash(req)); // encerra as outras sessões
  audit(req, 'Trocou a própria senha', 'usuario', u.id);
  res.json({ ok: true });
});

// ---------------- Gestão de usuários (somente administradores) ----------------
router.get('/usuarios', requireAdmin, (_req, res) => {
  res.json(
    db.all(
      `SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.vendedor_id, u.ultimo_login, u.criado_em, v.nome AS vendedor_nome
       FROM usuarios u LEFT JOIN vendedores v ON v.id = u.vendedor_id ORDER BY u.papel, u.nome COLLATE NOCASE`,
    ),
  );
});

function adminsAtivos(exceptId = null) {
  return db.get("SELECT COUNT(*) AS n FROM usuarios WHERE papel='admin' AND ativo=1 AND id IS NOT ?", exceptId).n;
}

router.post('/usuarios', requireAdmin, async (req, res) => {
  const nome = str(req.body.nome, { required: true, name: 'nome', max: 120 });
  const email = str(req.body.email, { required: true, name: 'e-mail', max: 160 }).toLowerCase();
  if (!emailOk(email)) throw bad('E-mail inválido.');
  const papel = oneOf(req.body.papel, ['admin', 'vendedor'], { required: true, name: 'tipo de acesso' });
  const vendedorId = papel === 'vendedor' ? int(req.body.vendedor_id, { required: true, name: 'vendedor' }) : null;
  if (vendedorId && !db.get('SELECT 1 FROM vendedores WHERE id = ?', vendedorId)) throw bad('Vendedor não encontrado.');
  checkPasswordRules(req.body.senha);
  if (db.get('SELECT 1 FROM usuarios WHERE email = ?', email)) throw conflict('Já existe um usuário com este e-mail.');
  const r = db.run(
    'INSERT INTO usuarios (nome, email, senha_hash, papel, vendedor_id, trocar_senha) VALUES (?,?,?,?,?,1)',
    nome, email, await hashPassword(req.body.senha), papel, vendedorId,
  );
  audit(req, `Criou usuário (${papel})`, 'usuario', r.id, { nome, email });
  res.status(201).json({ id: r.id });
});

router.put('/usuarios/:id', requireAdmin, (req, res) => {
  const id = int(req.params.id, { required: true });
  const u = db.get('SELECT * FROM usuarios WHERE id = ?', id);
  if (!u) throw notFound('Usuário não encontrado.');
  const nome = str(req.body.nome ?? u.nome, { required: true, name: 'nome', max: 120 });
  const email = str(req.body.email ?? u.email, { required: true, name: 'e-mail', max: 160 }).toLowerCase();
  if (!emailOk(email)) throw bad('E-mail inválido.');
  const papel = oneOf(req.body.papel ?? u.papel, ['admin', 'vendedor'], { required: true });
  const ativo = req.body.ativo === undefined ? u.ativo : flag(req.body.ativo) ? 1 : 0;
  const vendedorId = papel === 'vendedor' ? int(req.body.vendedor_id ?? u.vendedor_id, { required: true, name: 'vendedor' }) : null;
  if (db.get('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?', email, id)) throw conflict('Já existe um usuário com este e-mail.');
  if (u.papel === 'admin' && (papel !== 'admin' || !ativo) && adminsAtivos(id) === 0) throw bad('Precisa existir pelo menos um administrador ativo.');
  if (id === req.user.id && !ativo) throw bad('Você não pode desativar o seu próprio acesso.');
  db.run('UPDATE usuarios SET nome=?, email=?, papel=?, ativo=?, vendedor_id=? WHERE id=?', nome, email, papel, ativo, vendedorId, id);
  if (!ativo || papel !== u.papel) destroyUserSessions(id);
  audit(req, 'Alterou usuário', 'usuario', id, { nome, email, papel, ativo });
  res.json({ ok: true });
});

router.post('/usuarios/:id/senha', requireAdmin, async (req, res) => {
  const id = int(req.params.id, { required: true });
  if (!db.get('SELECT 1 FROM usuarios WHERE id = ?', id)) throw notFound('Usuário não encontrado.');
  checkPasswordRules(req.body.senha);
  db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1 WHERE id = ?', await hashPassword(req.body.senha), id);
  destroyUserSessions(id);
  audit(req, 'Redefiniu a senha de um usuário', 'usuario', id);
  res.json({ ok: true });
});
