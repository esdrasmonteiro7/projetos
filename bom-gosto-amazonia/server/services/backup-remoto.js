// Backup externo e criptografado do banco de dados, guardado num repositório PRIVADO do GitHub (como "anexos" de uma release).
// Por que existe: hospedagens grátis (ex.: Render) apagam o disco quando o serviço reinicia ou "dorme". Com este backup:
//   • ao iniciar sem banco local, o painel RESTAURA o último backup;
//   • depois de qualquer alteração, envia um novo backup em poucos segundos;
//   • ao desligar, envia o backup final.
// O arquivo vai criptografado (AES-256-GCM) com a BACKUP_KEY: nem o GitHub consegue ler o conteúdo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = Buffer.from('BGB1');
const PREFIXO = 'painel-';
const SUFIXO = '.db.enc';

// ------------------------------------------------------------------ criptografia
export function cifrar(buf, senha) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const chave = crypto.scryptSync(senha, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  c.setAAD(MAGIC);
  const dados = Buffer.concat([c.update(zlib.gzipSync(buf, { level: 6 })), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), dados]);
}

export function decifrar(buf, senha) {
  if (buf.length < 48 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('arquivo de backup inválido');
  const salt = buf.subarray(4, 20);
  const iv = buf.subarray(20, 32);
  const tag = buf.subarray(32, 48);
  const chave = crypto.scryptSync(senha, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', chave, iv);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  try {
    return zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(48)), d.final()]));
  } catch {
    throw new Error('a BACKUP_KEY não confere com a usada ao criar este backup (ou o arquivo está corrompido)');
  }
}

// ------------------------------------------------------------------ armazenamento (GitHub Releases)
export class GitHubReleaseStore {
  constructor({ repo, token, tag = 'backups-painel', apiUrl = 'https://api.github.com', uploadUrl = 'https://uploads.github.com' }) {
    this.repo = repo;
    this.token = token;
    this.tag = tag;
    this.api = apiUrl.replace(/\/$/, '');
    this.upload = uploadUrl.replace(/\/$/, '');
    this.releaseId = null;
  }

  async _fetch(url, { method = 'GET', body, headers = {}, aceitar = [] } = {}) {
    const r = await fetch(url, {
      method,
      body,
      headers: { authorization: `Bearer ${this.token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'painel-bom-gosto', ...headers },
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok && !aceitar.includes(r.status)) {
      let det = '';
      try { det = (await r.text()).slice(0, 300); } catch { /* */ }
      const dica = r.status === 401 || r.status === 403
        ? ' — confira o BACKUP_GITHUB_TOKEN (precisa de permissão "Contents: Read and write" no repositório de backup)'
        : r.status === 404 ? ' — confira o BACKUP_GITHUB_REPO (formato usuario/repositorio) e se o token tem acesso a ele' : '';
      throw new Error(`GitHub respondeu ${r.status}${dica}. ${det}`.trim());
    }
    return r;
  }

  async obterRelease({ criar = false } = {}) {
    const r = await this._fetch(`${this.api}/repos/${this.repo}/releases/tags/${this.tag}`, { headers: { accept: 'application/vnd.github+json' }, aceitar: [404] });
    if (r.status === 200) {
      const rel = await r.json();
      this.releaseId = rel.id;
      return rel;
    }
    if (!criar) return null;
    const c = await this._fetch(`${this.api}/repos/${this.repo}/releases`, {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ tag_name: this.tag, name: 'Backups automáticos do painel', body: 'Arquivos criptografados. Não apague.', draft: false, prerelease: true }),
      aceitar: [422],
    });
    if (c.status === 422) throw new Error('não consegui criar a "release" de backup. O repositório de backup precisa ter pelo menos 1 arquivo (crie-o marcando "Add a README file").');
    const rel = await c.json();
    this.releaseId = rel.id;
    return rel;
  }

  /** Backups existentes, do mais novo para o mais antigo. */
  async listar() {
    const rel = await this.obterRelease();
    if (!rel) return [];
    return (rel.assets || []).filter((a) => a.name.startsWith(PREFIXO) && a.name.endsWith(SUFIXO)).sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  async enviar(nome, buffer) {
    const rel = this.releaseId ? { id: this.releaseId } : await this.obterRelease({ criar: true });
    const id = rel.id;
    const r = await this._fetch(`${this.upload}/repos/${this.repo}/releases/${id}/assets?name=${encodeURIComponent(nome)}`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', accept: 'application/vnd.github+json' }, body: buffer,
    });
    return r.json();
  }

  async baixar(asset) {
    const r = await this._fetch(`${this.api}/repos/${this.repo}/releases/assets/${asset.id}`, { headers: { accept: 'application/octet-stream' } });
    return Buffer.from(await r.arrayBuffer());
  }

  async apagar(asset) {
    await this._fetch(`${this.api}/repos/${this.repo}/releases/assets/${asset.id}`, { method: 'DELETE', aceitar: [404] });
  }
}

// ------------------------------------------------------------------ serviço
export function lerConfigRemota(env = process.env) {
  const repo = (env.BACKUP_GITHUB_REPO || '').trim();
  const token = (env.BACKUP_GITHUB_TOKEN || '').trim();
  const senha = env.BACKUP_KEY || '';
  const ativo = !!(repo && token);
  return {
    ativo,
    repo,
    token,
    senha,
    erroConfig: ativo && senha.length < 12 ? 'Defina BACKUP_KEY com pelo menos 12 caracteres (é a senha que criptografa o backup).' : null,
    manter: Math.max(2, Number(env.BACKUP_MANTER) || 4),
    dias: Math.max(1, Number(env.BACKUP_DIAS) || 14),
    atrasoSeg: Math.max(3, Number(env.BACKUP_ATRASO_SEG) || 12),
    apiUrl: env.GITHUB_API_URL || undefined,
    uploadUrl: env.GITHUB_UPLOAD_URL || undefined,
  };
}

/** Mantém os N mais recentes e o último de cada dia nos últimos D dias; o resto pode ser apagado. */
export function selecionarParaApagar(lista, manter = 4, dias = 14) {
  const ordenada = [...lista].sort((a, b) => (a.name < b.name ? 1 : -1)); // mais novo primeiro
  const guardar = new Set(ordenada.slice(0, manter).map((a) => a.name));
  const vistos = new Set();
  for (const a of ordenada) {
    const dia = a.name.slice(PREFIXO.length, PREFIXO.length + 8);
    if (!vistos.has(dia) && vistos.size < dias) { vistos.add(dia); guardar.add(a.name); }
  }
  return ordenada.filter((a) => !guardar.has(a.name));
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const nomeBackup = () => `${PREFIXO}${new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T')}${SUFIXO}`;

export class BackupRemoto {
  /**
   * @param cfg       resultado de lerConfigRemota()
   * @param opts.dbPath    caminho do banco local
   * @param opts.snapshot  (destino) => cria uma cópia consistente do banco em `destino` (VACUUM INTO)
   * @param opts.store     (teste) armazenamento alternativo
   */
  constructor(cfg, { dbPath, snapshot, store, log = console }) {
    this.cfg = cfg;
    this.dbPath = dbPath;
    this.snapshot = snapshot;
    this.log = log;
    this.ativo = !!cfg.ativo;
    this.store = store || (cfg.ativo ? new GitHubReleaseStore({ repo: cfg.repo, token: cfg.token, apiUrl: cfg.apiUrl, uploadUrl: cfg.uploadUrl }) : null);
    this.sujo = false;
    this.timer = null;
    this.emAndamento = null;
    this.estado = { ativo: this.ativo, repo: cfg.repo || null, ultimo_ok: null, ultimo_erro: null, ultimo_erro_em: null, tamanho: null, enviados: 0, restaurado_de: null, pendente: false };
  }

  /** Antes de abrir o banco: se não existe arquivo local, traz o último backup. Falha (sem criar banco vazio) se não conseguir. */
  async restaurarSeNecessario() {
    if (!this.ativo) return { restaurado: false };
    if (this.cfg.erroConfig) throw new Error(this.cfg.erroConfig);
    if (fs.existsSync(this.dbPath) && fs.statSync(this.dbPath).size > 0) return { restaurado: false, motivo: 'banco local já existe' };
    let ultimaFalha;
    for (const espera of [0, 2000, 6000, 15000]) {
      if (espera) await dormir(espera);
      try {
        const lista = await this.store.listar();
        if (!lista.length) {
          this.log.log('[backup] Nenhum backup anterior encontrado: iniciando com banco novo.');
          return { restaurado: false, motivo: 'sem backup anterior' };
        }
        const bruto = await this.store.baixar(lista[0]);
        const dados = decifrar(bruto, this.cfg.senha);
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        for (const ext of ['-wal', '-shm']) fs.rmSync(this.dbPath + ext, { force: true });
        fs.writeFileSync(this.dbPath, dados);
        this.estado.restaurado_de = lista[0].name;
        this.log.log(`[backup] Banco restaurado do backup ${lista[0].name} (${(dados.length / 1024).toFixed(0)} KB).`);
        return { restaurado: true, nome: lista[0].name };
      } catch (e) {
        ultimaFalha = e;
        if (/BACKUP_KEY/.test(e.message)) break; // senha errada não adianta repetir
        this.log.error(`[backup] Falha ao restaurar (${e.message}). Tentando de novo…`);
      }
    }
    throw new Error(`Não consegui restaurar o backup: ${ultimaFalha?.message}. Para proteger seus dados, o painel NÃO inicia com um banco vazio. Corrija e tente de novo.`);
  }

  /** Chamar depois de qualquer alteração no banco. */
  marcarSujo() {
    if (!this.ativo) return;
    this.sujo = true;
    this.estado.pendente = true;
    if (!this.timer && !this.emAndamento) {
      this.timer = setTimeout(() => { this.timer = null; this.agora().catch(() => {}); }, this.cfg.atrasoSeg * 1000);
    }
  }

  /** Faz o backup agora (junta pedidos simultâneos). */
  agora() {
    if (!this.ativo) return Promise.resolve(false);
    if (this.emAndamento) return this.emAndamento;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.emAndamento = (async () => {
      try {
        this.sujo = false;
        const tmp = `${this.dbPath}.backup-${process.pid}.tmp`;
        fs.rmSync(tmp, { force: true });
        this.snapshot(tmp);
        const bruto = fs.readFileSync(tmp);
        fs.rmSync(tmp, { force: true });
        const pacote = cifrar(bruto, this.cfg.senha);
        await this.store.enviar(nomeBackup(), pacote);
        this.estado.ultimo_ok = new Date().toISOString();
        this.estado.tamanho = pacote.length;
        this.estado.enviados++;
        this.estado.ultimo_erro = null;
        if (!this.sujo) this.estado.pendente = false;
        await this._limpar().catch((e) => this.log.error(`[backup] Não consegui apagar backups antigos: ${e.message}`));
        return true;
      } catch (e) {
        this.sujo = true;
        this.estado.ultimo_erro = e.message;
        this.estado.ultimo_erro_em = new Date().toISOString();
        this.log.error(`[backup] ERRO ao enviar backup: ${e.message}`);
        // tenta de novo em 1 minuto
        if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.agora().catch(() => {}); }, 60_000);
        return false;
      } finally {
        this.emAndamento = null;
        if (this.sujo && !this.timer && !this.estado.ultimo_erro) {
          this.timer = setTimeout(() => { this.timer = null; this.agora().catch(() => {}); }, this.cfg.atrasoSeg * 1000);
        }
      }
    })();
    return this.emAndamento;
  }

  async _limpar() {
    const lista = await this.store.listar();
    for (const a of selecionarParaApagar(lista, this.cfg.manter, this.cfg.dias)) await this.store.apagar(a);
  }

  /** No desligamento: manda o que estiver pendente. */
  async finalizar() {
    if (!this.ativo) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.emAndamento) await this.emAndamento;
    if (this.sujo) await this.agora();
  }
}

export function criarBackupRemoto({ dbPath, snapshot, env = process.env, store, log }) {
  return new BackupRemoto(lerConfigRemota(env), { dbPath, snapshot, store, log });
}
