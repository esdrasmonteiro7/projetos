// Importar arquivos (PDF, XML de NF-e, planilhas, CSV, OFX, ZIP): analisar → prévia → confirmar → (desfazer).
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, audit } from '../auth.js';
import { bad, notFound, int } from '../lib/http.js';
import { fmtBR } from '../../shared/dates.js';
import { salvarArquivo, abrirArquivo, enviarArquivo } from '../services/arquivos.js';
import { lerArquivo } from '../services/import/leitor.js';
import { PAPEIS_ROTULO } from '../services/import/tabela.js';
import {
  TIPOS, TIPOS_ROTULO, anotar, previaDeTabela, reprocessarTabela, registrosDeNFe, registrosDePix, registrosDeOFX, empresaAtual,
} from '../services/import/analisar.js';
import { confirmarImportacao, desfazerImportacao } from '../services/import/confirmar.js';
import { hojeEmpresa } from '../services/metrics.js';
import { sugerir } from '../services/conciliacao.js';
import { lerControle, lerListaDevedores } from '../services/import/perfis-bomgosto.js';
import { operacoesDeControle, operacoesDeDevedores } from '../services/import/planilha-empresa.js';

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

function salvarPrevia(imp, tipo, dados) {
  dados.registros.forEach((r, i) => { r._id = i; });
  const resumo = anotar(tipo, dados.registros);
  dados.resumo_atual = resumo;
  db.run('UPDATE importacoes SET tipo = ?, dados_json = ?, resumo_json = ? WHERE id = ?', tipo, JSON.stringify(dados), JSON.stringify(resumo), imp);
  return resumo;
}

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
  const hoje = hojeEmpresa();
  const empresa = empresaAtual();
  const grupos = { nfe: { registros: [], nomes: [] }, pix: { registros: [], nomes: [], arquivos: new Set() } };
  const individuais = [];
  const erros = [];
  const repetidos = [];

  for (const f of req.files) {
    const nome = nomeUtf8(f.originalname);
    const arq = salvarArquivo({ buffer: f.buffer, nome, mime: f.mimetype, user_id: req.user.id });
    const rep = db.get(
      "SELECT i.confirmado_em FROM importacoes i JOIN arquivos a ON a.id = i.arquivo_id WHERE a.hash = ? AND i.status = 'confirmada' LIMIT 1", arq.hash,
    );
    if (rep) repetidos.push(`${nome} (já importado em ${fmtBR(String(rep.confirmado_em).slice(0, 10))})`);
    const docs = await lerArquivo({ buffer: f.buffer, nome });
    for (const d of docs) {
      if (d.kind === 'erro') { erros.push({ nome: d.nome, motivo: d.motivo }); continue; }
      if (d.kind === 'nfe') {
        grupos.nfe.registros.push(registrosDeNFe(d.nfe, { _arquivo_id: arq.id, _linha: grupos.nfe.registros.length + 1, _arquivo_nome: d.nome }));
        grupos.nfe.nomes.push(d.nome);
      } else if (d.kind === 'cancelamento_nfe') {
        grupos.nfe.registros.push({ tipo_registro: 'cancelamento', chave: d.nfe.chave, _linha: grupos.nfe.registros.length + 1, _arquivo_id: arq.id, _avisos: [`Cancelamento da NF-e ${d.nfe.chave.slice(-9)}${d.nfe.motivo ? ` — ${d.nfe.motivo}` : ''}`], data: null });
        grupos.nfe.nomes.push(d.nome);
      } else if (d.kind === 'pix') {
        grupos.pix.registros.push(...registrosDePix(d.recibos, empresa, { _arquivo_id: arq.id, _arquivo_nome: d.nome }));
        grupos.pix.nomes.push(d.nome);
      } else individuais.push({ d, arq });
    }
  }

  const criadas = [];
  const criar = ({ nome, tipo, formato, arquivoId, dados }) => {
    const id = db.run('INSERT INTO importacoes (arquivo_id, nome, tipo, formato, status, criado_por) VALUES (?,?,?,?,?,?)', arquivoId || null, nome, tipo, formato, 'previa', req.user.id).id;
    const resumo = salvarPrevia(id, tipo, dados);
    criadas.push({ id, nome, tipo, formato, resumo, avisos: dados.avisos?.slice(0, 5) || [] });
  };

  if (grupos.nfe.registros.length) {
    const n = grupos.nfe.registros.length;
    criar({ nome: n === 1 ? grupos.nfe.nomes[0] : `${n} notas fiscais (XML)`, tipo: 'vendas', formato: 'xml', dados: { registros: grupos.nfe.registros, avisos: [] } });
  }
  if (grupos.pix.registros.length) {
    const n = grupos.pix.registros.length;
    criar({ nome: n === 1 ? grupos.pix.nomes[0] : `${n} comprovantes de Pix (PDF)`, tipo: 'pagamentos', formato: 'pdf', dados: { registros: grupos.pix.registros, avisos: [] } });
  }
  for (const { d, arq } of individuais) {
    if (d.kind === 'empresa') {
      const controle = d.perfil === 'controle';
      const opcoesPlano = { vendedoresExistentes: db.all('SELECT nome FROM vendedores').map((v) => v.nome) };
      const plano = controle ? operacoesDeControle(lerControle(d.abas), opcoesPlano) : operacoesDeDevedores(lerListaDevedores(d.abas), opcoesPlano);
      criar({ nome: `${d.nome} · ${controle ? 'vendas, depósito e produção' : 'lista de devedores'}`, tipo: 'planilha', formato: 'xlsx', arquivoId: arq.id, dados: { registros: plano.registros, produtos: plano.produtos, avisos: plano.avisos, perfil: d.perfil } });
    } else if (d.kind === 'tabela') {
      const p = previaDeTabela(d, { hoje });
      criar({ nome: d.nome, tipo: p.tipo, formato: d.formato, arquivoId: arq.id, dados: p.dados });
    } else if (d.kind === 'ofx') {
      const registros = registrosDeOFX(d.ofx);
      criar({ nome: d.nome, tipo: 'pagamentos', formato: 'ofx', arquivoId: arq.id, dados: { registros, avisos: registros.length ? [] : ['Nenhuma entrada (crédito) encontrada neste extrato.'] } });
    }
  }
  if (repetidos.length) for (const c of criadas) c.avisos.unshift(`Atenção: arquivo(s) já importado(s) antes: ${repetidos.join('; ')}`);
  audit(req, 'Enviou arquivos para importação', 'importacao', null, { arquivos: req.files.length, previas: criadas.length });
  res.json({ importacoes: criadas, erros, repetidos });
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
  const resultado = confirmarImportacao(imp, dados, req.body || {}, req.user);
  const resumo = { ...(imp.resumo_json ? JSON.parse(imp.resumo_json) : {}), resultado };
  // depois de confirmada, a prévia (pesada) não é mais necessária: guarda só o resumo e o que foi criado
  db.run("UPDATE importacoes SET status = 'confirmada', confirmado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now'), resumo_json = ?, dados_json = NULL WHERE id = ?", JSON.stringify(resumo), id);
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

