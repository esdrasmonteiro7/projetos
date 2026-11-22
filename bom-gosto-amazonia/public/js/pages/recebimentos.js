// Recebimentos (Pix etc.): conciliar com as dívidas, confirmar pagamentos informados, registrar novos.
import {
  html, useState, useEffect, api, qs, useApi, useMes, useRoute, useDebounced, fmtBRL, fmtBR, ymLabel, todayISO, FORMAS, tentar, toast, confirmar,
} from '../lib.js';
import {
  PageHead, MonthBar, Select, SearchBox, Btn, Tabela, Pager, Empty, Modal, Field, Input, MoneyInput, Tabs, ClientePicker, Icon, ErroCaixa, Spinner, Badge, KPI,
} from '../ui.js';

const CONF = { alta: ['ok', 'Certeza alta'], media: ['warn', 'Provável'], baixa: ['mute', 'Possível'] };

export default function Recebimentos({ usuario }) {
  const admin = usuario.papel === 'admin';
  const [aba, setAba] = useState(admin ? 'conciliar' : 'todos');
  const [mes, setMes] = useMes();
  const [busca, setBusca] = useState('');
  const [forma, setForma] = useState('');
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState(false);
  const [escolher, setEscolher] = useState(null);
  const al = useApi('/alertas');
  const b = useDebounced(busca);
  useEffect(() => setPagina(1), [aba, mes, b, forma]);

  const sug = useApi(admin && aba === 'conciliar' ? '/recebimentos/sugestoes' : null);
  const pend = useApi(aba === 'pendentes' ? `/recebimentos${qs({ status: 'pendentes', limite: 200 })}` : null);
  const todos = useApi(aba === 'todos' ? `/recebimentos${qs({ mes, busca: b, forma, pagina, limite: 100 })}` : null);
  const recarregar = () => { sug.reload(); pend.reload(); todos.reload(); al.reload(); };

  const aplicar = async (it, s) => {
    const ok = await tentar(() => api('/recebimentos/conciliar-lote', { method: 'POST', body: { itens: [{ recebimento_id: it.recebimento.id, titulo_ids: s.titulo_ids }] } }), 'Baixa feita!');
    if (ok) recarregar();
  };
  const altas = (sug.data || []).filter((x) => x.sugestoes[0]?.confianca === 'alta');
  const aplicarAltas = async () => {
    if (!(await confirmar({ titulo: `Dar baixa em ${altas.length} pagamentos?`, texto: 'Serão baixados só os pagamentos em que o nome de quem pagou e o valor batem com a dívida (certeza alta). Você pode desfazer cada baixa depois.', ok: 'Dar baixa em todos' }))) return;
    const r = await tentar(() => api('/recebimentos/conciliar-lote', { method: 'POST', body: { itens: altas.map((x) => ({ recebimento_id: x.recebimento.id, titulo_ids: x.sugestoes[0].titulo_ids })) } }));
    if (r) { toast(`${r.feitos} baixas feitas.`); recarregar(); }
  };
  const confirmarPend = async (r) => { if (await tentar(() => api(`/recebimentos/${r.id}/confirmar`, { method: 'POST' }), 'Pagamento confirmado e baixado!')) recarregar(); };
  const rejeitarPend = async (r) => {
    if (!(await confirmar({ titulo: 'Rejeitar este pagamento?', texto: 'O vendedor informou que o cliente pagou, mas você não confirmou. O título continua em aberto.', ok: 'Rejeitar', perigo: true }))) return;
    if (await tentar(() => api(`/recebimentos/${r.id}/rejeitar`, { method: 'POST', body: {} }), 'Pagamento rejeitado.')) recarregar();
  };
  const excluir = async (r) => {
    if (!(await confirmar({ titulo: 'Excluir este recebimento?', texto: `${fmtBRL(r.valor_centavos)} de ${r.pagador_nome || 'pagador não identificado'}. As baixas feitas com ele também são desfeitas.`, ok: 'Excluir', perigo: true }))) return;
    if (await tentar(() => api(`/recebimentos/${r.id}`, { method: 'DELETE' }), 'Recebimento excluído.')) recarregar();
  };

  const nPend = al.data?.pendentes || 0;
  const colunas = (comAcoes) => [
    { t: 'Data', r: (r) => fmtBR(r.data), cls: 'nowrap' },
    { t: 'Quem pagou', cls: 'col-nome', r: (r) => html`<b>${r.pagador_nome || r.cliente_nome || 'Não identificado'}</b>${r.cliente_nome && r.pagador_nome && r.cliente_nome !== r.pagador_nome ? html`<span class="sub-l">Cliente: ${r.cliente_nome}</span>` : ''}` },
    { t: 'Valor', num: true, r: (r) => html`<b>${fmtBRL(r.valor_centavos)}</b>` },
    { t: 'Forma', r: (r) => FORMAS[r.forma] || r.forma },
    { t: 'Situação', r: (r) => r.status === 'pendente' ? html`<${Badge} tipo="warn">Aguarda confirmação<//>` : r.status === 'cancelado' ? html`<${Badge}>Rejeitado<//>` : r.alocado_centavos >= r.valor_centavos ? html`<${Badge} tipo="ok">Com baixa<//>` : r.alocado_centavos > 0 ? html`<${Badge} tipo="info">Baixa parcial<//>` : html`<${Badge} tipo="bad">Sem baixa<//>` },
    ...(admin ? [{ t: 'Vendedor', r: (r) => r.vendedor_nome || '—', cls: 'hide-m' }] : []),
    { t: '', acoes: true, r: (r) => html`<div class="row gap-s nw">
      ${r.arquivo_id && html`<${Btn} sm icon="eye" href=${`/api/recebimentos/${r.id}/comprovante`} target="_blank">Comprovante<//>`}
      ${admin && comAcoes === 'pend' && html`<${Btn} sm tipo="primary" onClick=${() => confirmarPend(r)}>Confirmar<//><${Btn} sm tipo="danger" onClick=${() => rejeitarPend(r)}>Rejeitar<//>`}
      ${admin && comAcoes === 'todos' && r.status === 'confirmado' && r.valor_centavos > r.alocado_centavos && html`<${Btn} sm onClick=${() => setEscolher(r)}>Dar baixa<//>`}
      ${admin && comAcoes === 'todos' && html`<${Btn} sm tipo="ghost" icon="trash" onClick=${() => excluir(r)} title="Excluir">${''}<//>`}</div>` },
  ];

  return html`<div class="page">
    <${PageHead} titulo=${admin ? 'Recebimentos (Pix e outros)' : 'Pagamentos dos meus clientes'} sub=${admin ? 'Confira quem pagou e dê baixa nas dívidas — o painel sugere onde cada Pix se encaixa' : 'Pagamentos que já foram baixados ou que você informou'}>
      ${admin && html`<${Btn} icon="upload" href="#/importar">Importar Pix / extrato<//><${Btn} tipo="primary" icon="plus" onClick=${() => setNovo(true)}>Registrar recebimento<//>`}
    <//>
    <${Tabs} valor=${aba} onChange=${setAba} abas=${[...(admin ? [['conciliar', 'A conciliar (Pix sem baixa)', al.data?.sem_baixa]] : []), ['pendentes', 'Aguardando confirmação', nPend], ['todos', 'Todos']]} />

    ${aba === 'conciliar' && admin && (sug.error && !sug.data ? html`<${ErroCaixa} erro=${sug.error} onRetry=${sug.reload} />` : !sug.data ? html`<${Spinner} />` : sug.data.length === 0 ? html`<div class="card"><${Empty} icon="check" titulo="Tudo conciliado!">Não há pagamentos sem baixa. Importe um extrato ou comprovantes de Pix para continuar.<//></div>` : html`
      <div class="stack">
        <div class="alert info"><${Icon} n="zap" /><div class="grow"><b>${sug.data.length}</b> pagamentos recebidos ainda não foram ligados a uma dívida. ${altas.length > 0 ? html`Em <b>${altas.length}</b> deles o nome e o valor batem.` : 'O painel mostra abaixo as sugestões.'}</div>
          ${altas.length > 0 && html`<${Btn} tipo="primary" sm icon="check" onClick=${aplicarAltas}>Dar baixa nos ${altas.length} com certeza alta<//>`}</div>
        ${sug.data.map((it) => html`<div class="sug-card" key=${it.recebimento.id}>
          <div class="row between" style="align-items:flex-start">
            <div><div class="bold" style="font-size:16px">${it.recebimento.pagador_nome || 'Pagador não identificado'}</div>
              <div class="muted small">${fmtBR(it.recebimento.data)} · ${FORMAS[it.recebimento.forma]}${it.recebimento.banco ? ` · ${it.recebimento.banco}` : ''}${it.recebimento.ref_externa && !it.recebimento.ref_externa.startsWith('ofx:') ? ` · ${it.recebimento.ref_externa.slice(0, 12)}…` : ''}</div></div>
            <div class="right"><div class="bold" style="font-size:20px">${fmtBRL(it.recebimento.saldo_centavos)}</div>
              <div class="row gap-s" style="justify-content:flex-end;margin-top:4px">${it.recebimento.arquivo_id && html`<${Btn} sm tipo="ghost" icon="eye" href=${`/api/recebimentos/${it.recebimento.id}/comprovante`} target="_blank">Comprovante<//>`}
                <${Btn} sm tipo="ghost" icon="trash" title="Excluir" onClick=${() => excluir(it.recebimento)}>${''}<//></div></div></div>
          ${it.sugestoes.length ? it.sugestoes.map((s, i) => html`<div class="sug-opt" key=${i}><div><div class="row gap-s"><${Badge} tipo=${CONF[s.confianca][0]}>${CONF[s.confianca][1]}<//> <b>${s.cliente_nome}</b> <span class="muted small">· ${s.titulos.length} ${s.titulos.length === 1 ? 'título' : 'títulos'}: ${s.titulos.map((t) => `${fmtBR(t.vencimento)}${t.documento ? ` (doc ${t.documento})` : ''}`).join(', ')}</span></div>
              <div class="small muted" style="margin-top:2px">${s.motivo} · baixa de ${fmtBRL(s.valor_centavos)}</div></div>
            <${Btn} sm tipo=${s.confianca === 'alta' ? 'primary' : undefined} icon="check" onClick=${() => aplicar(it, s)}>Dar baixa<//></div>`)
            : html`<div class="sug-opt" style="background:#fbfcfb;border:1px dashed var(--line-2)"><span class="muted small">Não encontrei dívida parecida para este pagamento.</span></div>`}
          <div style="margin-top:10px"><${Btn} sm onClick=${() => setEscolher(it.recebimento)}>Escolher a dívida manualmente…<//></div></div>`)}
      </div>`)}

    ${aba === 'pendentes' && (pend.error && !pend.data ? html`<${ErroCaixa} erro=${pend.error} onRetry=${pend.reload} />` : !pend.data ? html`<${Spinner} />` : html`<div class="card"><${Tabela} linhas=${pend.data.itens} cols=${colunas('pend')}
      vazio=${html`<${Empty} icon="check" titulo="Nada aguardando confirmação">Quando um vendedor avisar que um cliente pagou, o pagamento aparece aqui para você conferir.<//>`} /></div>`)}

    ${aba === 'todos' && html`<div class="card">
      <div class="pad-s row" style="border-bottom:1px solid var(--line)"><${MonthBar} mes=${mes} setMes=${setMes} /><${SearchBox} value=${busca} onInput=${setBusca} placeholder="Buscar pagador ou código…" />
        <${Select} sm value=${forma} onChange=${setForma} style="max-width:170px"><option value="">Todas as formas</option>${Object.entries(FORMAS).filter(([k]) => k !== 'prazo').map(([k, v]) => html`<option value=${k}>${v}</option>`)}<//>
        <${Btn} sm icon="download" href=${`/api/exportar/recebimentos.csv${qs({ mes, busca: b, forma })}`}>Planilha<//></div>
      ${todos.error && !todos.data ? html`<div class="pad"><${ErroCaixa} erro=${todos.error} onRetry=${todos.reload} /></div>` : !todos.data ? html`<${Spinner} />` : html`
        <div class=${todos.loading ? 'carregando' : ''}><${Tabela} linhas=${todos.data.itens} cols=${colunas('todos')} vazio=${html`<${Empty} icon="cash" titulo="Nenhum recebimento neste mês">Registre um recebimento ou importe comprovantes e extratos.<//>`}
          rodape=${html`<tr><td colspan="3"><b>${todos.data.totais.qtd} recebimentos</b></td><td class="num" colspan="4"><b>${fmtBRL(todos.data.totais.total)}</b> ${todos.data.totais.sem_baixa > 0 ? html`<span class="muted small">(${fmtBRL(todos.data.totais.sem_baixa)} sem baixa)</span>` : ''}</td></tr>`} /></div>
        <${Pager} pagina=${pagina} limite=${100} total=${todos.data.totais.qtd} onPage=${setPagina} />`}
    </div>`}

    ${novo && html`<${NovoRecebimento} onClose=${() => setNovo(false)} onFeito=${() => { setNovo(false); recarregar(); }} />`}
    ${escolher && html`<${EscolherTitulo} r=${escolher} onClose=${() => setEscolher(null)} onFeito=${() => { setEscolher(null); recarregar(); }} />`}
  </div>`;
}

function NovoRecebimento({ onClose, onFeito }) {
  const [f, setF] = useState({ data: todayISO(), valor: null, forma: 'pix', pagador: '', cliente: null, obs: '', arq: null, ref: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const abertos = useApi(f.cliente ? `/titulos${qs({ status: 'abertos', cliente_id: f.cliente.id, limite: 100 })}` : null);
  const [marcados, setMarcados] = useState(new Set());
  useEffect(() => setMarcados(new Set()), [f.cliente?.id]);
  const salvar = async () => {
    const fd = new FormData();
    fd.set('data', f.data); fd.set('valor_centavos', f.valor ?? ''); fd.set('forma', f.forma); fd.set('pagador_nome', f.pagador || f.cliente?.nome || ''); fd.set('observacoes', f.obs); fd.set('ref_externa', f.ref);
    if (f.cliente) fd.set('cliente_id', f.cliente.id);
    if (marcados.size) fd.set('titulo_ids', [...marcados].join(','));
    if (f.arq) fd.set('comprovante', f.arq);
    if (await tentar(() => api('/recebimentos', { method: 'POST', form: fd }), 'Recebimento registrado!')) onFeito();
  };
  const toggle = (id) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return html`<${Modal} titulo="Registrar recebimento" sub="Pix, dinheiro ou outro pagamento que entrou" tam="wide" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>${marcados.size ? 'Registrar e dar baixa' : 'Registrar'}<//>`}>
    <div class="form-grid">
      <${Field} label="Valor recebido"><${MoneyInput} value=${f.valor} onChange=${set('valor')} /><//>
      <${Field} label="Data"><${Input} type="date" value=${f.data} onInput=${set('data')} /><//>
      <${Field} label="Forma"><${Select} value=${f.forma} onChange=${set('forma')}>${['pix', 'dinheiro', 'cartao', 'transferencia', 'boleto', 'cheque', 'outro'].map((k) => html`<option value=${k}>${FORMAS[k]}</option>`)}<//><//>
      <${Field} label="Cliente (opcional)"><${ClientePicker} valor=${f.cliente} onChange=${set('cliente')} permitirNovo=${false} /><//>
      <${Field} label="Nome de quem pagou (como aparece no Pix)"><${Input} value=${f.pagador} onInput=${set('pagador')} placeholder=${f.cliente?.nome || ''} /><//>
      <${Field} label="Código da transação (opcional)"><${Input} value=${f.ref} onInput=${set('ref')} /><//>
      <${Field} label="Comprovante (PDF ou foto)" cls="full"><input class="input" type="file" accept="application/pdf,image/*" style="padding-top:8px" onChange=${(e) => set('arq')(e.target.files[0] || null)} /><//>
    </div>
    ${f.cliente && html`<div class="sep"></div><div class="lbl" style="margin-bottom:8px">Dívidas em aberto de ${f.cliente.nome} — marque as que este pagamento quita</div>
      ${!abertos.data ? html`<${Spinner} />` : abertos.data.itens.length === 0 ? html`<div class="muted small">Este cliente não tem nada em aberto.</div>` : html`<div class="stack" style="gap:6px">${abertos.data.itens.map((t) => html`<label class="chk" key=${t.id} style="border:1px solid var(--line);border-radius:10px;padding:9px 12px"><input type="checkbox" checked=${marcados.has(t.id)} onChange=${() => toggle(t.id)} /><span>Vence ${fmtBR(t.vencimento)}${t.documento ? ` · doc ${t.documento}` : ''} — <b>${fmtBRL(t.aberto_centavos)}</b> ${t.status === 'vencido' ? html`<span class="red small">(vencido)</span>` : ''}</span></label>`)}</div>`}`}
  <//>`;
}

function EscolherTitulo({ r, onClose, onFeito }) {
  const [cliente, setCliente] = useState(r.cliente_id ? { id: r.cliente_id, nome: r.cliente_nome } : null);
  const abertos = useApi(cliente ? `/titulos${qs({ status: 'abertos', cliente_id: cliente.id, limite: 100 })}` : null);
  const [marcados, setMarcados] = useState(new Set());
  useEffect(() => setMarcados(new Set()), [cliente?.id]);
  const toggle = (id) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const salvar = async () => {
    const aloc = [...marcados].map((id) => ({ titulo_id: id }));
    if (await tentar(() => api(`/recebimentos/${r.id}/conciliar`, { method: 'POST', body: { alocacoes: aloc } }), 'Baixa feita!')) onFeito();
  };
  return html`<${Modal} titulo="Dar baixa neste pagamento" sub=${`${r.pagador_nome || 'Pagador não identificado'} · ${fmtBRL(r.valor_centavos - (r.alocado_centavos || 0))} disponíveis`} onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" disabled=${!marcados.size} onClick=${salvar}>Dar baixa<//>`}>
    <${Field} label="De qual cliente é a dívida?"><${ClientePicker} valor=${cliente} onChange=${setCliente} permitirNovo=${false} placeholder="Digite o nome do cliente…" /><//>
    ${cliente && html`<div style="margin-top:14px"><div class="lbl" style="margin-bottom:8px">Marque as dívidas que este pagamento quita (do mais antigo para o mais novo)</div>
      ${!abertos.data ? html`<${Spinner} />` : abertos.data.itens.length === 0 ? html`<div class="muted small">Este cliente não tem nada em aberto.</div>` : html`<div class="stack" style="gap:6px">${abertos.data.itens.map((t) => html`<label class="chk" key=${t.id} style="border:1px solid var(--line);border-radius:10px;padding:9px 12px"><input type="checkbox" checked=${marcados.has(t.id)} onChange=${() => toggle(t.id)} /><span>Vence ${fmtBR(t.vencimento)}${t.documento ? ` · doc ${t.documento}` : ''} — <b>${fmtBRL(t.aberto_centavos)}</b> ${t.status === 'vencido' ? html`<span class="red small">(vencido)</span>` : ''}</span></label>`)}</div>`}</div>`}
  <//>`;
}
