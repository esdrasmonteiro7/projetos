// Localizar e criar clientes, vendedores e produtos (com reconhecimento de nomes parecidos).
import { db } from '../db.js';
import { norm, nameScore, tokensOf, digits } from '../../shared/text.js';

// ---------------- Vendedores ----------------
export function acharVendedor(nome, lista = null) {
  const n = norm(nome);
  if (!n) return null;
  const todos = lista || db.all('SELECT id, nome, nome_norm, ativo FROM vendedores');
  const preferir = (arr) => [...arr].sort((a, b) => b.ativo - a.ativo)[0];
  const exatos = todos.filter((v) => v.nome_norm === n);
  if (exatos.length) return { id: preferir(exatos).id, nome: preferir(exatos).nome, tipo: 'exato', score: 1 };

  const tn = tokensOf(n);
  const mesmosTokens = todos.filter((v) => {
    const tv = tokensOf(v.nome_norm);
    return tv.length === tn.length && tv.every((t) => tn.includes(t));
  });
  if (mesmosTokens.length === 1) return { id: mesmosTokens[0].id, nome: mesmosTokens[0].nome, tipo: 'exato', score: 1 };

  // só o primeiro nome ("Marcos") e existe um único vendedor com esse primeiro nome
  const primeiro = todos.filter((v) => tokensOf(v.nome_norm)[0] === tn[0] && (tn.length === 1 || tokensOf(v.nome_norm).length === 1));
  if (tn.length >= 1 && primeiro.length === 1 && tn[0].length >= 3) {
    return { id: primeiro[0].id, nome: primeiro[0].nome, tipo: 'parecido', score: 0.9 };
  }
  let best = null;
  let second = 0;
  for (const v of todos) {
    const s = nameScore(n, v.nome_norm);
    if (!best || s > best.score) { second = best ? best.score : 0; best = { id: v.id, nome: v.nome, tipo: 'parecido', score: s }; }
    else if (s > second) second = s;
  }
  if (best && best.score >= 0.88 && best.score - second > 0.05) return best;
  return null;
}

export function criarVendedor({ nome, telefone = null, email = null, comissao_pct = 0, observacoes = null }) {
  const r = db.run(
    'INSERT INTO vendedores (nome, nome_norm, telefone, email, comissao_pct, observacoes) VALUES (?,?,?,?,?,?)',
    nome.trim(), norm(nome), telefone, email, comissao_pct, observacoes,
  );
  return r.id;
}

// ---------------- Clientes ----------------
/** Índice em memória para reconhecer clientes rapidamente durante importações grandes. */
export class ClienteIndex {
  constructor() {
    this.porDoc = new Map();
    this.porNorm = new Map();
    this.porToken = new Map();
    this.todos = new Map();
    for (const c of db.all('SELECT id, nome, nome_norm, documento, ativo FROM clientes')) this.add(c);
  }

  add(c) {
    this.todos.set(c.id, c);
    if (c.documento && digits(c.documento).length >= 11) this.porDoc.set(digits(c.documento), c);
    const prev = this.porNorm.get(c.nome_norm);
    if (!prev || (prev.ativo === 0 && c.ativo !== 0)) this.porNorm.set(c.nome_norm, c);
    for (const t of new Set(tokensOf(c.nome_norm))) {
      if (!this.porToken.has(t)) this.porToken.set(t, []);
      this.porToken.get(t).push(c);
    }
  }

  /** { cliente, tipo: 'documento'|'exato'|'parecido', score } ou null */
  find({ nome, documento }) {
    const doc = digits(documento);
    if (doc.length >= 11 && this.porDoc.has(doc)) return { cliente: this.porDoc.get(doc), tipo: 'documento', score: 1 };
    const n = norm(nome);
    if (!n) return null;
    if (this.porNorm.has(n)) return { cliente: this.porNorm.get(n), tipo: 'exato', score: 1 };
    // candidatos que dividem pelo menos um token raro
    const tokens = tokensOf(n);
    if (!tokens.length) return null;
    const cand = new Map();
    for (const t of tokens) {
      const lista = this.porToken.get(t);
      if (lista && lista.length <= 400) for (const c of lista) cand.set(c.id, c);
    }
    let best = null;
    for (const c of cand.values()) {
      const s = nameScore(n, c.nome_norm);
      if (!best || s > best.score) best = { cliente: c, tipo: 'parecido', score: s };
    }
    return best && best.score >= 0.82 ? best : null;
  }
}

export function criarCliente(d) {
  const nome = String(d.nome).trim();
  const r = db.run(
    `INSERT INTO clientes (nome, nome_norm, documento, telefone, email, endereco, cidade, vendedor_id, observacoes, importacao_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    nome, norm(nome), digits(d.documento) || null, d.telefone || null, d.email || null, d.endereco || null,
    d.cidade || null, d.vendedor_id || null, d.observacoes || null, d.importacao_id || null,
  );
  return r.id;
}

// ---------------- Produtos ----------------
export class ProdutoIndex {
  constructor() {
    this.porNorm = new Map();
    this.porSku = new Map();
    for (const p of db.all('SELECT id, nome, nome_norm, sku, unidade FROM produtos')) this.add(p);
  }

  add(p) {
    this.porNorm.set(p.nome_norm, p);
    if (p.sku) this.porSku.set(String(p.sku).trim().toLowerCase(), p);
  }

  find({ nome, sku }) {
    if (sku && this.porSku.has(String(sku).trim().toLowerCase())) return this.porSku.get(String(sku).trim().toLowerCase());
    const n = norm(nome);
    if (n && this.porNorm.has(n)) return this.porNorm.get(n);
    return null;
  }
}

export function criarProduto(d) {
  const r = db.run(
    `INSERT INTO produtos (nome, nome_norm, sku, unidade, preco_centavos, custo_centavos, categoria, estoque_minimo, importacao_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    String(d.nome).trim(), norm(d.nome), d.sku || null, d.unidade || 'un', d.preco_centavos || 0,
    d.custo_centavos || 0, d.categoria || null, d.estoque_minimo || 0, d.importacao_id || null,
  );
  return r.id;
}
