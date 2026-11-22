// Testa o painel COMPLETO rodando como na Netlify: cada requisição passa pelo manipulador (sincroniza o banco, atende,
// salva no Blobs) — com um Netlify Blobs de mentira. Inclui conflito entre dois servidores e falhas de rede.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-sem-servidor-'));
process.env.SETUP_CODE = 'codigo-de-teste';
await import('../server/serverless/ambiente.js');
const { montarSemServidor } = await import('../server/serverless/montar.js');
const { db } = await import('../server/db.js');
const { config } = await import('../server/config.js');
const { abrirArquivo } = await import('../server/services/arquivos.js');
const { FakeBlobs } = await import('./fake-blobs.js');

const silencioso = { error() {}, log() {}, warn() {} };
const store = new FakeBlobs();
const { manipulador, persistencia } = montarSemServidor({
  obterStore: () => store,
  persistencia: { log: silencioso },
  manipulador: { log: silencioso, maxTentativas: 3 },
});
const BASE = 'https://painel.test';
const CHAVE = 'banco/painel.db.gz';

/** "Navegador" mínimo: guarda o cookie e o token CSRF e chama o manipulador como a Netlify faria. */
function navegador() {
  let cookie = '';
  let csrf = '';
  const n = {
    async chamar(metodo, url, { corpo, form, cabecalhos = {}, ip = '203.0.113.7' } = {}) {
      const h = { origin: BASE, ...cabecalhos };
      if (cookie) h.cookie = cookie;
      if (csrf) h['x-csrf-token'] = csrf;
      if (corpo !== undefined) h['content-type'] = 'application/json';
      const req = new Request(BASE + url, { method: metodo, headers: h, body: form ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined) });
      const resp = await manipulador(req, { ip });
      const sc = resp.headers.getSetCookie();
      if (sc.length) cookie = sc[0].split(';')[0];
      return resp;
    },
    async json(metodo, url, corpo, extra = {}) {
      const resp = await n.chamar(metodo, url, { corpo, ...extra });
      const t = await resp.text();
      let body;
      try { body = JSON.parse(t); } catch { body = t; }
      return { status: resp.status, body, resp };
    },
    get: (u) => n.json('GET', u),
    post: (u, c) => n.json('POST', u, c ?? {}),
    async entrar(email, senha) {
      const r = await n.post('/api/login', { email, senha });
      if (r.status === 200) csrf = r.body.csrf;
      return r;
    },
    setCsrf: (t) => { csrf = t; },
  };
  return n;
}

/** Abre uma cópia do banco guardado no armazenamento (para conferir o que foi realmente salvo). */
function bancoGuardado() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-guardado-'));
  const f = path.join(dir, 'g.db');
  fs.writeFileSync(f, zlib.gunzipSync(store.dados.get(CHAVE).bytes));
  return new DatabaseSync(f);
}
const nomesVendedoresGuardados = () => bancoGuardado().prepare('SELECT nome FROM vendedores ORDER BY id').all().map((r) => r.nome);

/** Simula OUTRO servidor gravando um vendedor no banco guardado (sem condição, como se tivesse ganhado a corrida). */
function outroServidorGrava(nome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-outro-'));
  const f = path.join(dir, 'o.db');
  fs.writeFileSync(f, zlib.gunzipSync(store.dados.get(CHAVE).bytes));
  const d = new DatabaseSync(f);
  d.prepare('INSERT INTO vendedores (nome, nome_norm) VALUES (?, ?)').run(nome, nome.toLowerCase());
  d.close();
  store.gravarDireto(CHAVE, zlib.gzipSync(fs.readFileSync(f)));
}

let admin;
before(() => { admin = navegador(); });
after(async () => { await manipulador.fechar(); });

test('primeiro acesso: o banco nasce no armazenamento e o cadastro do administrador fica salvo', async () => {
  const s = await admin.get('/api/sessao');
  assert.equal(s.status, 200);
  assert.equal(s.body.precisa_setup, true);
  assert.equal(s.body.limite_envio_mb, 4.5); // a tela divide os arquivos em lotes que cabem no limite da Netlify
  assert.ok(store.dados.has(CHAVE), 'o banco foi criado no armazenamento');

  const errado = await admin.post('/api/setup', { codigo: 'errado', nome: 'Dono', email: 'dono@teste.com', senha: 'senha-forte-1' });
  assert.equal(errado.status, 403);

  const r = await admin.post('/api/setup', { codigo: 'codigo-de-teste', nome: 'Dono', email: 'dono@teste.com', senha: 'senha-forte-1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  admin.setCsrf(r.body.csrf);
  const cookie = r.resp.headers.getSetCookie()[0];
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.equal(bancoGuardado().prepare('SELECT COUNT(*) AS n FROM usuarios').get().n, 1);
});

test('"reinício a frio": com o disco local vazio, tudo volta do armazenamento (inclusive a sessão aberta)', async () => {
  persistencia.etag = null;
  db.vazio(); // como uma instância nova da função: sem nada no /tmp
  assert.equal(db.get('SELECT COUNT(*) AS n FROM usuarios').n, 0);
  const s = await admin.get('/api/sessao');
  assert.equal(s.body.precisa_setup, false);
  assert.equal(s.body.usuario.email, 'dono@teste.com');
});

test('só leitura não grava no armazenamento (nem mesmo com o painel e as listas)', async () => {
  const antes = store.conta('set');
  for (const u of ['/api/sessao', '/api/dashboard', '/api/vendedores', '/api/vendas', '/api/alertas']) {
    const r = await admin.get(u);
    assert.equal(r.status, 200, u);
  }
  assert.equal(store.conta('set'), antes);
});

test('uma gravação só responde depois de salvar, e o que foi salvo é o que foi pedido', async () => {
  const r = await admin.post('/api/vendedores', { nome: 'Marcos Souza', comissao_pct: 5 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(nomesVendedoresGuardados(), ['Marcos Souza']);
});

test('conflito com outro servidor: a requisição é repetida sobre o banco novo e nada se perde', async () => {
  let vezes = 0;
  store.antesDeSet = (chave, op) => {
    if (chave === CHAVE && op.onlyIfMatch && vezes++ === 0) outroServidorGrava('Concorrente'); // outro grava um instante antes
  };
  const conflitosAntes = persistencia.info().conflitos_resolvidos;
  const r = await admin.post('/api/vendedores', { nome: 'Ana Lima' });
  store.antesDeSet = null;
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(persistencia.info().conflitos_resolvidos, conflitosAntes + 1);
  assert.deepEqual(nomesVendedoresGuardados(), ['Marcos Souza', 'Concorrente', 'Ana Lima']);
});

test('conflito que não passa: responde 503 e não altera nada', async () => {
  let n = 0;
  store.antesDeSet = (chave, op) => { if (chave === CHAVE && op.onlyIfMatch) outroServidorGrava(`Intruso ${++n}`); };
  const r = await admin.post('/api/vendedores', { nome: 'Nunca Salvo' });
  store.antesDeSet = null;
  assert.equal(r.status, 503);
  assert.match(r.body.erro, /Nada foi alterado/);
  const nomes = nomesVendedoresGuardados();
  assert.ok(!nomes.includes('Nunca Salvo'));
  // depois do problema tudo volta ao normal
  const ok = await admin.post('/api/vendedores', { nome: 'Salvo Agora' });
  assert.equal(ok.status, 201);
  assert.ok(nomesVendedoresGuardados().includes('Salvo Agora'));
});

test('falha de rede ao salvar: 503 e nada fica pela metade; depois funciona', async () => {
  store.falhasAntes = 99;
  const r = await admin.post('/api/vendedores', { nome: 'Rede Caiu' });
  store.falhasAntes = 0;
  assert.equal(r.status, 503);
  assert.ok(!nomesVendedoresGuardados().includes('Rede Caiu'));
  const lista = await admin.get('/api/vendedores');
  assert.ok(!lista.body.some((v) => v.nome === 'Rede Caiu'), 'a gravação não salva não pode aparecer nas telas');
  assert.equal((await admin.post('/api/vendedores', { nome: 'Rede Voltou' })).status, 201);
});

test('arquivo enviado vai para o armazenamento e, mesmo com o disco local apagado, ainda pode ser baixado', async () => {
  const csv = 'Cliente;Valor;Vencimento\nMercado Central;150,00;2026-12-10\nPadaria Boa Hora;80,50;2026-12-12\n';
  const form = new FormData();
  form.append('arquivos', new Blob([csv], { type: 'text/csv' }), 'devedores.csv');
  const r = await admin.json('POST', '/api/importacoes/analisar', undefined, { form });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.importacoes.length, 1);
  const imp = r.body.importacoes[0];
  const chaves = [...store.dados.keys()].filter((k) => k.startsWith('arquivos/'));
  assert.equal(chaves.length, 1);
  assert.match(chaves[0], /\.csv$/);

  fs.rmSync(config.uploadDir, { recursive: true, force: true }); // disco temporário "novo"
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const dl = await admin.chamar('GET', `/api/importacoes/${imp.id}/arquivo`);
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), csv);
  assert.ok(await abrirArquivo(db.get('SELECT arquivo_id FROM importacoes WHERE id = ?', imp.id).arquivo_id));
});

test('o backup baixado pelo painel vem compactado e é um banco SQLite válido com os dados', async () => {
  const resp = await admin.chamar('GET', '/api/backup');
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('content-type'), 'application/gzip');
  assert.match(resp.headers.get('content-disposition'), /\.db\.gz/);
  const bruto = zlib.gunzipSync(Buffer.from(await resp.arrayBuffer()));
  assert.equal(bruto.subarray(0, 15).toString(), 'SQLite format 3');
});

test('tela de configurações informa o armazenamento e não alerta sobre "disco temporário"', async () => {
  const c = await admin.get('/api/configuracoes');
  assert.equal(c.body.armazenamento.tipo, 'netlify-blobs');
  const a = await admin.get('/api/alertas');
  assert.equal(a.body.backup, undefined);
});

test('segurança: o IP vem da Netlify (não do cliente) e origem diferente é recusada', async () => {
  const n = navegador();
  const falso = await n.json('POST', '/api/login', { email: 'dono@teste.com', senha: 'senha-forte-1' }, { cabecalhos: { 'x-forwarded-for': '6.6.6.6' }, ip: '198.51.100.9' });
  assert.equal(falso.status, 200);
  const ips = db.all('SELECT ip FROM sessoes').map((s) => s.ip);
  assert.ok(ips.includes('198.51.100.9'));
  assert.ok(!ips.includes('6.6.6.6'));
  const outraOrigem = await n.json('POST', '/api/logout', {}, { cabecalhos: { origin: 'https://site-malicioso.test' } });
  assert.equal(outraOrigem.status, 403);
});

test('limite de tentativas de senha vale para todos os servidores (fica guardado no banco)', async () => {
  const atacante = navegador();
  const IP = '192.0.2.55';
  for (let i = 1; i <= 8; i++) {
    if (i === 4) { persistencia.etag = null; db.vazio(); } // no meio do ataque, outro servidor (disco novo) atende
    const r = await atacante.json('POST', '/api/login', { email: 'dono@teste.com', senha: `errada-${i}` }, { ip: IP });
    assert.equal(r.status, 401, `tentativa ${i}`);
  }
  persistencia.etag = null; db.vazio(); // mais um servidor "novo"
  const bloqueado = await atacante.json('POST', '/api/login', { email: 'dono@teste.com', senha: 'senha-forte-1' }, { ip: IP });
  assert.equal(bloqueado.status, 429); // nem a senha certa passa enquanto estiver bloqueado
  // outra pessoa (outro IP) não é afetada
  const outra = await navegador().json('POST', '/api/login', { email: 'dono@teste.com', senha: 'senha-forte-1' }, { ip: '192.0.2.56' });
  assert.equal(outra.status, 200);
});

test('acesso em dois "servidores" ao mesmo tempo: dois cadastros simultâneos acabam os dois salvos', async () => {
  // dois navegadores disparando juntos; o manipulador serializa dentro do servidor e o armazenamento resolve entre servidores
  const outro = navegador();
  const r = await outro.entrar('dono@teste.com', 'senha-forte-1');
  assert.equal(r.status, 200);
  const [a, b] = await Promise.all([admin.post('/api/vendedores', { nome: 'Paralelo A' }), outro.post('/api/vendedores', { nome: 'Paralelo B' })]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const nomes = nomesVendedoresGuardados();
  assert.equal(nomes.filter((x) => x === 'Paralelo A').length, 1);
  assert.equal(nomes.filter((x) => x === 'Paralelo B').length, 1);
});
