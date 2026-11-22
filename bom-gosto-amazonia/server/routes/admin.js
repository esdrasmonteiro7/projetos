// Painel (números), histórico de ações, configurações e backup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Router } from 'express';
import { db, getSettings, setSetting, backupRemoto } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin, scopeOf, audit } from '../auth.js';
import { bad, str, paging, likeTerm, ym as ymParam } from '../lib/http.js';
import { resumo, hojeEmpresa } from '../services/metrics.js';
import { todayISO } from '../../shared/dates.js';
import { hospedagem } from '../services/hospedagem.js';

export const router = Router();
router.use(requireAuth);

router.get('/dashboard', (req, res) => {
  const sc = scopeOf(req);
  const ym = ymParam(req.query.mes, hojeEmpresa().slice(0, 7));
  res.json(resumo({ ym, vendedorId: sc.vendedorId, admin: sc.admin }));
});

/** Dados em disco temporário (sem disco permanente)? Só faz sentido avisar em produção. */
function dadosEfemeros() {
  if (!config.isProd || config.serverless) return false; // sem servidor (Netlify): o banco já fica guardado fora do disco temporário
  try { return fs.statSync(config.dataDir).dev === fs.statSync('/').dev; } catch { return false; }
}
const estadoBackup = () => ({ ...backupRemoto.estado, ativo: backupRemoto.ativo, config_erro: backupRemoto.cfg.erroConfig || null, dados_efemeros: dadosEfemeros() });

router.get('/alertas', (req, res) => {
  const sc = scopeOf(req);
  const hoje = hojeEmpresa();
  const v = sc.vendedorId;
  const out = {
    pendentes: db.get(`SELECT COUNT(*) AS n FROM recebimentos WHERE status = 'pendente'${v ? ' AND vendedor_id = ?' : ''}`, ...(v ? [v] : [])).n,
    vencidos: db.get(`SELECT COUNT(*) AS n FROM v_titulos WHERE cancelado = 0 AND valor_centavos > pago_centavos AND vencimento < ?${v ? ' AND vendedor_id = ?' : ''}`, hoje, ...(v ? [v] : [])).n,
    sem_baixa: sc.admin ? db.get("SELECT COUNT(*) AS n FROM v_recebimentos WHERE status = 'confirmado' AND valor_centavos > alocado_centavos").n : 0,
  };
  if (sc.admin) {
    const b = estadoBackup();
    if (!b.ativo && b.dados_efemeros) out.backup = { problema: 'sem_backup', texto: 'Seus dados estão em um disco TEMPORÁRIO e o backup automático no GitHub não está ligado. Se o serviço reiniciar, tudo pode ser perdido.' };
    else if (b.ativo && (b.config_erro || b.ultimo_erro)) out.backup = { problema: 'falhando', texto: `O backup automático está falhando: ${b.config_erro || b.ultimo_erro}` };
  }
  res.json(out);
});

router.get('/auditoria', requireAdmin, (req, res) => {
  const { limite, offset, pagina } = paging(req.query, { max: 200, def: 60 });
  const where = [];
  const params = [];
  if (req.query.busca) {
    where.push("(acao LIKE ? ESCAPE '\\' OR usuario_nome LIKE ? ESCAPE '\\' OR detalhes LIKE ? ESCAPE '\\')");
    const t = likeTerm(req.query.busca);
    params.push(t, t, t);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM auditoria ${w}`, ...params).n;
  const itens = db.all(`SELECT * FROM auditoria ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limite, offset);
  res.json({ itens, total, pagina, limite });
});

const CHAVES = ['empresa_nome', 'empresa_telefone', 'empresa_cnpj', 'fuso_horario', 'msg_cobranca', 'vendas_a_vista_pagas'];

router.get('/configuracoes', requireAdmin, (_req, res) => {
  const s = getSettings();
  res.json({
    ...Object.fromEntries(CHAVES.map((k) => [k, s[k] ?? ''])),
    backup_remoto: estadoBackup(),
    armazenamento: hospedagem.info(),
    ia_disponivel: !!config.anthropicKey,
    versao: '1.0.0',
    dados_em: config.serverless ? 'Netlify (armazenamento seguro, salvo a cada alteração)' : config.dataDir,
  });
});

router.put('/configuracoes', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.fuso_horario !== undefined) {
    try { todayISO(b.fuso_horario); } catch { throw bad('Fuso horário inválido (exemplo: America/Manaus).'); }
  }
  for (const k of CHAVES) {
    if (b[k] === undefined) continue;
    const max = k === 'msg_cobranca' ? 600 : 160;
    setSetting(k, str(b[k], { max, name: k }) ?? '');
  }
  audit(req, 'Alterou configurações', 'configuracoes', null, Object.keys(b).filter((k) => CHAVES.includes(k)));
  res.json({ ok: true });
});

router.post('/backup/remoto/agora', requireAdmin, async (req, res) => {
  if (!backupRemoto.ativo) throw bad('O backup automático no GitHub não está ligado neste servidor.');
  const ok = await backupRemoto.agora();
  audit(req, 'Pediu backup externo agora', 'backup', null, { ok });
  if (!ok) throw bad(`Não consegui enviar o backup: ${backupRemoto.estado.ultimo_erro || 'erro desconhecido'}`);
  res.json({ ok: true, estado: estadoBackup() });
});

// Cópia de segurança do banco inteiro (um arquivo .db). Guarde em lugar seguro.
router.get('/backup', requireAdmin, (req, res) => {
  const tmpDir = path.join(config.dataDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `backup-${crypto.randomBytes(6).toString('hex')}.db`);
  db.raw.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  audit(req, 'Baixou backup do banco de dados', 'backup');
  if (config.serverless) {
    // a resposta da Netlify é limitada a ~6 MB, então o backup vai compactado (.gz; abre com qualquer descompactador)
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    fs.rmSync(tmp, { force: true });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="bom-gosto-backup-${hojeEmpresa()}.db.gz"`);
    return res.send(gz);
  }
  const nome = `bom-gosto-backup-${hojeEmpresa()}.db`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.sendFile(tmp, (err) => {
    fs.rm(tmp, { force: true }, () => {});
    if (err && !res.headersSent) res.status(500).json({ erro: 'Não foi possível gerar o backup.' });
  });
});

// Planilha com todos os dados (útil para conferir ou levar para o Excel)
router.get('/saude', requireAdmin, (_req, res) => {
  const n = (t) => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  res.json({ vendas: n('vendas'), titulos: n('titulos'), recebimentos: n('recebimentos'), clientes: n('clientes'), produtos: n('produtos'), vendedores: n('vendedores') });
});
