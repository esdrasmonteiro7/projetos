// Banco de dados SQLite (embutido no Node 22, sem instalar nada). Um único arquivo: data/painel.db
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { criarBackupRemoto } from './services/backup-remoto.js';

// Backup externo opcional (ver server/services/backup-remoto.js): restaura o banco ANTES de abri-lo, se ele não existir.
let raw;
export const backupRemoto = criarBackupRemoto({
  dbPath: config.dbPath,
  snapshot: (destino) => raw.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`),
});
await backupRemoto.restaurarSeNecessario();
raw = new DatabaseSync(config.dbPath);
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000; PRAGMA synchronous = NORMAL;');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const MIGRATIONS = [
  // ---------- 1: estrutura inicial ----------
  `
  CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT);

  CREATE TABLE vendedores (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    nome_norm TEXT NOT NULL,
    telefone TEXT,
    email TEXT,
    comissao_pct REAL NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_vendedores_norm ON vendedores(nome_norm);

  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin','vendedor')),
    vendedor_id INTEGER REFERENCES vendedores(id),
    ativo INTEGER NOT NULL DEFAULT 1,
    trocar_senha INTEGER NOT NULL DEFAULT 0,
    ultimo_login TEXT,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    expira_em TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);

  CREATE TABLE arquivos (
    id INTEGER PRIMARY KEY,
    nome_original TEXT NOT NULL,
    hash TEXT NOT NULL,
    tamanho INTEGER NOT NULL,
    mime TEXT,
    caminho TEXT NOT NULL,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_arquivos_hash ON arquivos(hash);

  CREATE TABLE clientes (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    nome_norm TEXT NOT NULL,
    documento TEXT,
    telefone TEXT,
    email TEXT,
    endereco TEXT,
    cidade TEXT,
    vendedor_id INTEGER REFERENCES vendedores(id),
    observacoes TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    importacao_id INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_clientes_norm ON clientes(nome_norm);
  CREATE INDEX idx_clientes_doc ON clientes(documento);
  CREATE INDEX idx_clientes_vend ON clientes(vendedor_id);

  CREATE TABLE produtos (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    nome_norm TEXT NOT NULL,
    sku TEXT,
    unidade TEXT NOT NULL DEFAULT 'un',
    preco_centavos INTEGER NOT NULL DEFAULT 0,
    custo_centavos INTEGER NOT NULL DEFAULT 0,
    categoria TEXT,
    estoque_minimo REAL NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    importacao_id INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_produtos_norm ON produtos(nome_norm);

  CREATE TABLE vendas (
    id INTEGER PRIMARY KEY,
    numero TEXT,
    data TEXT NOT NULL,
    cliente_id INTEGER REFERENCES clientes(id),
    vendedor_id INTEGER REFERENCES vendedores(id),
    total_centavos INTEGER NOT NULL,
    desconto_centavos INTEGER NOT NULL DEFAULT 0,
    forma_pagamento TEXT,
    status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','cancelada')),
    origem TEXT NOT NULL DEFAULT 'manual',
    chave_nfe TEXT UNIQUE,
    observacoes TEXT,
    importacao_id INTEGER,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_vendas_data ON vendas(data);
  CREATE INDEX idx_vendas_vend ON vendas(vendedor_id);
  CREATE INDEX idx_vendas_cli ON vendas(cliente_id);
  CREATE INDEX idx_vendas_imp ON vendas(importacao_id);

  CREATE TABLE venda_itens (
    id INTEGER PRIMARY KEY,
    venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    produto_id INTEGER REFERENCES produtos(id),
    descricao TEXT NOT NULL,
    quantidade REAL NOT NULL,
    unidade TEXT,
    preco_centavos INTEGER NOT NULL,
    total_centavos INTEGER NOT NULL
  );
  CREATE INDEX idx_itens_venda ON venda_itens(venda_id);

  CREATE TABLE titulos (
    id INTEGER PRIMARY KEY,
    venda_id INTEGER REFERENCES vendas(id) ON DELETE CASCADE,
    cliente_id INTEGER REFERENCES clientes(id),
    vendedor_id INTEGER REFERENCES vendedores(id),
    documento TEXT,
    parcela TEXT,
    descricao TEXT,
    emissao TEXT,
    vencimento TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    cancelado INTEGER NOT NULL DEFAULT 0,
    origem TEXT NOT NULL DEFAULT 'manual',
    observacoes TEXT,
    importacao_id INTEGER,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_titulos_venc ON titulos(vencimento);
  CREATE INDEX idx_titulos_cli ON titulos(cliente_id);
  CREATE INDEX idx_titulos_vend ON titulos(vendedor_id);
  CREATE INDEX idx_titulos_venda ON titulos(venda_id);
  CREATE INDEX idx_titulos_imp ON titulos(importacao_id);

  CREATE TABLE recebimentos (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL,
    forma TEXT NOT NULL DEFAULT 'pix',
    pagador_nome TEXT,
    pagador_norm TEXT,
    pagador_documento TEXT,
    banco TEXT,
    ref_externa TEXT UNIQUE,
    cliente_id INTEGER REFERENCES clientes(id),
    vendedor_id INTEGER REFERENCES vendedores(id),
    titulo_informado_id INTEGER,
    arquivo_id INTEGER REFERENCES arquivos(id),
    status TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado','pendente','cancelado')),
    origem TEXT NOT NULL DEFAULT 'manual',
    observacoes TEXT,
    importacao_id INTEGER,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_receb_data ON recebimentos(data);
  CREATE INDEX idx_receb_cli ON recebimentos(cliente_id);
  CREATE INDEX idx_receb_vend ON recebimentos(vendedor_id);
  CREATE INDEX idx_receb_imp ON recebimentos(importacao_id);

  CREATE TABLE baixas (
    id INTEGER PRIMARY KEY,
    titulo_id INTEGER NOT NULL REFERENCES titulos(id) ON DELETE CASCADE,
    recebimento_id INTEGER NOT NULL REFERENCES recebimentos(id) ON DELETE CASCADE,
    valor_centavos INTEGER NOT NULL,
    data TEXT NOT NULL,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_baixas_titulo ON baixas(titulo_id);
  CREATE INDEX idx_baixas_receb ON baixas(recebimento_id);

  CREATE TABLE ordens_producao (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    planejado REAL NOT NULL,
    cancelada INTEGER NOT NULL DEFAULT 0,
    observacoes TEXT,
    importacao_id INTEGER,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_ordens_data ON ordens_producao(data);

  CREATE TABLE estoque_movimentos (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada','producao','devolucao','ajuste','saida','venda','retirada','perda')),
    quantidade REAL NOT NULL,
    vendedor_id INTEGER REFERENCES vendedores(id),
    valor_unit_centavos INTEGER NOT NULL DEFAULT 0,
    ordem_producao_id INTEGER REFERENCES ordens_producao(id) ON DELETE SET NULL,
    venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
    observacoes TEXT,
    importacao_id INTEGER,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_mov_data ON estoque_movimentos(data);
  CREATE INDEX idx_mov_prod ON estoque_movimentos(produto_id);
  CREATE INDEX idx_mov_vend ON estoque_movimentos(vendedor_id);
  CREATE INDEX idx_mov_imp ON estoque_movimentos(importacao_id);

  CREATE TABLE importacoes (
    id INTEGER PRIMARY KEY,
    arquivo_id INTEGER REFERENCES arquivos(id),
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL,
    formato TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'previa' CHECK (status IN ('previa','confirmada','desfeita','descartada','erro')),
    dados_json TEXT,
    resumo_json TEXT,
    erro TEXT,
    criado_por INTEGER,
    criado_em TEXT NOT NULL DEFAULT (${NOW}),
    confirmado_em TEXT,
    desfeito_em TEXT
  );

  CREATE TABLE auditoria (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER,
    usuario_nome TEXT,
    acao TEXT NOT NULL,
    entidade TEXT,
    entidade_id INTEGER,
    detalhes TEXT,
    ip TEXT,
    criado_em TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_auditoria_criado ON auditoria(criado_em);

  CREATE VIEW v_titulos AS
  SELECT t.*,
    COALESCE((SELECT SUM(b.valor_centavos) FROM baixas b JOIN recebimentos r ON r.id = b.recebimento_id
              WHERE b.titulo_id = t.id AND r.status = 'confirmado'), 0) AS pago_centavos
  FROM titulos t;

  CREATE VIEW v_recebimentos AS
  SELECT r.*,
    COALESCE((SELECT SUM(b.valor_centavos) FROM baixas b WHERE b.recebimento_id = r.id), 0) AS alocado_centavos
  FROM recebimentos r;
  `,
];

function migrate() {
  const current = raw.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    raw.exec('BEGIN');
    try {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  }
}
migrate();

// ---------- helpers de acesso ----------
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = raw.prepare(sql);
    if (cache.size > 500) cache.clear();
    cache.set(sql, s);
  }
  return s;
}
function clean(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p && typeof p === 'object' && !Array.isArray(p) && !(p instanceof Uint8Array)) {
      const o = {};
      for (const [k, v] of Object.entries(p)) o[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
      return o;
    }
    return p;
  });
}

let depth = 0;
export const db = {
  raw,
  all: (sql, ...p) => stmt(sql).all(...clean(p)).map((r) => ({ ...r })),
  get: (sql, ...p) => {
    const r = stmt(sql).get(...clean(p));
    return r ? { ...r } : undefined;
  },
  run: (sql, ...p) => {
    const r = stmt(sql).run(...clean(p));
    if (Number(r.changes) > 0) backupRemoto.marcarSujo();
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
  exec: (sql) => { raw.exec(sql); backupRemoto.marcarSujo(); },
  /** Executa várias operações como UMA só: ou grava tudo, ou nada. */
  tx(fn) {
    if (depth > 0) {
      const sp = `sp${depth}`;
      raw.exec(`SAVEPOINT ${sp}`);
      depth++;
      try {
        const r = fn();
        depth--;
        raw.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        depth--;
        raw.exec(`ROLLBACK TO ${sp}`);
        raw.exec(`RELEASE ${sp}`);
        throw e;
      }
    }
    raw.exec('BEGIN IMMEDIATE');
    depth = 1;
    try {
      const r = fn();
      raw.exec('COMMIT');
      depth = 0;
      return r;
    } catch (e) {
      try { raw.exec('ROLLBACK'); } catch { /* já finalizada */ }
      depth = 0;
      throw e;
    }
  },
};

// ---------- configurações ----------
const DEFAULTS = {
  empresa_nome: 'Bom Gosto da Amazônia',
  empresa_telefone: '',
  empresa_cnpj: '',
  fuso_horario: config.defaultTZ,
  msg_cobranca:
    'Olá, {cliente}! Aqui é da {empresa}. Passando para lembrar do valor de {valor} com vencimento em {vencimento}. Se já pagou, por favor envie o comprovante do Pix. Obrigado!',
  vendas_a_vista_pagas: '1',
};
for (const [k, v] of Object.entries(DEFAULTS)) db.run('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)', k, v);

export function getSettings() {
  const out = {};
  for (const r of db.all('SELECT chave, valor FROM configuracoes')) out[r.chave] = r.valor;
  return out;
}
export function getSetting(k, fallback = '') {
  const r = db.get('SELECT valor FROM configuracoes WHERE chave = ?', k);
  return r ? r.valor : fallback;
}
export function setSetting(k, v) {
  db.run('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', k, String(v ?? ''));
}
export const getTZ = () => getSetting('fuso_horario', config.defaultTZ) || config.defaultTZ;

export function closeDb() {
  try { raw.close(); } catch { /* */ }
}
