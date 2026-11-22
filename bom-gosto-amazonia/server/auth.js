// Login, sessões (cookie), permissões, proteção CSRF e auditoria.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { HttpError, forbidden } from './lib/http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };
const COOKIE = 'bg_sessao';
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(pw, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const dk = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}
// hash fictício para gastar o mesmo tempo quando o e-mail não existe
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(8).toString('hex'));

export function checkPasswordRules(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (pw.length > 200) throw new HttpError(400, 'Senha muito longa.');
}

// ---------- cookies/sessões ----------
function readCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function createSession(req, res, userId, remember = false) {
  db.run("DELETE FROM sessoes WHERE expira_em < strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const ttl = remember ? 30 * 24 * 3600e3 : 12 * 3600e3;
  db.run(
    'INSERT INTO sessoes (token_hash, usuario_id, csrf, expira_em, ip, user_agent) VALUES (?,?,?,?,?,?)',
    sha(token), userId, csrf, new Date(Date.now() + ttl).toISOString(), req.ip, String(req.get('user-agent') || '').slice(0, 200),
  );
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: ttl, path: '/' });
  return csrf;
}

export function destroySession(req, res) {
  const t = readCookie(req, COOKIE);
  if (t) db.run('DELETE FROM sessoes WHERE token_hash = ?', sha(t));
  res.clearCookie(COOKIE, { path: '/' });
}
export function destroyUserSessions(userId, exceptHash = null) {
  db.run('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash IS NOT ?', userId, exceptHash);
}
export function currentTokenHash(req) {
  const t = readCookie(req, COOKIE);
  return t ? sha(t) : null;
}

/** Preenche req.user / req.csrf quando há sessão válida. */
export function sessionMiddleware(req, _res, next) {
  req.user = null;
  const t = readCookie(req, COOKIE);
  if (t) {
    const row = db.get(
      `SELECT s.csrf, u.id, u.nome, u.email, u.papel, u.vendedor_id, u.trocar_senha
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`,
      sha(t), new Date().toISOString(),
    );
    if (row) {
      req.csrf = row.csrf;
      req.user = { id: row.id, nome: row.nome, email: row.email, papel: row.papel, vendedor_id: row.vendedor_id, trocar_senha: !!row.trocar_senha };
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sua sessão expirou. Entre novamente.'));
  next();
}
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sua sessão expirou. Entre novamente.'));
  if (req.user.papel !== 'admin') return next(forbidden('Só administradores podem fazer isso.'));
  next();
}

/** Proteção contra requisições forjadas: exige o token da sessão e confere a origem. */
export function csrfProtect(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return next(new HttpError(403, 'Origem não permitida.'));
    } catch {
      return next(new HttpError(403, 'Origem inválida.'));
    }
  }
  if (!req.user) return next(); // login/setup: não há sessão ainda
  const sent = req.get('x-csrf-token');
  if (!sent || !req.csrf || sent.length !== req.csrf.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrf))) {
    return next(new HttpError(403, 'Sessão inválida. Recarregue a página e tente de novo.'));
  }
  next();
}

/** Escopo de dados: administrador vê tudo; vendedor só o que é dele. */
export function scopeOf(req) {
  if (req.user.papel === 'admin') {
    const v = parseInt(req.query?.vendedor_id, 10);
    return { admin: true, vendedorId: Number.isInteger(v) && v > 0 ? v : null };
  }
  if (!req.user.vendedor_id) throw forbidden('Seu usuário não está ligado a um vendedor. Fale com um administrador.');
  return { admin: false, vendedorId: req.user.vendedor_id };
}

// ---------- limite de tentativas de login ----------
const tentativas = new Map();
export const loginLimiter = {
  max: 8,
  windowMs: 15 * 60 * 1000,
  check(key) {
    const e = tentativas.get(key);
    if (!e) return;
    if (Date.now() - e.first > this.windowMs) { tentativas.delete(key); return; }
    if (e.n >= this.max) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  },
  hit(key) {
    const e = tentativas.get(key);
    if (!e || Date.now() - e.first > this.windowMs) tentativas.set(key, { n: 1, first: Date.now() });
    else e.n++;
    if (tentativas.size > 5000) tentativas.clear();
  },
  reset(key) { tentativas.delete(key); },
};

// ---------- auditoria ----------
export function audit(req, acao, entidade = null, entidadeId = null, detalhes = null) {
  try {
    db.run(
      'INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, ip) VALUES (?,?,?,?,?,?,?)',
      req.user?.id ?? null, req.user?.nome ?? null, acao, entidade, entidadeId,
      detalhes == null ? null : typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes),
      req.ip ?? null,
    );
  } catch { /* auditoria nunca derruba a operação */ }
}
