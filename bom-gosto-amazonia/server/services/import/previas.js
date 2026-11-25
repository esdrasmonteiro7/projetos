// Lê os arquivos enviados e monta as PRÉVIAS (nada é gravado nos dados do painel até a pessoa confirmar).
// É o mesmo caminho da tela "Importar arquivos"; ficou fora da rota para poder ser usado também em scripts e testes.
import { db } from '../../db.js';
import { fmtBR } from '../../../shared/dates.js';
import { salvarArquivo } from '../arquivos.js';
import { hojeEmpresa } from '../metrics.js';
import { lerArquivo } from './leitor.js';
import { anotar, previaDeTabela, registrosDePix, registrosDeOFX, empresaAtual } from './analisar.js';
import { lerControle, lerListaDevedores } from './perfis-bomgosto.js';
import { operacoesDeControle, operacoesDeDevedores, avisosDoBanco } from './planilha-empresa.js';
import { operacoesDeNotas, operacoesDeBanco } from './notas.js';

export function salvarPrevia(imp, tipo, dados) {
  dados.registros.forEach((r, i) => { r._id = i; });
  const resumo = anotar(tipo, dados.registros);
  dados.resumo_atual = resumo;
  db.run('UPDATE importacoes SET tipo = ?, dados_json = ?, resumo_json = ? WHERE id = ?', tipo, JSON.stringify(dados), JSON.stringify(resumo), imp);
  return resumo;
}

/** @param arquivos [{ buffer, nome, mime }]  @returns { importacoes, erros, repetidos } */
export async function analisarArquivos(arquivos, userId) {
  const hoje = hojeEmpresa();
  const empresa = empresaAtual();
  const grupos = { notas: { nfes: [], cancelamentos: [], relatorios: [], nomes: [] }, pix: { registros: [], nomes: [], arquivos: new Set() } };
  const bancos = [];
  const individuais = [];
  const erros = [];
  const repetidos = [];

  for (const f of arquivos) {
    const nome = f.nome;
    const arq = salvarArquivo({ buffer: f.buffer, nome, mime: f.mime, user_id: userId });
    const rep = db.get(
      "SELECT i.confirmado_em FROM importacoes i JOIN arquivos a ON a.id = i.arquivo_id WHERE a.hash = ? AND i.status = 'confirmada' LIMIT 1", arq.hash,
    );
    if (rep) repetidos.push(`${nome} (já importado em ${fmtBR(String(rep.confirmado_em).slice(0, 10))})`);
    const docs = await lerArquivo({ buffer: f.buffer, nome });
    for (const d of docs) {
      if (d.kind === 'erro') { erros.push({ nome: d.nome, motivo: d.motivo }); continue; }
      if (d.kind === 'nfe') {
        grupos.notas.nfes.push(d.nfe);
        grupos.notas.nomes.push(d.nome);
      } else if (d.kind === 'cancelamento_nfe') {
        grupos.notas.cancelamentos.push(d.nfe);
        grupos.notas.nomes.push(d.nome);
      } else if (d.kind === 'relatorio' && d.relatorio.tipo === 'vendas_totais') {
        grupos.notas.relatorios.push(d.relatorio);
        grupos.notas.nomes.push(d.nome);
      } else if (d.kind === 'relatorio') {
        bancos.push({ d, arq });
      } else if (d.kind === 'pix') {
        grupos.pix.registros.push(...registrosDePix(d.recibos, empresa, { _arquivo_id: arq.id, _arquivo_nome: d.nome }));
        grupos.pix.nomes.push(d.nome);
      } else individuais.push({ d, arq });
    }
  }

  const criadas = [];
  const criar = ({ nome, tipo, formato, arquivoId, dados }) => {
    const id = db.run('INSERT INTO importacoes (arquivo_id, nome, tipo, formato, status, criado_por) VALUES (?,?,?,?,?,?)', arquivoId || null, nome, tipo, formato, 'previa', userId).id;
    const resumo = salvarPrevia(id, tipo, dados);
    criadas.push({ id, nome, tipo, formato, resumo, avisos: dados.avisos?.slice(0, 5) || [] });
  };

  const notas = grupos.notas;
  if (notas.nfes.length || notas.cancelamentos.length || notas.relatorios.length) {
    const vendedoresExistentes = db.all('SELECT nome FROM vendedores').map((v) => v.nome);
    const plano = operacoesDeNotas({ nfes: notas.nfes, cancelamentos: notas.cancelamentos, relatorios: notas.relatorios }, { vendedoresExistentes });
    const partes = [];
    const validas = notas.nfes.filter((n) => !notas.cancelamentos.some((c) => c.chave === n.chave)).length; // as canceladas ficam de fora
    if (validas) partes.push(`${validas} ${validas === 1 ? 'nota fiscal' : 'notas fiscais'} (XML)`);
    if (notas.relatorios.length) partes.push('relatório de vendas');
    if (!partes.length) partes.push(`${notas.cancelamentos.length} cancelamento(s) de nota`);
    criar({ nome: notas.nomes.length === 1 ? notas.nomes[0] : partes.join(' + '), tipo: 'planilha', formato: notas.nfes.length || notas.cancelamentos.length ? 'xml' : 'pdf', dados: { registros: plano.registros, produtos: plano.produtos, avisos: plano.avisos, perfil: 'notas' } });
  }
  for (const { d, arq } of bancos) {
    const plano = operacoesDeBanco(d.relatorio);
    criar({ nome: `${d.nome} · boletos do banco`, tipo: 'planilha', formato: 'pdf', arquivoId: arq.id, dados: { registros: plano.registros, produtos: plano.produtos, avisos: [...d.relatorio.avisos, ...avisosDoBanco(d.relatorio)], perfil: 'banco' } });
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
  return { importacoes: criadas, erros, repetidos };
}
