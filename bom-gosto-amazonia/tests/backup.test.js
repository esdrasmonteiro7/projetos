import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { cifrar, decifrar, selecionarParaApagar, BackupRemoto, GitHubReleaseStore, lerConfigRemota } from '../server/services/backup-remoto.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ghp_teste_123';
const SENHA = 'uma-senha-bem-longa-para-teste';

// ------------------------------------------------------------ GitHub falso (só o que o backup usa)
let fake;
let base;
const estado = { release: null, assets: new Map(), proximoId: 100 };
before(async () => {
  fake = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}` && !url.pathname.startsWith('/blob/')) return json(401, { message: 'Bad credentials' });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const corpo = Buffer.concat(chunks);
      const lista = () => [...estado.assets.values()].map(({ id, name }) => ({ id, name }));
      let m;
      if (req.method === 'GET' && /\/releases\/tags\//.test(url.pathname)) return estado.release ? json(200, { id: 1, assets: lista() }) : json(404, { message: 'Not Found' });
      if (req.method === 'POST' && /\/repos\/[^/]+\/[^/]+\/releases$/.test(url.pathname)) { estado.release = { id: 1 }; return json(201, { id: 1, assets: [] }); }
      if (req.method === 'POST' && (m = url.pathname.match(/^\/upload\/repos\/[^/]+\/[^/]+\/releases\/1\/assets$/))) {
        const id = estado.proximoId++;
        estado.assets.set(id, { id, name: url.searchParams.get('name'), bytes: corpo });
        return json(201, { id, name: url.searchParams.get('name') });
      }
      if (req.method === 'GET' && (m = url.pathname.match(/\/releases\/assets\/(\d+)$/))) { res.writeHead(302, { location: `/blob/${m[1]}` }); return res.end(); }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/blob\/(\d+)$/))) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(estado.assets.get(Number(m[1])).bytes); }
      if (req.method === 'DELETE' && (m = url.pathname.match(/\/releases\/assets\/(\d+)$/))) { estado.assets.delete(Number(m[1])); res.writeHead(204); return res.end(); }
      return json(404, { message: 'rota desconhecida no teste' });
    });
  });
  await new Promise((r) => fake.listen(0, r));
  base = `http://localhost:${fake.address().port}`;
});
after(() => fake.close());

const novoBanco = (dir, texto) => {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'painel.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT); ');
  db.prepare('INSERT INTO t VALUES (?)').run(texto);
  return db;
};
const cfg = (extra = {}) => lerConfigRemota({ BACKUP_GITHUB_REPO: 'dono/backup', BACKUP_GITHUB_TOKEN: TOKEN, BACKUP_KEY: SENHA, GITHUB_API_URL: base, GITHUB_UPLOAD_URL: `${base}/upload`, BACKUP_ATRASO_SEG: '3', ...extra });
const silencio = { log() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bg-bkp-'));

test('criptografia: ida e volta, senha errada e arquivo adulterado são recusados', () => {
  const original = Buffer.from('dados secretos do cliente Mercadinho Souza');
  const c = cifrar(original, SENHA);
  assert.ok(!c.includes(Buffer.from('Mercadinho')), 'o conteúdo não pode aparecer em texto puro');
  assert.deepEqual(decifrar(c, SENHA), original);
  assert.throws(() => decifrar(c, 'senha-errada-aaaaaaaaa'), /BACKUP_KEY/);
  const adulterado = Buffer.from(c);
  adulterado[adulterado.length - 3] ^= 0xff;
  assert.throws(() => decifrar(adulterado, SENHA), /BACKUP_KEY|corrompido/);
});

test('retenção: guarda os mais recentes e o último de cada dia', () => {
  const nomes = [];
  for (let d = 1; d <= 20; d++) for (const h of ['08', '12', '18']) nomes.push({ name: `painel-202611${String(d).padStart(2, '0')}T${h}0000000Z.db.enc` });
  const apagar = selecionarParaApagar(nomes, 4, 14);
  const ficam = nomes.filter((n) => !apagar.includes(n)).map((n) => n.name);
  assert.ok(ficam.includes('painel-20261120T180000000Z.db.enc'), 'o mais novo fica');
  assert.ok(ficam.includes('painel-20261107T180000000Z.db.enc'), 'o último do dia 07 (14º dia para trás) fica');
  assert.ok(!ficam.includes('painel-20261106T180000000Z.db.enc'), 'dias mais antigos que 14 saem');
  assert.ok(!ficam.includes('painel-20261110T080000000Z.db.enc'), 'versões intermediárias do mesmo dia saem');
  assert.ok(ficam.length <= 18);
});

test('envia backup criptografado e restaura em um disco novo (como depois de um reinício)', async () => {
  estado.release = null; estado.assets.clear();
  const origem = tmp();
  const db = novoBanco(origem, 'venda-do-mercadinho-souza-12345');
  const b1 = new BackupRemoto(cfg(), { dbPath: path.join(origem, 'painel.db'), snapshot: (d) => db.exec(`VACUUM INTO '${d}'`), log: silencio });
  assert.equal((await b1.restaurarSeNecessario()).restaurado, false, 'primeira vez: não há backup, começa vazio');
  b1.marcarSujo();
  assert.equal(b1.estado.pendente, true);
  assert.equal(await b1.agora(), true);
  assert.equal(b1.estado.pendente, false);
  assert.equal(estado.assets.size, 1);
  const enviado = [...estado.assets.values()][0];
  assert.match(enviado.name, /^painel-\d{8}T\d+Z\.db\.enc$/);
  assert.ok(!enviado.bytes.includes(Buffer.from('mercadinho')), 'GitHub só recebe bytes criptografados');
  db.close();

  // "reinício": pasta nova e vazia
  const destino = tmp();
  const b2 = new BackupRemoto(cfg(), { dbPath: path.join(destino, 'painel.db'), snapshot: () => {}, log: silencio });
  const r = await b2.restaurarSeNecessario();
  assert.equal(r.restaurado, true);
  const lido = new DatabaseSync(path.join(destino, 'painel.db')).prepare('SELECT v FROM t').get();
  assert.equal(lido.v, 'venda-do-mercadinho-souza-12345');
  // se o banco local já existe (disco permanente), NÃO sobrescreve
  const b3 = new BackupRemoto(cfg(), { dbPath: path.join(destino, 'painel.db'), snapshot: () => {}, log: silencio });
  assert.equal((await b3.restaurarSeNecessario()).restaurado, false);
});

test('não inicia com banco vazio quando o backup existe mas não pode ser lido', async () => {
  const dir = tmp();
  // senha errada
  const errada = new BackupRemoto(cfg({ BACKUP_KEY: 'outra-senha-completamente-diferente' }), { dbPath: path.join(dir, 'painel.db'), snapshot: () => {}, log: silencio });
  await assert.rejects(() => errada.restaurarSeNecessario(), /BACKUP_KEY/);
  assert.ok(!fs.existsSync(path.join(dir, 'painel.db')));
  // token inválido
  const ruim = new BackupRemoto(cfg({ BACKUP_GITHUB_TOKEN: 'token-invalido' }), { dbPath: path.join(dir, 'painel.db'), snapshot: () => {}, log: silencio, store: new GitHubReleaseStore({ repo: 'dono/backup', token: 'token-invalido', apiUrl: base, uploadUrl: `${base}/upload` }) });
  const antes = Date.now();
  ruim.restaurarSeNecessario = ruim.restaurarSeNecessario.bind(ruim);
  await assert.rejects(() => ruim.restaurarSeNecessario(), /GitHub respondeu 401/);
  assert.ok(Date.now() - antes >= 2000, 'tentou de novo antes de desistir');
  assert.ok(!fs.existsSync(path.join(dir, 'painel.db')));
});

test('BACKUP_KEY curta é recusada com mensagem clara', async () => {
  const b = new BackupRemoto(cfg({ BACKUP_KEY: 'curta' }), { dbPath: path.join(tmp(), 'painel.db'), snapshot: () => {}, log: silencio });
  await assert.rejects(() => b.restaurarSeNecessario(), /pelo menos 12 caracteres/);
});

test('falha no GitHub é registrada, não derruba o painel e tenta de novo', async () => {
  const dir = tmp();
  const db = novoBanco(dir, 'x');
  const b = new BackupRemoto(cfg({ BACKUP_GITHUB_TOKEN: 'token-invalido' }), { dbPath: path.join(dir, 'painel.db'), snapshot: (d) => db.exec(`VACUUM INTO '${d}'`), log: silencio });
  b.marcarSujo();
  assert.equal(await b.agora(), false);
  assert.match(b.estado.ultimo_erro, /401/);
  assert.equal(b.estado.pendente, true);
  clearTimeout(b.timer);
  db.close();
});

// ------------------------------------------------------------ ponta a ponta: processo real, disco apagado, dados voltam
function iniciarServidor(dataDir, extra = {}) {
  return new Promise((resolve, reject) => {
    const porta = 20000 + Math.floor(Math.random() * 20000);
    const filho = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
      cwd: RAIZ,
      env: { ...process.env, PORT: String(porta), DATA_DIR: dataDir, NODE_ENV: 'test', BACKUP_GITHUB_REPO: 'dono/backup', BACKUP_GITHUB_TOKEN: TOKEN, BACKUP_KEY: SENHA, GITHUB_API_URL: base, GITHUB_UPLOAD_URL: `${base}/upload`, BACKUP_ATRASO_SEG: '3', ...extra },
    });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; if (saida.includes('no ar')) resolve({ filho, porta, saida: () => saida }); });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('exit', (c) => { if (!saida.includes('no ar')) reject(new Error(`servidor saiu (${c}): ${saida}`)); });
    setTimeout(() => reject(new Error(`servidor não subiu: ${saida}`)), 25000);
  });
}
const parar = (filho) => new Promise((r) => { filho.on('exit', r); filho.kill('SIGTERM'); });

test('ponta a ponta: cria o administrador, o servidor "perde o disco" e os dados voltam sozinhos', { timeout: 90000 }, async () => {
  estado.release = null; estado.assets.clear();
  const disco1 = tmp();
  const s1 = await iniciarServidor(disco1);
  const r = await fetch(`http://localhost:${s1.porta}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Dona Maria', email: 'maria@teste.com', senha: 'senha-forte-123' }) });
  assert.equal(r.status, 200);
  // espera o envio automático (3 s de atraso)
  for (let i = 0; i < 40 && estado.assets.size === 0; i++) await new Promise((x) => setTimeout(x, 500));
  assert.ok(estado.assets.size >= 1, 'o backup automático deveria ter sido enviado sozinho');
  await parar(s1.filho);

  // novo servidor, disco totalmente vazio (como no Render grátis depois de dormir)
  const disco2 = tmp();
  const s2 = await iniciarServidor(disco2);
  assert.match(s2.saida(), /restaurado/i);
  const sessao = await (await fetch(`http://localhost:${s2.porta}/api/sessao`)).json();
  assert.equal(sessao.precisa_setup, false, 'o administrador criado antes foi restaurado');
  const login = await fetch(`http://localhost:${s2.porta}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'maria@teste.com', senha: 'senha-forte-123' }) });
  assert.equal(login.status, 200, 'a senha antiga continua valendo');
  await parar(s2.filho);
});

test('redefinição de senha por variável de ambiente vale uma única vez', { timeout: 60000 }, async () => {
  const disco = tmp();
  const extra = { BACKUP_GITHUB_REPO: '', BACKUP_GITHUB_TOKEN: '' };
  const s1 = await iniciarServidor(disco, extra);
  await fetch(`http://localhost:${s1.porta}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Admin', email: 'a@teste.com', senha: 'senha-antiga-123' }) });
  await parar(s1.filho);
  const s2 = await iniciarServidor(disco, { ...extra, REDEFINIR_SENHA_EMAIL: 'a@teste.com', REDEFINIR_SENHA_NOVA: 'provisoria-9999' });
  const post = (porta, senha) => fetch(`http://localhost:${porta}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@teste.com', senha }) });
  assert.equal((await post(s2.porta, 'senha-antiga-123')).status, 401);
  const novo = await post(s2.porta, 'provisoria-9999');
  assert.equal(novo.status, 200);
  assert.equal((await novo.json()).usuario.trocar_senha, true);
  await parar(s2.filho);
});
