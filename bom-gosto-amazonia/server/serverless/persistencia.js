// Guarda o banco de dados do painel no Netlify Blobs (hospedagem "sem servidor").
//
// Como funciona (resumo):
//  - O banco "de verdade" é UM arquivo no Blobs (compactado). Cada acesso ao servidor trabalha numa cópia em /tmp.
//  - Antes de cada requisição: confere (com o "etag") se o banco mudou; se mudou, baixa a versão nova.
//  - Se a requisição gravou algo, o banco inteiro é enviado de volta com "onlyIfMatch": só vale se ninguém gravou
//    nesse meio tempo. Se outra pessoa gravou antes, a gravação é recusada, a cópia local é descartada e a requisição
//    é REPETIDA sobre o banco novo — assim ninguém sobrescreve o trabalho do outro.
//  - A resposta só volta ao navegador depois que a gravação foi confirmada (nada de "salvou" sem ter salvo).
//  - Uma cópia diária (últimos 30 dias) fica em copias/AAAA-MM-DD.db.gz.
//  - Arquivos enviados (comprovantes, PDFs, planilhas) ficam em arquivos/<hash>.<ext> (nomeados pelo conteúdo).
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
/** O etag do Netlify Blobs é o MD5 do conteúdo, entre aspas. */
export const etagDe = (buf) => `"${crypto.createHash('md5').update(buf).digest('hex')}"`;
const para8601Dia = (d) => d.toISOString().slice(0, 10);

export class PersistenciaBlobs {
  /**
   * @param opts.banco     adaptador do banco: { escritas(), bytes(), substituir(buf), vazio() }
   * @param opts.store     armazenamento do Blobs (pode ser trocado a cada requisição com usarStore)
   * @param opts.lerLocal  (caminhoRelativo) => Buffer | null  — lê um arquivo enviado do disco temporário
   */
  constructor({ banco, store = null, lerLocal = () => null, log = console, agora = () => new Date(), manterCopias = 30, chave = 'banco/painel.db.gz', prefixoCopias = 'copias/', prefixoArquivos = 'arquivos/' }) {
    this.banco = banco;
    this.store = store;
    this.lerLocal = lerLocal;
    this.log = log;
    this.agora = agora;
    this.manterCopias = manterCopias;
    this.chave = chave;
    this.prefixoCopias = prefixoCopias;
    this.prefixoArquivos = prefixoArquivos;
    this.etag = null; // versão do banco que está na cópia local (null = não confiar na cópia local)
    this.arquivosPendentes = new Set();
    this.ultimoDiaCopia = null;
    this.estado = { ultima_gravacao: null, ultima_copia_diaria: null, ultimo_erro: null, gravacoes: 0, conflitos: 0 };
  }

  usarStore(store) { this.store = store; }

  /** Descarta a cópia local (ex.: houve conflito ou erro): a próxima requisição baixa tudo de novo. */
  invalidar() { this.etag = null; this.arquivosPendentes.clear(); }

  // ---------------------------------------------------------------- antes da requisição
  /** Garante que a cópia local do banco é a mais recente. Devolve 'atual' | 'baixado' | 'criado'. */
  async sincronizar() {
    const opcoes = { type: 'arrayBuffer', consistency: 'strong' };
    if (this.etag) opcoes.etag = this.etag;
    const r = await this.store.getWithMetadata(this.chave, opcoes);
    if (r === null || r === undefined) return this.criarInicial();
    if (r.data === null) return 'atual'; // 304: nada mudou desde a última vez
    this.instalar(r.data, r.etag, r.metadata);
    return 'baixado';
  }

  instalar(arrayBuffer, etag, metadata = null) {
    let bruto;
    try {
      bruto = zlib.gunzipSync(Buffer.from(arrayBuffer));
    } catch (e) {
      this.etag = null;
      throw new Error(`A cópia do banco de dados está ilegível (${e.message}). Nada foi alterado.`);
    }
    try {
      this.banco.substituir(bruto);
    } catch (e) {
      this.etag = null;
      throw new Error(`O banco de dados guardado não abriu (${e.message}). Nada foi alterado.`);
    }
    this.etag = etag ?? etagDe(Buffer.from(arrayBuffer));
    if (metadata?.gravado_em) this.estado.ultima_gravacao = metadata.gravado_em;
  }

  async criarInicial() {
    this.etag = null;
    this.banco.vazio();
    const gz = zlib.gzipSync(this.banco.bytes());
    const r = await this.store.set(this.chave, gz, { onlyIfNew: true, metadata: this.metadados() });
    if (r.modified) {
      this.etag = r.etag ?? etagDe(gz);
      this.registrarGravacao();
      return 'criado';
    }
    // Outro acesso criou o banco no mesmo instante: usa o dele.
    const o = await this.store.getWithMetadata(this.chave, { type: 'arrayBuffer', consistency: 'strong' });
    if (!o || o.data === null) throw new Error('Não foi possível criar o banco de dados no armazenamento.');
    this.instalar(o.data, o.etag, o.metadata);
    return 'baixado';
  }

  // ---------------------------------------------------------------- depois da requisição
  /** Envia os arquivos recém-enviados (comprovantes, PDFs…) ao armazenamento. */
  async enviarArquivosPendentes() {
    for (const rel of [...this.arquivosPendentes]) {
      const dados = this.lerLocal(rel);
      if (!dados) { this.arquivosPendentes.delete(rel); continue; }
      await this.store.set(this.prefixoArquivos + rel, dados, { onlyIfNew: true }); // nomeado pelo conteúdo: se já existe, é igual
      this.arquivosPendentes.delete(rel);
    }
  }

  /**
   * Grava o banco inteiro, mas só se ninguém gravou antes. Devolve true (gravou) ou false (conflito: repetir a requisição).
   * Se der erro de rede, tenta de novo; se mesmo assim falhar, lança o erro (e a cópia local é descartada).
   */
  async confirmar() {
    const gz = zlib.gzipSync(this.banco.bytes());
    const meu = etagDe(gz);
    const condicao = this.etag ? { onlyIfMatch: this.etag } : { onlyIfNew: true };
    let r = null;
    let ultimoErro = null;
    for (let t = 0; t < 3 && !r; t++) {
      try {
        r = await this.store.set(this.chave, gz, { ...condicao, metadata: this.metadados() });
      } catch (e) {
        ultimoErro = e;
        await pausa(150 * (t + 1));
      }
    }
    if (!r) {
      // Pode ser que a gravação tenha chegado mesmo sem a resposta ter voltado: confere antes de desistir.
      const atual = await this.store.getMetadata(this.chave, { consistency: 'strong' }).catch(() => null);
      if (atual?.etag === meu) r = { modified: true, etag: meu };
      else { this.invalidar(); this.estado.ultimo_erro = String(ultimoErro?.message || ultimoErro); throw ultimoErro; }
    }
    if (r.modified) {
      this.etag = r.etag ?? meu;
      this.registrarGravacao();
      await this.copiaDiaria(gz);
      return true;
    }
    // Recusado: ou outro acesso gravou antes (conflito) ou a nossa gravação anterior já tinha chegado.
    const atual = await this.store.getMetadata(this.chave, { consistency: 'strong' });
    if (atual?.etag === meu) {
      this.etag = meu;
      this.registrarGravacao();
      return true;
    }
    this.estado.conflitos++;
    this.invalidar();
    return false;
  }

  metadados() { return { gravado_em: this.agora().toISOString() }; }

  registrarGravacao() {
    this.estado.gravacoes++;
    this.estado.ultima_gravacao = this.agora().toISOString();
    this.estado.ultimo_erro = null;
  }

  // ---------------------------------------------------------------- cópia diária
  /** Na primeira gravação de cada dia, guarda uma cópia do banco (mantém as últimas 30). Nunca derruba a requisição. */
  async copiaDiaria(gz) {
    try {
      const dia = para8601Dia(this.agora());
      if (this.ultimoDiaCopia === dia) return;
      const chave = `${this.prefixoCopias}${dia}.db.gz`;
      const existe = await this.store.getMetadata(chave, { consistency: 'strong' });
      if (!existe) await this.store.set(chave, gz);
      this.ultimoDiaCopia = dia;
      this.estado.ultima_copia_diaria = dia;
      const { blobs } = await this.store.list({ prefix: this.prefixoCopias });
      const antigas = blobs.map((b) => b.key).sort().slice(0, Math.max(0, blobs.length - this.manterCopias));
      for (const k of antigas) await this.store.delete(k);
    } catch (e) {
      this.log.error('[persistencia] não consegui guardar a cópia diária:', e?.message || e);
    }
  }

  // ---------------------------------------------------------------- arquivos enviados
  registrarArquivo(rel) { this.arquivosPendentes.add(rel); }

  async obterArquivo(rel) {
    const ab = await this.store.get(this.prefixoArquivos + rel, { type: 'arrayBuffer', consistency: 'strong' });
    return ab ? Buffer.from(ab) : null;
  }

  /** Para a tela de Configurações. */
  info() {
    return {
      tipo: 'netlify-blobs',
      ultima_gravacao: this.estado.ultima_gravacao,
      ultima_copia_diaria: this.estado.ultima_copia_diaria,
      conflitos_resolvidos: this.estado.conflitos,
      ultimo_erro: this.estado.ultimo_erro,
    };
  }
}
