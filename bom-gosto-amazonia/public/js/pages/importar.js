// Importar arquivos: PDF, XML de nota fiscal, planilhas, CSV, extrato (OFX) e ZIP — com prévia antes de gravar.
import {
  html, useState, useEffect, useRef, useMemo, api, qs, useApi, fmtBRL, fmtBR, fmtQtd, fmtDataHora, todayISO, FORMAS, TIPOS_MOV, tentar, toast, confirmar, cx, ambiente,
} from '../lib.js';
import { norm } from '/shared/text.js';
import {
  PageHead, Btn, Tabela, Empty, Modal, Field, Input, Select, Check, Tabs, Icon, ErroCaixa, Spinner, Badge,
} from '../ui.js';

const TIPO_ROT = { vendas: 'Vendas', devedores: 'Devedores / a receber', pagamentos: 'Pagamentos (Pix etc.)', estoque: 'Depósito', clientes: 'Clientes', produtos: 'Produtos', desconhecido: 'Não identificado' };
const TIPO_COR = { vendas: 'ok', devedores: 'warn', pagamentos: 'violet', estoque: 'info', clientes: 'mute', produtos: 'mute', desconhecido: 'bad' };
const ACEITA = '.pdf,.xml,.xlsx,.xlsm,.csv,.tsv,.txt,.ofx,.zip';

export default function Importar() {
  const [aba, setAba] = useState('enviar');
  const [arquivos, setArquivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [over, setOver] = useState(false);
  const [previas, setPrevias] = useState([]);
  const [erros, setErros] = useState([]);
  const [revisar, setRevisar] = useState(null);
  const [concluidas, setConcluidas] = useState({});
  const input = useRef(null);
  const hist = useApi(aba === 'historico' ? '/importacoes' : null);

  const adicionar = (lista) => {
    const novos = [...lista].filter((f) => !arquivos.some((a) => a.name === f.name && a.size === f.size));
    setArquivos((a) => [...a, ...novos]);
  };
  const analisar = async () => {
    // Em hospedagem com limite por envio (Netlify: ~6 MB), os arquivos vão em lotes que cabem no limite.
    const limite = ambiente.limiteEnvioMB ? ambiente.limiteEnvioMB * 1024 * 1024 : Infinity;
    const grande = arquivos.find((f) => f.size > limite);
    if (grande) { toast(`“${grande.name}” tem ${(grande.size / 1048576).toFixed(1).replace('.', ',')} MB e o máximo por arquivo aqui é ${String(ambiente.limiteEnvioMB).replace('.', ',')} MB. Divida o arquivo ou compacte em ZIP.`, 'erro'); return; }
    const lotes = [];
    let atual = [];
    let tam = 0;
    for (const f of arquivos) {
      if (atual.length && tam + f.size > limite) { lotes.push(atual); atual = []; tam = 0; }
      atual.push(f);
      tam += f.size;
    }
    if (atual.length) lotes.push(atual);
    setEnviando(true);
    const acum = { importacoes: [], erros: [] };
    let enviados = 0;
    for (const lote of lotes) {
      const fd = new FormData();
      for (const f of lote) fd.append('arquivos', f, f.name);
      const r = await tentar(() => api('/importacoes/analisar', { method: 'POST', form: fd }));
      if (!r) break;
      acum.importacoes.push(...r.importacoes);
      acum.erros.push(...r.erros);
      enviados += lote.length;
    }
    setEnviando(false);
    if (enviados === 0) return;
    setPrevias(acum.importacoes); setErros(acum.erros); setArquivos(arquivos.slice(enviados)); setConcluidas({});
    if (acum.importacoes.length === 1) setRevisar(acum.importacoes[0].id);
  };
  const importarTudo = async () => {
    const lista = previas.filter((p) => !concluidas[p.id]);
    const total = lista.reduce((s, p) => s + p.resumo.incluidos, 0);
    if (!(await confirmar({ titulo: 'Importar tudo com as opções padrão?', texto: `Serão gravados ${total} registros de ${lista.length} arquivos.\n• Clientes e produtos novos são cadastrados automaticamente\n• Itens duplicados ficam de fora\n• Pix com nome e valor batendo recebem baixa automática\n\nVocê pode desfazer cada importação depois.`, ok: 'Importar tudo' }))) return;
    for (const p of lista) {
      const r = await tentar(() => api(`/importacoes/${p.id}/confirmar`, { method: 'POST', body: { opcoes: { criar_clientes: true, criar_produtos: true, conciliar_automatico: true } } }));
      if (r) setConcluidas((c) => ({ ...c, [p.id]: r }));
    }
    toast('Importação concluída!');
  };

  return html`<div class="page">
    <${PageHead} titulo="Importar arquivos" sub="Jogue aqui PDFs, notas fiscais (XML), planilhas, extratos e comprovantes de Pix — o painel lê, separa por vendedor e mostra tudo antes de gravar." />
    <${Tabs} valor=${aba} onChange=${setAba} abas=${[['enviar', 'Enviar arquivos'], ['historico', 'Histórico de importações']]} />
    ${aba === 'enviar' && html`<div class="stack">
      <div class=${cx('dropzone', over && 'over')} onClick=${() => input.current.click()}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${(e) => { e.preventDefault(); setOver(false); adicionar(e.dataTransfer.files); }}>
        <${Icon} n="upload" s=${42} /><div class="big">Arraste os arquivos para cá ou clique para escolher</div>
        <div class="muted">PDF · XML de NF-e · Excel (.xlsx) · CSV · extrato OFX · ZIP com vários arquivos</div>
        <input ref=${input} type="file" multiple accept=${ACEITA} class="hide" onChange=${(e) => { adicionar(e.target.files); e.target.value = ''; }} /></div>
      ${arquivos.length > 0 && html`<div class="card pad stack" style="gap:10px"><div class="row between"><b>${arquivos.length} ${arquivos.length === 1 ? 'arquivo escolhido' : 'arquivos escolhidos'}</b><button class="link small" onClick=${() => setArquivos([])}>Limpar</button></div>
        ${arquivos.map((f) => html`<div class="file-item" key=${f.name + f.size}><${Icon} n="sheet" /><div class="grow"><b>${f.name}</b><div class="muted small">${(f.size / 1024).toFixed(0)} KB</div></div>
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remover" onClick=${() => setArquivos((a) => a.filter((x) => x !== f))}><${Icon} n="x" s=${16} /></button></div>`)}
        <div><${Btn} tipo="primary" icon="zap" disabled=${enviando} onClick=${analisar}>${enviando ? 'Lendo os arquivos…' : 'Ler e analisar arquivos'}<//></div>
        ${enviando && html`<div class="muted small">Isso pode levar alguns segundos para PDFs e planilhas grandes.</div>`}</div>`}

      ${erros.length > 0 && html`<div class="stack" style="gap:8px">${erros.map((e) => html`<div class="alert bad"><${Icon} n="alert" /><div><b>${e.nome}</b> — ${e.motivo}</div></div>`)}</div>`}
      ${previas.length > 0 && html`<div class="stack" style="gap:12px"><div class="row between"><h2 style="font-size:18px">O que encontrei</h2>
        ${previas.length > 1 && previas.some((p) => !concluidas[p.id]) && html`<${Btn} tipo="primary" icon="check" onClick=${importarTudo}>Importar tudo com as opções padrão<//>`}</div>
        ${previas.map((p) => html`<${CartaoPrevia} key=${p.id} p=${p} feito=${concluidas[p.id]} onRevisar=${() => setRevisar(p.id)} />`)}</div>`}
      ${!previas.length && !arquivos.length && html`<div class="card pad"><div class="card-t">Como funciona</div><ol class="ink2" style="margin:10px 0 0;padding-left:20px;line-height:1.8">
        <li><b>Envie</b> os arquivos (pode ser vários de uma vez, de tipos diferentes).</li>
        <li>O painel <b>identifica o tipo</b> (vendas, devedores, Pix, depósito…), reconhece os <b>vendedores</b> e os <b>clientes</b> e avisa o que está repetido.</li>
        <li>Você <b>confere a prévia</b>, ajusta o que precisar e confirma. Nada é gravado antes disso.</li>
        <li>Errou? Cada importação pode ser <b>desfeita</b> com um clique.</li></ol>
        <div class="small muted" style="margin-top:12px">Dica: NF-e (XML) já traz cliente, produtos, valores e parcelas. Comprovantes de Pix em PDF e extratos (OFX/CSV) viram recebimentos que o painel tenta ligar às dívidas.</div></div>`}
    </div>`}

    ${aba === 'historico' && (hist.error && !hist.data ? html`<${ErroCaixa} erro=${hist.error} onRetry=${hist.reload} />` : !hist.data ? html`<${Spinner} />` : html`<div class="card"><${Tabela} linhas=${hist.data}
      vazio=${html`<${Empty} icon="upload" titulo="Nenhuma importação ainda">Os arquivos que você importar aparecem aqui.<//>`}
      cols=${[
        { t: 'Quando', r: (h) => fmtDataHora(h.criado_em), cls: 'nowrap' },
        { t: 'Arquivo', r: (h) => html`<b>${h.nome}</b><span class="sub-l">${h.usuario || ''}</span>` },
        { t: 'Tipo', r: (h) => html`<${Badge} tipo=${TIPO_COR[h.tipo] || 'mute'}>${TIPO_ROT[h.tipo] || h.tipo}<//>` },
        { t: 'Situação', r: (h) => ({ previa: html`<${Badge} tipo="warn">Aguardando confirmação<//>`, confirmada: html`<${Badge} tipo="ok">Importada<//>`, desfeita: html`<${Badge}>Desfeita<//>`, descartada: html`<${Badge}>Descartada<//>`, erro: html`<${Badge} tipo="bad">Erro<//>` })[h.status] },
        { t: 'Resultado', r: (h) => h.resumo?.resultado ? resumoCriados(h.resumo.resultado.criados) : h.resumo ? `${h.resumo.total || 0} linhas lidas` : '—' },
        { t: '', acoes: true, r: (h) => h.status === 'previa' ? html`<${Btn} sm onClick=${() => setRevisar(h.id)}>Continuar<//>` : h.status === 'confirmada' ? html`<${Btn} sm tipo="danger" icon="undo" onClick=${() => desfazer(h, hist.reload)}>Desfazer<//>` : '' },
      ]} /></div>`)}

    ${revisar && html`<${Revisao} id=${revisar} onClose=${() => setRevisar(null)} onConfirmado=${(r) => { setConcluidas((c) => ({ ...c, [revisar]: r })); }} />`}
  </div>`;
}

function resumoCriados(c) {
  const partes = [];
  const add = (n, s, p) => n > 0 && partes.push(`${n} ${n === 1 ? s : p}`);
  add(c.vendas, 'venda', 'vendas'); add(c.titulos, 'dívida', 'dívidas'); add(c.recebimentos, 'recebimento', 'recebimentos'); add(c.baixas_automaticas, 'baixa automática', 'baixas automáticas');
  add(c.movimentos, 'movimento', 'movimentos'); add(c.clientes, 'cliente novo', 'clientes novos'); add(c.produtos, 'produto novo', 'produtos novos'); add(c.canceladas, 'venda cancelada', 'vendas canceladas');
  return partes.join(' · ') || 'nada novo';
}

async function desfazer(h, reload) {
  if (!(await confirmar({ titulo: 'Desfazer esta importação?', texto: `Tudo que "${h.nome}" criou (vendas, dívidas, recebimentos, movimentos e cadastros novos sem uso) será removido. Baixas feitas nesses itens também somem.`, ok: 'Desfazer importação', perigo: true }))) return;
  if (await tentar(() => api(`/importacoes/${h.id}/desfazer`, { method: 'POST' }), 'Importação desfeita.')) reload();
}

function CartaoPrevia({ p, feito, onRevisar }) {
  const r = p.resumo;
  return html`<div class="card pad"><div class="row between" style="align-items:flex-start">
    <div class="grow"><div class="row gap-s"><${Badge} tipo=${TIPO_COR[p.tipo]}>${TIPO_ROT[p.tipo]}<//><b style="font-size:16px">${p.nome}</b></div>
      <div class="chips" style="margin-top:10px"><span class="chip"><b>${r.total}</b> linhas</span><span class="chip"><b>${r.incluidos}</b> serão importadas</span>
        ${r.duplicados > 0 && html`<span class="chip" style="background:var(--amber-bg)"><b>${r.duplicados}</b> repetidas</span>`}
        ${r.clientes_novos > 0 && html`<span class="chip"><b>${r.clientes_novos}</b> clientes novos</span>`}
        ${r.valor_total_centavos > 0 && html`<span class="chip">Total <b>${fmtBRL(r.valor_total_centavos)}</b></span>`}
        ${r.vendedores.length > 0 && html`<span class="chip">Vendedores: <b>${r.vendedores.map((v) => v.nome).slice(0, 3).join(', ')}${r.vendedores.length > 3 ? '…' : ''}</b></span>`}</div>
      ${p.avisos.length > 0 && html`<div class="small" style="margin-top:8px;color:var(--amber-ink)">${p.avisos.map((a) => html`<div>⚠ ${a}</div>`)}</div>`}
      ${feito && html`<div class="alert ok" style="margin-top:10px"><${Icon} n="check" /><div><b>Importado!</b> ${resumoCriados(feito.resultado.criados)}${feito.resultado.erros.length ? html` · <span class="red">${feito.resultado.erros.length} linhas com erro</span>` : ''}
        ${feito.sobra?.sem_baixa > 0 && html` · <a href="#/recebimentos">${feito.sobra.sem_baixa} pagamentos para conciliar</a>`}</div></div>`}</div>
    ${!feito && html`<${Btn} tipo="primary" onClick=${onRevisar}>Revisar e importar<//>`}</div></div>`;
}

// ============================================================= revisão
function Revisao({ id, onClose, onConfirmado }) {
  const [imp, setImp] = useState(null);
  const [erro, setErro] = useState(null);
  const [tipo, setTipo] = useState('');
  const [mapa, setMapa] = useState({});
  const [mudouMapa, setMudouMapa] = useState(false);
  const [opc, setOpc] = useState({ criar_clientes: true, criar_produtos: true, conciliar_automatico: true, vendedor_padrao_id: '', considerar_pagas_sem_info: false, baixar_estoque: false, vencimento_padrao: todayISO(), data_padrao: '' });
  const [mapaV, setMapaV] = useState({});
  const [mapaC, setMapaC] = useState({});
  const [marcados, setMarcados] = useState(new Set());
  const [colunasAbertas, setColunasAbertas] = useState(false);
  const [trabalhando, setTrabalhando] = useState(false);
  const [feito, setFeito] = useState(null);
  const vs = useApi('/vendedores');

  const aplicar = (r, resetarMarcas = true) => {
    setImp(r); setTipo(r.importacao.tipo); setMapa(r.dados?.mapeamento || {}); setMudouMapa(false);
    if (resetarMarcas) setMarcados(new Set(r.dados.registros.filter((x) => x._incluir).map((x) => x._id)));
    const mv = {};
    for (const v of r.resumo.vendedores) mv[norm(v.nome)] = v.sugestao ? String(v.sugestao.id) : '';
    setMapaV((old) => ({ ...mv, ...old }));
    setColunasAbertas(r.importacao.tipo === 'desconhecido');
  };
  useEffect(() => { api(`/importacoes/${id}`).then((r) => aplicar(r)).catch(setErro); }, [id]);

  if (erro) return html`<${Modal} titulo="Importação" onClose=${onClose}><${ErroCaixa} erro=${erro} /><//>`;
  if (!imp) return html`<${Modal} titulo="Carregando…" onClose=${onClose}><${Spinner} /><//>`;
  const { dados, resumo, importacao } = imp;
  const regs = dados.registros;
  const ehTabela = !!dados.tabela;
  const setO = (k) => (v) => setOpc((o) => ({ ...o, [k]: v }));
  const nMarcados = marcados.size;
  const toggle = (rid) => setMarcados((s) => { const n = new Set(s); n.has(rid) ? n.delete(rid) : n.add(rid); return n; });

  const reprocessar = async (novoTipo = tipo, novoMapa = mapa) => {
    setTrabalhando(true);
    const r = await tentar(() => api(`/importacoes/${id}/reprocessar`, { method: 'POST', body: { tipo: novoTipo, mapeamento: novoMapa, opcoes: { vencimento_padrao: opc.vencimento_padrao, data_padrao: opc.data_padrao || undefined } } }));
    setTrabalhando(false);
    if (r) aplicar(r);
  };
  const editarRegistro = async (rid, campos) => {
    const r = await tentar(() => api(`/importacoes/${id}/registros/${rid}`, { method: 'PATCH', body: campos }));
    if (r) { const m = new Set(marcados); aplicar(r, false); setMarcados(m); }
  };
  const confirmarImport = async () => {
    setTrabalhando(true);
    const body = { opcoes: { ...opc, vendedor_padrao_id: opc.vendedor_padrao_id || undefined, vencimento_padrao: undefined }, incluir: [...marcados], mapa_vendedores: Object.fromEntries(Object.entries(mapaV).map(([k, v]) => [k, v === 'novo' ? 'novo' : v ? Number(v) : null])), mapa_clientes: mapaC };
    const r = await tentar(() => api(`/importacoes/${id}/confirmar`, { method: 'POST', body }));
    setTrabalhando(false);
    if (r) { setFeito(r); onConfirmado(r); }
  };
  const descartar = async () => { if (await tentar(() => api(`/importacoes/${id}/descartar`, { method: 'POST' }), 'Prévia descartada.')) onClose(); };

  if (feito) {
    const c = feito.resultado.criados;
    return html`<${Modal} titulo="Importação concluída" onClose=${onClose} tam="wide" rodape=${html`${feito.sobra?.sem_baixa > 0 && html`<${Btn} tipo="primary" href="#/recebimentos" onClick=${onClose}>Conciliar ${feito.sobra.sem_baixa} pagamentos<//>`}<${Btn} onClick=${onClose}>Fechar<//>`}>
      <div class="alert ok"><${Icon} n="check" /><div class="grow"><b>Pronto!</b> ${resumoCriados(c)}.</div></div>
      ${feito.resultado.erros.length > 0 && html`<div class="alert bad" style="margin-top:12px"><${Icon} n="alert" /><div><b>${feito.resultado.erros.length} linhas não puderam ser importadas:</b>${feito.resultado.erros.slice(0, 10).map((e) => html`<div class="small">Linha ${e.linha}: ${e.erro}</div>`)}</div></div>`}
      ${feito.sobra && html`<div class="alert info" style="margin-top:12px"><${Icon} n="zap" /><div>${feito.sobra.sem_baixa === 0 ? 'Todos os pagamentos já foram ligados às dívidas.' : `${feito.sobra.sem_baixa} pagamentos ficaram sem baixa (${feito.sobra.com_sugestao} com sugestão). Vá em Recebimentos para conferir.`}</div></div>`}
      <div class="small muted" style="margin-top:14px">Se algo ficou errado, abra "Histórico de importações" e clique em Desfazer.</div><//>`;
  }

  const vendedoresPrecisam = resumo.vendedores.length > 0;
  const colsPrev = colunasPrevia(imp.importacao.tipo, { marcados, toggle, editarRegistro });
  const mostrar = regs.slice(0, 300);

  return html`<${Modal} titulo=${importacao.nome} sub=${`${TIPO_ROT[importacao.tipo]} · ${resumo.total} linhas lidas`} tam="xl" onClose=${onClose}
    rodape=${html`<${Btn} tipo="danger" onClick=${descartar}>Descartar<//><div class="grow"></div><${Btn} onClick=${onClose}>Fechar (continuar depois)<//>
      <${Btn} tipo="primary" icon="check" disabled=${trabalhando || nMarcados === 0 || importacao.tipo === 'desconhecido'} onClick=${confirmarImport}>${trabalhando ? 'Aguarde…' : `Importar ${nMarcados} ${nMarcados === 1 ? 'linha' : 'linhas'}`}<//>`}>
    <div class="stack">
      <div class="chips"><span class="chip"><b>${nMarcados}</b> marcadas</span>${resumo.duplicados > 0 && html`<span class="chip" style="background:var(--amber-bg)"><b>${resumo.duplicados}</b> repetidas (desmarcadas)</span>`}
        ${resumo.clientes_novos > 0 && html`<span class="chip"><b>${resumo.clientes_novos}</b> clientes novos</span>`}${resumo.produtos_novos > 0 && html`<span class="chip"><b>${resumo.produtos_novos}</b> produtos novos</span>`}
        ${resumo.valor_total_centavos > 0 && html`<span class="chip">Total <b>${fmtBRL(resumo.valor_total_centavos)}</b></span>`}</div>
      ${dados.avisos?.length > 0 && html`<div class="alert warn"><${Icon} n="alert" /><div class="small">${dados.avisos.slice(0, 6).map((a) => html`<div>${a}</div>`)}${dados.avisos.length > 6 ? html`<div>…e mais ${dados.avisos.length - 6} avisos</div>` : ''}</div></div>`}

      ${ehTabela && html`<div class="card"><button class="pad-s row between" style="width:100%;background:none;border:0;cursor:pointer;font:inherit" onClick=${() => setColunasAbertas(!colunasAbertas)}>
          <div class="row"><b>Tipo de dado e colunas</b><span class="muted small">O painel identificou: ${TIPO_ROT[importacao.tipo]}. ${importacao.tipo === 'desconhecido' ? 'Escolha abaixo.' : 'Confira se está certo.'}</span></div><${Icon} n=${colunasAbertas ? 'down' : 'right'} s=${18} /></button>
        ${colunasAbertas && html`<div class="pad" style="border-top:1px solid var(--line)">
          <div class="row" style="margin-bottom:14px"><${Field} label="Este arquivo contém:"><${Select} value=${tipo} onChange=${(v) => { setTipo(v); setMudouMapa(true); }}>${Object.entries(TIPO_ROT).filter(([k]) => k !== 'desconhecido').map(([k, v]) => html`<option value=${k}>${v}</option>`)}<option value="desconhecido" disabled>—</option><//><//></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr>${dados.tabela.cabecalho.map((c, i) => html`<th key=${i}>${c || `Coluna ${i + 1}`}</th>`)}</tr></thead><tbody>
            <tr>${dados.tabela.cabecalho.map((_, i) => html`<td key=${i}><${Select} sm value=${mapa[i] || ''} onChange=${(v) => { setMapa((m) => ({ ...m, [i]: v })); setMudouMapa(true); }}><option value="">(não usar)</option>${Object.entries(imp.papeis).filter(([k]) => k !== 'ignorar' && k !== 'pago_ou_status').map(([k, v]) => html`<option value=${k}>${v}</option>`)}<option value="pago_ou_status">${imp.papeis.pago_ou_status}</option><//></td>`)}</tr>
            ${dados.tabela.amostra.slice(0, 4).map((l, j) => html`<tr key=${j}>${l.map((c, i) => html`<td key=${i} class="muted small">${c === null ? '' : String(c).slice(0, 40)}</td>`)}</tr>`)}</tbody></table></div>
          <div class="row" style="margin-top:12px"><${Field} label="Vencimento para linhas sem data"><${Input} type="date" value=${opc.vencimento_padrao} onInput=${setO('vencimento_padrao')} /><//>
            <${Field} label="Data para linhas sem data (vendas/depósito)"><${Input} type="date" value=${opc.data_padrao} onInput=${setO('data_padrao')} /><//>
            <div style="align-self:end"><${Btn} tipo="primary" disabled=${trabalhando} onClick=${() => reprocessar(tipo, mapa)}>${trabalhando ? 'Aplicando…' : mudouMapa || tipo !== importacao.tipo ? 'Aplicar mudanças' : 'Reler com estas datas'}<//></div></div></div>`}</div>`}

      <div class="card pad"><div class="card-t" style="margin-bottom:10px">Opções</div><div class="form-grid">
        <${Field} label="Vendedor padrão" hint="Usado quando a linha não diz o vendedor e o cliente ainda não tem carteira."><${Select} value=${opc.vendedor_padrao_id} onChange=${setO('vendedor_padrao_id')}><option value="">Nenhum</option>${(vs.data || []).filter((v) => v.ativo).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//><//>
        <div class="stack" style="gap:10px;align-content:start">
          ${['vendas', 'devedores', 'clientes', 'pagamentos'].includes(importacao.tipo) && html`<${Check} checked=${opc.criar_clientes} onChange=${setO('criar_clientes')}>Cadastrar automaticamente os clientes que ainda não existem<//>`}
          ${['vendas', 'estoque'].includes(importacao.tipo) && html`<${Check} checked=${opc.criar_produtos} onChange=${setO('criar_produtos')}>Cadastrar automaticamente os produtos novos<//>`}
          ${importacao.tipo === 'vendas' && html`<${Check} checked=${opc.considerar_pagas_sem_info} onChange=${setO('considerar_pagas_sem_info')}>Vendas sem informação de pagamento: considerar já recebidas<//>`}
          ${importacao.tipo === 'vendas' && html`<${Check} checked=${opc.baixar_estoque} onChange=${setO('baixar_estoque')}>Dar saída dos produtos no depósito<//>`}
          ${importacao.tipo === 'pagamentos' && html`<${Check} checked=${opc.conciliar_automatico} onChange=${setO('conciliar_automatico')}>Dar baixa automática quando nome e valor batem com uma dívida<//>`}</div></div></div>

      ${vendedoresPrecisam && html`<div class="card pad"><div class="card-t">Vendedores encontrados no arquivo</div><div class="card-s" style="margin-bottom:10px">Confirme a quem pertence cada nome. Os dados são separados por vendedor.</div>
        <div class="stack" style="gap:8px">${resumo.vendedores.map((v) => html`<div class="row" key=${v.nome} style="border:1px solid var(--line);border-radius:12px;padding:8px 12px"><div class="grow"><b>${v.nome}</b> <span class="muted small">· ${v.qtd} ${v.qtd === 1 ? 'linha' : 'linhas'}</span></div>
          <div style="min-width:230px"><${Select} sm value=${mapaV[norm(v.nome)] ?? ''} onChange=${(x) => setMapaV((m) => ({ ...m, [norm(v.nome)]: x }))}><option value="">Sem vendedor</option>${(vs.data || []).map((x) => html`<option value=${x.id}>${x.nome}</option>`)}<option value="novo">+ Cadastrar "${v.nome}" como novo vendedor</option><//></div>
          ${v.sugestao ? html`<${Badge} tipo="ok">reconhecido<//>` : html`<${Badge} tipo="warn">não reconhecido<//>`}</div>`)}</div></div>`}

      ${resumo.clientes_parecidos.length > 0 && html`<div class="card pad"><div class="card-t">Clientes parecidos com cadastrados</div><div class="card-s" style="margin-bottom:10px">Escolha se é o mesmo cliente (juntar) ou um cliente diferente (criar novo).</div>
        <div class="stack" style="gap:8px">${resumo.clientes_parecidos.map((c) => html`<div class="row" key=${c.nome} style="border:1px solid var(--line);border-radius:12px;padding:8px 12px"><div class="grow"><b>${c.nome}</b> <span class="muted small">no arquivo ≈ </span><b>${c.nome_cadastrado}</b> <span class="muted small">(${Math.round(c.score * 100)}% parecido)</span></div>
          <div style="min-width:230px"><${Select} sm value=${mapaC[norm(c.nome)] ?? 'novo'} onChange=${(x) => setMapaC((m) => ({ ...m, [norm(c.nome)]: x === 'novo' ? 'novo' : Number(x) }))}><option value="novo">Criar como cliente novo</option><option value=${c.id}>É o mesmo: usar "${c.nome_cadastrado}"</option><//></div></div>`)}</div></div>`}

      <div class="card"><div class="pad-s row between" style="border-bottom:1px solid var(--line)"><b>Prévia dos dados</b>
        <div class="row gap-s"><${Btn} sm onClick=${() => setMarcados(new Set(regs.map((r) => r._id)))}>Marcar todas<//><${Btn} sm onClick=${() => setMarcados(new Set())}>Desmarcar todas<//><${Btn} sm onClick=${() => setMarcados(new Set(regs.filter((r) => !r._dup).map((r) => r._id)))}>Só as não repetidas<//></div></div>
        ${regs.length === 0 ? html`<${Empty} icon="info" titulo="Nada a importar">Não encontrei linhas válidas. ${ehTabela ? 'Confira o tipo de dado e as colunas acima.' : ''}<//>`
          : html`<div class=${cx('scroll-y', trabalhando && 'carregando')}><table class="tbl"><thead><tr>${colsPrev.map((c) => html`<th class=${c.num ? 'num' : ''}>${c.t}</th>`)}</tr></thead>
            <tbody>${mostrar.map((r) => html`<tr key=${r._id} class=${cx('prev-row', !marcados.has(r._id) && 'excl')}>${colsPrev.map((c) => html`<td class=${c.num ? 'num' : ''}>${c.r(r)}</td>`)}</tr>`)}</tbody></table></div>
            ${regs.length > mostrar.length && html`<div class="pad-s small muted">Mostrando as primeiras ${mostrar.length} de ${regs.length} linhas. As demais seguem as mesmas regras e as marcações acima (Marcar/Desmarcar todas valem para todas).</div>`}`}</div>
    </div><//>`;
}

function Avisos({ r }) {
  if (!r._avisos?.length) return html`<span class="muted">—</span>`;
  return html`<div class="small" style="color:var(--amber-ink);max-width:340px">${r._avisos.slice(0, 3).map((a) => html`<div>⚠ ${a}</div>`)}</div>`;
}
const Vend = ({ r }) => (r._vendedor ? html`${r._vendedor.nome}` : r.vendedor_nome ? html`<span style="color:var(--amber-ink)">${r.vendedor_nome} ?</span>` : html`<span class="muted">—</span>`);
const Cli = ({ r, c }) => html`<b>${c?.nome || r.nome || '—'}</b>${r._cliente ? html`<span class="sub-l ok">já cadastrado</span>` : html`<span class="sub-l" style="color:var(--blue)">novo cliente</span>`}`;

function colunasPrevia(tipo, { marcados, toggle, editarRegistro }) {
  const chk = { t: '', r: (r) => html`<input type="checkbox" checked=${marcados.has(r._id)} onChange=${() => toggle(r._id)} aria-label="Importar esta linha" style="width:18px;height:18px;accent-color:var(--br600)" />` };
  const avisos = { t: 'Avisos', r: (r) => html`<${Avisos} r=${r} />` };
  if (tipo === 'vendas') return [chk, { t: 'Data', r: (r) => fmtBR(r.data) || (r.tipo_registro === 'cancelamento' ? '—' : html`<span class="red">sem data</span>`) }, { t: 'Nº', r: (r) => r.numero || '—' }, { t: 'Cliente', r: (r) => (r.tipo_registro === 'cancelamento' ? html`<b>Cancelar NF-e …${String(r.chave).slice(-9)}</b><span class="sub-l red">cancela a venda desta nota</span>` : html`<${Cli} r=${r} c=${r.cliente} />`) }, { t: 'Vendedor', r: (r) => html`<${Vend} r=${r} />` },
    { t: 'Itens', r: (r) => r.itens?.length || '—' }, { t: 'Total', num: true, r: (r) => (r.tipo_registro === 'cancelamento' ? '—' : html`<b>${fmtBRL(r.total_centavos)}</b>`) }, { t: 'Pagamento', r: (r) => `${FORMAS[r.forma_pagamento] || '—'}${r.parcelas?.length ? ` · ${r.parcelas.length}x` : ''}${r.pago === true ? ' · pago' : ''}` }, avisos];
  if (tipo === 'devedores') return [chk, { t: 'Cliente', r: (r) => html`<${Cli} r=${r} c=${r.cliente} />` }, { t: 'Vendedor', r: (r) => html`<${Vend} r=${r} />` }, { t: 'Doc', r: (r) => r.documento || '—' },
    { t: 'Vencimento', r: (r) => fmtBR(r.vencimento) }, { t: 'Valor', num: true, r: (r) => html`<b>${fmtBRL(r.valor_centavos)}</b>` }, { t: 'Já pago', num: true, r: (r) => r.pago_centavos ? fmtBRL(r.pago_centavos) : '—' }, avisos];
  if (tipo === 'pagamentos') return [chk, { t: 'Data', r: (r) => fmtBR(r.data) }, { t: 'Quem pagou', r: (r) => html`<input class="input input-sm" defaultValue=${r.pagador_nome || ''} placeholder="Nome de quem pagou" style="min-width:200px" onBlur=${(e) => e.target.value !== (r.pagador_nome || '') && editarRegistro(r._id, { pagador_nome: e.target.value })} />${r._cliente ? html`<span class="sub-l ok">cliente: ${r._cliente.nome}</span>` : ''}` },
    { t: 'Valor', num: true, r: (r) => html`<b>${fmtBRL(r.valor_centavos)}</b>` }, { t: 'Forma', r: (r) => FORMAS[r.forma] || r.forma }, { t: 'Código', r: (r) => html`<span class="muted small">${r.ref_externa ? `${r.ref_externa.slice(0, 14)}…` : '—'}</span>` }, avisos];
  if (tipo === 'estoque') return [chk, { t: 'Data', r: (r) => fmtBR(r.data) }, { t: 'Produto', r: (r) => html`<b>${r.produto_nome}</b>${r._produto ? '' : html`<span class="sub-l" style="color:var(--blue)">produto novo</span>`}` }, { t: 'Tipo', r: (r) => TIPOS_MOV[r.tipo] || r.tipo },
    { t: 'Quantidade', num: true, r: (r) => fmtQtd(r.quantidade) }, { t: 'Vendedor', r: (r) => html`<${Vend} r=${r} />` }, avisos];
  if (tipo === 'clientes') return [chk, { t: 'Nome', r: (r) => html`<b>${r.nome}</b>` }, { t: 'CPF/CNPJ', r: (r) => r.documento || '—' }, { t: 'Telefone', r: (r) => r.telefone || '—' }, { t: 'Cidade', r: (r) => r.cidade || '—' }, { t: 'Vendedor', r: (r) => html`<${Vend} r=${r} />` }, avisos];
  if (tipo === 'produtos') return [chk, { t: 'Produto', r: (r) => html`<b>${r.nome}</b>` }, { t: 'Código', r: (r) => r.sku || '—' }, { t: 'Un.', r: (r) => r.unidade }, { t: 'Preço', num: true, r: (r) => fmtBRL(r.preco_centavos) }, avisos];
  return [chk, { t: 'Linha', r: (r) => r._linha }];
}
