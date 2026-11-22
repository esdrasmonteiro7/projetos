// Testes da camada que guarda o banco no Netlify Blobs: criação, sincronização, conflito entre dois servidores,
// falhas de rede, cópia corrompida, cópia diária e arquivos enviados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { PersistenciaBlobs, etagDe } from '../server/serverless/persistencia.js';
import { FakeBlobs } from './fake-blobs.js';

const silencioso = { error() {}, log() {}, warn() {} };

/** Um "servidor" simulado: tem a própria cópia local do banco (arquivo em /tmp), como cada instância da função. */
class BancoFalso {
  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-persist-'));
    this.caminho = path.join(this.dir, 'b.db');
    this.n = 0;
    this.abrir();
  }
  abrir() {
    this.conn = new DatabaseSync(this.caminho);
    this.conn.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)');
  }
  escritas() { return this.n; }
  inserir(v) { this.conn.prepare('INSERT INTO t (v) VALUES (?)').run(v); this.n++; }
  lista() { return this.conn.prepare('SELECT v FROM t ORDER BY id').all().map((r) => r.v); }
  bytes() { return fs.readFileSync(this.caminho); }
  substituir(buf) { this.conn.close(); fs.writeFileSync(this.caminho, buf); this.abrir(); }
  vazio() { this.conn.close(); fs.rmSync(this.caminho, { force: true }); this.abrir(); }
}

function servidor(store, extra = {}) {
  const banco = new BancoFalso();
  const p = new PersistenciaBlobs({ banco, store, log: silencioso, ...extra });
  return { banco, p };
}
const listaDoBlob = (store) => {
  const e = store.dados.get('banco/painel.db.gz');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-ler-'));
  const f = path.join(dir, 'x.db');
  fs.writeFileSync(f, zlib.gunzipSync(e.bytes));
  return new DatabaseSync(f).prepare('SELECT v FROM t ORDER BY id').all().map((r) => r.v);
};

test('primeiro acesso cria o banco no armazenamento; o seguinte só confere a versão (sem baixar)', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  assert.equal(await a.p.sincronizar(), 'criado');
  assert.ok(store.dados.has('banco/painel.db.gz'));
  const baixouAntes = store.chamadas.filter(([m]) => m === 'get').length;
  assert.equal(await a.p.sincronizar(), 'atual');
  assert.equal(store.chamadas.filter(([m]) => m === 'get').length, baixouAntes);
});

test('gravação de um servidor aparece para o outro', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  const b = servidor(store);
  await a.p.sincronizar();
  await b.p.sincronizar();
  a.banco.inserir('da-ana');
  assert.equal(await a.p.confirmar(), true);
  assert.equal(await b.p.sincronizar(), 'baixado');
  assert.deepEqual(b.banco.lista(), ['da-ana']);
});

test('conflito: quem grava depois é recusado, descarta a cópia local e repete sobre o banco novo — ninguém perde nada', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  const b = servidor(store);
  await a.p.sincronizar();
  await b.p.sincronizar(); // os dois partem da mesma versão
  a.banco.inserir('do-a');
  assert.equal(await a.p.confirmar(), true);
  b.banco.inserir('do-b'); // b ainda não viu o que a gravou
  assert.equal(await b.p.confirmar(), false); // recusado
  assert.deepEqual(listaDoBlob(store), ['do-a']); // o armazenamento não foi sobrescrito
  assert.equal(await b.p.sincronizar(), 'baixado'); // cópia local (com 'do-b' não salvo) foi descartada
  assert.deepEqual(b.banco.lista(), ['do-a']);
  b.banco.inserir('do-b'); // repete a operação
  assert.equal(await b.p.confirmar(), true);
  assert.deepEqual(listaDoBlob(store), ['do-a', 'do-b']);
  assert.equal(b.p.info().conflitos_resolvidos, 1);
});

test('dois servidores criando o banco ao mesmo tempo: um vence, o outro usa o do vencedor', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  const b = servidor(store);
  // b "cria" logo depois de a ter gravado, mas antes de perceber
  store.antesDeSet = (chave, op) => {
    if (chave === 'banco/painel.db.gz' && op.onlyIfNew && !store.dados.has(chave)) {
      store.antesDeSet = null;
      const outro = servidor(store);
      outro.banco.inserir('criado-primeiro');
      store.gravarDireto('banco/painel.db.gz', zlib.gzipSync(outro.banco.bytes()));
    }
  };
  assert.equal(await a.p.sincronizar(), 'baixado'); // tentou criar, perdeu a corrida e adotou o banco do outro
  assert.deepEqual(a.banco.lista(), ['criado-primeiro']);
  assert.equal(await b.p.sincronizar(), 'baixado');
  assert.deepEqual(b.banco.lista(), ['criado-primeiro']);
});

test('resposta perdida depois de gravar: não repete a operação (evita duplicar)', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  await a.p.sincronizar();
  a.banco.inserir('uma-vez-so');
  store.falhasDepois = 1; // grava, mas a resposta não volta
  assert.equal(await a.p.confirmar(), true);
  assert.deepEqual(listaDoBlob(store), ['uma-vez-so']);
});

test('falha de rede passageira: tenta de novo e grava', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  await a.p.sincronizar();
  a.banco.inserir('x');
  store.falhasAntes = 2;
  assert.equal(await a.p.confirmar(), true);
  assert.deepEqual(listaDoBlob(store), ['x']);
});

test('falha de rede persistente: lança erro, não grava nada e descarta a cópia local', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  await a.p.sincronizar();
  a.banco.inserir('x');
  store.falhasAntes = 99;
  await assert.rejects(() => a.p.confirmar(), /falha de rede/);
  assert.deepEqual(listaDoBlob(store), []);
  assert.equal(a.p.etag, null);
  store.falhasAntes = 0;
  assert.equal(await a.p.sincronizar(), 'baixado');
  assert.deepEqual(a.banco.lista(), []); // o 'x' nunca foi salvo, então some
});

test('cópia corrompida: avisa e NUNCA sobrescreve o que está guardado', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  store.gravarDireto('banco/painel.db.gz', 'isto-nao-e-gzip');
  await assert.rejects(() => a.p.sincronizar(), /ilegível/);
  assert.equal(store.dados.get('banco/painel.db.gz').bytes.toString(), 'isto-nao-e-gzip');
  store.gravarDireto('banco/painel.db.gz', zlib.gzipSync(Buffer.from('gzip valido mas nao e sqlite')));
  await assert.rejects(() => a.p.sincronizar(), /não abriu/);
  assert.equal(store.conta('set', 'banco/painel.db.gz'), 0);
});

test('cópia diária: uma por dia, mantém só as últimas 30', async () => {
  const store = new FakeBlobs();
  let agora = new Date('2026-01-01T12:00:00Z');
  const a = servidor(store, { agora: () => agora });
  await a.p.sincronizar();
  for (let i = 0; i < 35; i++) {
    a.banco.inserir(`dia-${i}`);
    assert.equal(await a.p.confirmar(), true);
    a.banco.inserir(`dia-${i}-b`); // segunda gravação no mesmo dia não cria outra cópia
    assert.equal(await a.p.confirmar(), true);
    agora = new Date(agora.getTime() + 24 * 3600e3);
  }
  const copias = [...store.dados.keys()].filter((k) => k.startsWith('copias/')).sort();
  assert.equal(copias.length, 30);
  assert.equal(copias.at(-1), 'copias/2026-02-04.db.gz');
  assert.equal(copias[0], 'copias/2026-01-06.db.gz');
  // a cópia de um dia tem o estado da primeira gravação daquele dia
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-cp-'));
  fs.writeFileSync(path.join(dir, 'c.db'), zlib.gunzipSync(store.dados.get('copias/2026-01-10.db.gz').bytes));
  const linhas = new DatabaseSync(path.join(dir, 'c.db')).prepare('SELECT v FROM t ORDER BY id').all().map((r) => r.v);
  assert.equal(linhas.at(-1), 'dia-9');
});

test('falha ao guardar a cópia diária não derruba a gravação', async () => {
  const store = new FakeBlobs();
  const a = servidor(store);
  await a.p.sincronizar();
  store.list = async () => { throw new Error('list indisponível'); };
  a.banco.inserir('x');
  assert.equal(await a.p.confirmar(), true);
});

test('arquivos enviados: sobem para o armazenamento, com nome pelo conteúdo, e podem ser buscados depois', async () => {
  const store = new FakeBlobs();
  const locais = new Map([['ab/cd/abcd1234.pdf', Buffer.from('conteudo do comprovante')]]);
  const a = servidor(store, { lerLocal: (rel) => locais.get(rel) || null });
  await a.p.sincronizar();
  a.p.registrarArquivo('ab/cd/abcd1234.pdf');
  a.p.registrarArquivo('nao/existe.pdf'); // sem arquivo local: ignorado
  await a.p.enviarArquivosPendentes();
  assert.equal(a.p.arquivosPendentes.size, 0);
  assert.equal(store.dados.get('arquivos/ab/cd/abcd1234.pdf').bytes.toString(), 'conteudo do comprovante');
  const outro = servidor(store);
  outro.p.usarStore(store);
  assert.equal((await outro.p.obterArquivo('ab/cd/abcd1234.pdf')).toString(), 'conteudo do comprovante');
  assert.equal(await outro.p.obterArquivo('nao/tem.pdf'), null);
  // enviar de novo não regrava
  a.p.registrarArquivo('ab/cd/abcd1234.pdf');
  await a.p.enviarArquivosPendentes();
  assert.equal(store.conta('set', 'arquivos/ab/cd/abcd1234.pdf'), 2); // tentou, mas "onlyIfNew" não altera
});

test('etagDe confere com o MD5 usado pelo Netlify Blobs', () => {
  assert.equal(etagDe(Buffer.from('v1')), '"6654c734ccab8f440ff0825eb443dc7f"');
});
