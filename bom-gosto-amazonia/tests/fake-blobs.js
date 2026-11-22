// Netlify Blobs "de mentira" para os testes: mesmas respostas do serviço real (etag = MD5 do conteúdo,
// gravação condicional onlyIfMatch/onlyIfNew, leitura condicional por etag) e ganchos para simular falhas e concorrência.
import crypto from 'node:crypto';

const paraBuffer = (v) => {
  if (typeof v === 'string') return Buffer.from(v);
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  return Buffer.from(v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
};
const paraArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const etagDe = (b) => `"${crypto.createHash('md5').update(b).digest('hex')}"`;

export class FakeBlobs {
  constructor() {
    this.dados = new Map(); // chave -> { bytes, etag, metadata }
    this.chamadas = []; // [metodo, chave]
    this.antesDeSet = null; // (chave, opcoes, n) => void  — roda antes de aplicar um set (para simular outra pessoa gravando)
    this.falhasAntes = 0; // quantos set() vão lançar erro SEM aplicar
    this.falhasDepois = 0; // quantos set() vão aplicar e depois lançar erro (resposta perdida)
    this.nSet = 0;
  }

  conta(metodo, chave = null) { return this.chamadas.filter(([m, k]) => m === metodo && (chave === null || k === chave)).length; }

  /** Grava direto, como se fosse outro servidor (sem condições). */
  gravarDireto(chave, valor, metadata = {}) {
    const bytes = paraBuffer(valor);
    const etag = etagDe(bytes);
    this.dados.set(chave, { bytes, etag, metadata });
    return etag;
  }

  async get(chave, { type = 'text' } = {}) {
    this.chamadas.push(['get', chave]);
    const e = this.dados.get(chave);
    if (!e) return null;
    return type === 'arrayBuffer' ? paraArrayBuffer(e.bytes) : e.bytes.toString('utf8');
  }

  async getMetadata(chave) {
    this.chamadas.push(['getMetadata', chave]);
    const e = this.dados.get(chave);
    return e ? { etag: e.etag, metadata: e.metadata } : null;
  }

  async getWithMetadata(chave, { type = 'text', etag } = {}) {
    this.chamadas.push(['getWithMetadata', chave]);
    const e = this.dados.get(chave);
    if (!e) return null;
    if (etag && etag === e.etag) return { data: null, etag: e.etag, metadata: e.metadata };
    return { data: type === 'arrayBuffer' ? paraArrayBuffer(e.bytes) : e.bytes.toString('utf8'), etag: e.etag, metadata: e.metadata };
  }

  async set(chave, valor, { onlyIfMatch, onlyIfNew, metadata = {} } = {}) {
    this.chamadas.push(['set', chave]);
    this.nSet++;
    if (this.antesDeSet) this.antesDeSet(chave, { onlyIfMatch, onlyIfNew }, this.nSet);
    if (this.falhasAntes > 0) { this.falhasAntes--; throw new Error('falha de rede (antes de gravar)'); }
    const atual = this.dados.get(chave);
    let resultado;
    if ((onlyIfNew && atual) || (onlyIfMatch && (!atual || atual.etag !== onlyIfMatch))) resultado = { modified: false };
    else {
      const bytes = paraBuffer(valor);
      const etag = etagDe(bytes);
      this.dados.set(chave, { bytes, etag, metadata });
      resultado = { modified: true, etag };
    }
    if (this.falhasDepois > 0 && resultado.modified) { this.falhasDepois--; throw new Error('falha de rede (resposta perdida)'); }
    return resultado;
  }

  async delete(chave) {
    this.chamadas.push(['delete', chave]);
    this.dados.delete(chave);
  }

  async list({ prefix = '' } = {}) {
    this.chamadas.push(['list', prefix]);
    return { blobs: [...this.dados.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, etag: e.etag })), directories: [] };
  }
}
