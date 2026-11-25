// Importar arquivos (PDF, XML de NF-e, planilhas, CSV, OFX, ZIP): analisar → prévia → confirmar → (desfazer).
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, audit } from '../auth.js';
import { bad, notFound, int } from '../lib/http.js';
import { fmtBR } from '../../shared/dates.js';
import { abrirArquivo, enviarArquivo } from '../services/arquivos.js';
import { analisarArquivos, salvarPrevia } from '../services/import/previas.js';
import { PAPEIS_ROTULO } from '../services/import/tabela.js';
import { TIPOS, TIPOS_ROTULO, anotar, reprocessarTabela } from '../services/import/analisar.js';
import { confirmarImportacao, desfazerImportacao, finalizarImportacao } from '../services/import/confirmar.js';
import { hojeEmpresa } from '../services/metrics.js';
import { sugerir } from '../services/conciliacao.js';

export const router = Router();
// só vale para /importacoes (os routers compartilham o prefixo /api)
router.use('/importacoes', requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 80 } });

const nomeUtf8 = (n) => {
  const s = Buffer.from(String(n || 'arquivo'), 'latin1').toString('utf8');
  return s.includes('�') ? String(n) : s;
};

function carregar(id) {
  const imp = db.get('SELECT * FROM importacoes WHERE id = ?', id);
  if (!imp) throw notFound('Importação não encontrada.');
  return imp;
}
const lerDados = (imp) => (imp.dados_json ? JSON.parse(imp.dados_json) : null);

/** Versão enxuta para enviar ao navegador (sem a tabela inteira). */
function paraNavegador(imp) {
  const dados = lerDados(imp);
  const out = { importacao: { id: imp.id, nome: imp.nome, tipo: imp.tipo, formato: imp.formato, status: imp.status, criado_em: imp.criado_em, confirmado_em: imp.confirmado_em, arquivo_id: imp.arquivo_id }, resumo: imp.resumo_json ? JSON.parse(imp.resumo_json) : null };
  if (dados) {
    const { tabela, ...resto } = dados;
    out.dados = { ...resto, tabela: tabela ? { cabecalho: tabela.cabecalho, amostra: tabela.linhas.slice(0, 8), total_linhas: tabela.linhas.length, truncada: tabela.truncada } : null };
  }
  out.tipos = TIPOS_ROTULO;
  out.papeis = PAPEIS_ROTULO;
  return out;
}

router.post('/importacoes/analisar', upload.array('arquivos', 80), async (req, res) => {
  if (!req.files?.length) throw bad('Escolha pelo menos um arquivo.');
  const r = await analisarArquivos(req.files.map((f) => ({ buffer: f.buffer, nome: nomeUtf8(f.originalname), mime: f.mimetype })), req.user.id);
  audit(req, 'Enviou arquivos para importação', 'importacao', null, { arquivos: req.files.length, previas: r.importacoes.length });
  res.json(r);
});

router.get('/importacoes', (_req, res) => {
  const itens = db.all(
    `SELECT i.id, i.nome, i.tipo, i.formato, i.status, i.criado_em, i.confirmado_em, i.resumo_json, u.nome AS usuario
     FROM importacoes i LEFT JOIN usuarios u ON u.id = i.criado_por ORDER BY i.id DESC LIMIT 100`,
  ).map(({ resumo_json: rj, ...r }) => ({ ...r, resumo: rj ? JSON.parse(rj) : null }));
  res.json(itens);
});

router.get('/importacoes/:id', (req, res) => {
  res.json(paraNavegador(carregar(int(req.params.id, { required: true }))));
});

router.post('/importacoes/:id/reprocessar', (req, res) => {
  const id = int(req.params.id, { required: true });
  const imp = carregar(id);
  if (imp.status !== 'previa') throw bad('Esta importação já foi finalizada.');
  const dados = lerDados(imp);
  if (!dados?.tabela) throw bad('Só é possível ajustar colunas em planilhas/tabelas.');
  const tipo = req.body.tipo;
  if (!TIPOS.includes(tipo)) throw bad('Escolha o tipo de dado.');
  const mapeamento = {};
  for (const [k, v] of Object.entries(req.body.mapeamento || {})) {
    if (!/^\d+$/.test(k)) continue;
    if (v && v !== 'ignorar' && !PAPEIS_ROTULO[v]) throw bad(`Papel de coluna inválido: ${v}`);
    if (v) mapeamento[k] = v;
  }
  const novo = reprocessarTabela(dados, { tipo, mapeamento, opcoes: req.body.opcoes || {} }, { hoje: hojeEmpresa() });
  salvarPrevia(id, tipo, novo);
  res.json(paraNavegador(carregar(id)));
});

// Correções rápidas na prévia (ex.: preencher quem pagou o Pix, trocar vendedor)
router.patch('/importacoes/:id/registros/:idx', (req, res) => {
  const id = int(req.params.id, { required: true });
  const imp = carregar(id);
  if (imp.status !== 'previa') throw bad('Esta importação já foi finalizada.');
  const dados = lerDados(imp);
  const r = dados.registros[int(req.params.idx, { required: true })];
  if (!r) throw notFound('Linha não encontrada.');
  const b = req.body || {};
  const txt = (v, n = 160) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
  if ('pagador_nome' in b) r.pagador_nome = txt(b.pagador_nome);
  if ('vendedor_nome' in b) r.vendedor_nome = txt(b.vendedor_nome);
  if ('cliente_nome' in b && r.cliente) r.cliente.nome = txt(b.cliente_nome) || r.cliente.nome;
  if ('data' in b && /^\d{4}-\d{2}-\d{2}$/.test(b.data)) r.data = b.data;
  if ('vencimento' in b && /^\d{4}-\d{2}-\d{2}$/.test(b.vencimento)) r.vencimento = b.vencimento;
  if ('incluir' in b) r._incluir_forcado = !!b.incluir;
  salvarPrevia(id, imp.tipo, dados);
  res.json(paraNavegador(carregar(id)));
});

router.post('/importacoes/:id/confirmar', (req, res) => {
  const id = int(req.params.id, { required: true });
  const imp = carregar(id);
  if (imp.status !== 'previa') throw bad('Esta importação já foi finalizada.');
  const dados = lerDados(imp);
  if (!dados) throw bad('A prévia expirou. Envie o arquivo de novo.');
  // "Importar tudo" não escolhe linha por linha: vale o que está certo AGORA (os arquivos enviados juntos são confirmados um depois do outro)
  if (imp.tipo === 'planilha' && !Array.isArray(req.body?.incluir)) anotar('planilha', dados.registros);
  // depois de confirmada, a prévia (pesada) não é mais necessária: guarda só o resumo, o que foi criado e como estava o que foi alterado
  const resultado = finalizarImportacao(imp, imp.resumo_json ? JSON.parse(imp.resumo_json) : {}, confirmarImportacao(imp, dados, req.body || {}, req.user));
  audit(req, 'Confirmou importação', 'importacao', id, resultado.criados);
  let sobra = null;
  if (imp.tipo === 'pagamentos') {
    const sem = db.all(
      "SELECT r.*, r.valor_centavos - r.alocado_centavos AS saldo_centavos FROM v_recebimentos r WHERE r.importacao_id = ? AND r.status = 'confirmado' AND r.valor_centavos > r.alocado_centavos", id,
    );
    const sugs = sugerir(sem);
    sobra = { sem_baixa: sem.length, com_sugestao: sem.filter((r) => (sugs.get(r.id) || []).length).length };
  }
  res.json({ ok: true, resultado, sobra });
});

router.post('/importacoes/:id/desfazer', (req, res) => {
  const id = int(req.params.id, { required: true });
  const imp = carregar(id);
  if (imp.status !== 'confirmada') throw bad('Só dá para desfazer importações já confirmadas.');
  const removidos = desfazerImportacao(id);
  db.run("UPDATE importacoes SET status = 'desfeita', desfeito_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", id);
  audit(req, 'Desfez importação', 'importacao', id, removidos);
  res.json({ ok: true, removidos });
});

router.post('/importacoes/:id/descartar', (req, res) => {
  const id = int(req.params.id, { required: true });
  const imp = carregar(id);
  if (imp.status !== 'previa') throw bad('Esta importação já foi finalizada.');
  db.run("UPDATE importacoes SET status = 'descartada', dados_json = NULL WHERE id = ?", id);
  res.json({ ok: true });
});

router.get('/importacoes/:id/arquivo', async (req, res) => {
  const imp = carregar(int(req.params.id, { required: true }));
  const a = imp.arquivo_id ? await abrirArquivo(imp.arquivo_id) : null;
  if (!a) throw notFound('Arquivo não disponível.');
  enviarArquivo(res, a, { inline: false });
});

