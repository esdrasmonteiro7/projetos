// Vendas: lista, nova venda (manual) e detalhes.
import {
  html, useState, useEffect, useMemo, api, qs, useApi, useMes, useDebounced, fmtBRL, fmtBR, fmtQtd, ymLabel, todayISO, addDays, FORMAS, tentar, toast, confirmar,
} from '../lib.js';
import {
  PageHead, MonthBar, Select, SearchBox, Btn, Tabela, Pager, Empty, Badge, Modal, Field, Input, MoneyInput, Check, Seg, ClientePicker, Icon, ErroCaixa, Spinner, StatusTitulo,
} from '../ui.js';

const SIT = { paga: ['ok', 'Paga'], aberta: ['warn', 'A receber'], parcial: ['info', 'Paga em parte'], cancelada: ['mute', 'Cancelada'] };

export default function Vendas({ usuario }) {
  const admin = usuario.papel === 'admin';
  const [mes, setMes] = useMes();
  const [busca, setBusca] = useState('');
  const [vend, setVend] = useState('');
  const [status, setStatus] = useState('ativa');
  const [pagina, setPagina] = useState(1);
  const [nova, setNova] = useState(false);
  const [det, setDet] = useState(null);
  const b = useDebounced(busca);
  useEffect(() => setPagina(1), [mes, b, vend, status]);
  const vs = useApi(admin ? '/vendedores' : null);
  const url = `/vendas${qs({ mes, busca: b, vendedor_id: admin ? vend : undefined, status, pagina, limite: 50 })}`;
  const { data, loading, error, reload } = useApi(url);

  return html`<div class="page">
    <${PageHead} titulo=${admin ? 'Vendas' : 'Minhas vendas'} sub=${data ? `${data.total} ${data.total === 1 ? 'venda' : 'vendas'} em ${ymLabel(mes)} · ${fmtBRL(data.soma_centavos)}` : ' '}>
      <${MonthBar} mes=${mes} setMes=${setMes} />
      <${Btn} icon="download" href=${`/api/exportar/vendas.csv${qs({ mes, vendedor_id: admin ? vend : undefined, busca: b })}`} title="Baixar em planilha (Excel)">Planilha<//>
      <${Btn} tipo="primary" icon="plus" onClick=${() => setNova(true)}>Nova venda<//>
    <//>
    <div class="card">
      <div class="pad-s row" style="border-bottom:1px solid var(--line)">
        <${SearchBox} value=${busca} onInput=${setBusca} placeholder="Buscar cliente ou nº…" />
        ${admin && html`<${Select} sm value=${vend} onChange=${setVend} aria-label="Vendedor" style="max-width:210px"><option value="">Todos os vendedores</option>${(vs.data || []).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//>`}
        <${Seg} valor=${status} onChange=${setStatus} opcoes=${[['ativa', 'Ativas'], ['cancelada', 'Canceladas'], ['todas', 'Todas']]} />
      </div>
      ${error && !data ? html`<div class="pad"><${ErroCaixa} erro=${error} onRetry=${reload} /></div>` : !data ? html`<${Spinner} />` : html`
        <div class=${loading ? 'carregando' : ''}><${Tabela} linhas=${data.itens} onRow=${(v) => setDet(v.id)}
          vazio=${html`<${Empty} icon="cart" titulo="Nenhuma venda neste mês">Clique em "Nova venda" ou use <a href="#/importar">Importar arquivos</a> para trazer vendas de planilhas, PDF e notas fiscais.<//>`}
          cols=${[
            { t: 'Data', r: (v) => fmtBR(v.data), cls: 'nowrap' },
            { t: 'Cliente', cls: 'col-nome', r: (v) => html`<b>${v.cliente_nome || 'Balcão (sem cliente)'}</b>${v.numero ? html`<span class="sub-l">Nº ${v.numero}</span>` : ''}` },
            ...(admin ? [{ t: 'Vendedor', r: (v) => v.vendedor_nome || '—' }] : []),
            { t: 'Total', num: true, r: (v) => html`<b>${fmtBRL(v.total_centavos)}</b>` },
            { t: 'Pagamento', r: (v) => FORMAS[v.forma_pagamento] || '—' },
            { t: 'Situação', r: (v) => html`<${Badge} tipo=${SIT[v.situacao][0]}>${SIT[v.situacao][1]}<//>` },
            { t: 'Origem', r: (v) => html`<span class="muted small">${{ manual: 'Lançada à mão', xml: 'Nota fiscal', xlsx: 'Planilha', csv: 'Planilha', planilha: 'Planilha da empresa', pdf: 'Relatório' }[v.origem] || v.origem}</span>`, cls: 'hide-m' },
          ]} /></div>
        <${Pager} pagina=${pagina} limite=${50} total=${data.total} onPage=${setPagina} />`}
    </div>
    ${nova && html`<${NovaVenda} usuario=${usuario} onClose=${() => setNova(false)} onFeito=${() => { setNova(false); reload(); }} />`}
    ${det && html`<${VendaDetalhe} id=${det} admin=${admin} onClose=${() => setDet(null)} onMudou=${() => { setDet(null); reload(); }} />`}
  </div>`;
}

function NovaVenda({ usuario, onClose, onFeito }) {
  const admin = usuario.papel === 'admin';
  const hoje = todayISO();
  const prod = useApi('/produtos');
  const vs = useApi(admin ? '/vendedores' : null);
  const [f, setF] = useState({
    data: hoje, vendedor_id: admin ? '' : usuario.vendedor_id, cliente: null, clienteNovo: null, numero: '', desconto: null, observacoes: '',
    itens: [{ produto_id: '', descricao: '', quantidade: 1, preco: null }], modo: 'avista', forma: 'pix', pago: true, data_pagamento: hoje,
    n_parcelas: 1, primeiro_vencimento: addDays(hoje, 30), intervalo_dias: 30, baixar_estoque: false,
  });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setItem = (i, patch) => setF((x) => ({ ...x, itens: x.itens.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const subtotal = f.itens.reduce((s, i) => s + Math.round((Number(i.quantidade) || 0) * (i.preco || 0)), 0);
  const total = Math.max(subtotal - (f.desconto || 0), 0);
  const parcelas = useMemo(() => {
    if (f.modo !== 'prazo') return [];
    const n = Math.max(1, Math.min(48, Number(f.n_parcelas) || 1));
    const base = Math.floor(total / n);
    return Array.from({ length: n }, (_, k) => ({ vencimento: addDays(f.primeiro_vencimento, (Number(f.intervalo_dias) || 30) * k), valor: k === n - 1 ? total - base * (n - 1) : base }));
  }, [f.modo, f.n_parcelas, f.primeiro_vencimento, f.intervalo_dias, total]);

  const escolherProduto = (i, id) => {
    const p = prod.data?.find((x) => String(x.id) === String(id));
    setItem(i, p ? { produto_id: p.id, descricao: p.nome, preco: p.preco_centavos } : { produto_id: '', descricao: '' });
  };
  const salvar = async () => {
    if (!f.vendedor_id) return toast('Escolha o vendedor.', 'erro');
    if (!f.cliente && !f.clienteNovo && (f.modo === 'prazo' || !f.pago)) return toast('Escolha o cliente (venda a prazo ou não paga precisa de cliente).', 'erro');
    if (!subtotal) return toast('Informe os itens com quantidade e preço.', 'erro');
    setSalvando(true);
    const body = {
      data: f.data, vendedor_id: Number(f.vendedor_id), cliente_id: f.cliente?.id, cliente_novo: f.clienteNovo, numero: f.numero, observacoes: f.observacoes,
      itens: f.itens.filter((i) => i.descricao || i.produto_id).map((i) => ({ produto_id: i.produto_id || undefined, descricao: i.descricao, quantidade: Number(i.quantidade), preco_centavos: i.preco || 0 })),
      desconto_centavos: f.desconto || 0, forma_pagamento: f.modo === 'prazo' ? 'prazo' : f.forma, pago: f.modo === 'avista' && f.pago, data_pagamento: f.pago ? f.data_pagamento : undefined,
      n_parcelas: f.modo === 'prazo' ? Number(f.n_parcelas) : 1, primeiro_vencimento: f.modo === 'prazo' ? f.primeiro_vencimento : undefined, intervalo_dias: Number(f.intervalo_dias) || 30,
      baixar_estoque: admin && f.baixar_estoque,
    };
    const r = await tentar(() => api('/vendas', { method: 'POST', body }), 'Venda lançada!');
    setSalvando(false);
    if (r) onFeito();
  };

  return html`<${Modal} titulo="Nova venda" tam="wide" onClose=${onClose}
    rodape=${html`<div class="grow"><span class="muted small">Total</span> <b style="font-size:20px">${fmtBRL(total)}</b></div><${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" disabled=${salvando} onClick=${salvar}>${salvando ? 'Salvando…' : 'Lançar venda'}<//>`}>
    <div class="form-grid">
      <${Field} label="Data da venda"><${Input} type="date" value=${f.data} onInput=${set('data')} /><//>
      ${admin ? html`<${Field} label="Vendedor"><${Select} value=${f.vendedor_id} onChange=${set('vendedor_id')}><option value="">Escolha…</option>${(vs.data || []).filter((v) => v.ativo).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//><//>` : html`<${Field} label="Vendedor"><${Input} value=${usuario.nome} readonly /><//>`}
      <${Field} label="Cliente" cls="full"><${ClientePicker} valor=${f.cliente} vendedorId=${admin ? undefined : usuario.vendedor_id} onChange=${(c) => setF((x) => ({ ...x, cliente: c, clienteNovo: c ? null : x.clienteNovo }))} onNovo=${(nome) => setF((x) => ({ ...x, cliente: null, clienteNovo: { nome, telefone: '' } }))} />
        ${f.clienteNovo && html`<div class="alert info" style="margin-top:8px"><${Icon} n="plus" /><div class="grow"><b>Novo cliente: ${f.clienteNovo.nome}</b> — será cadastrado junto com a venda.
          <div style="margin-top:8px;max-width:280px"><${Input} placeholder="Telefone / WhatsApp (opcional)" value=${f.clienteNovo.telefone} onInput=${(v) => setF((x) => ({ ...x, clienteNovo: { ...x.clienteNovo, telefone: v } }))} /></div></div></div>`}
      <//>
    </div>
    <div class="sep"></div>
    <div class="lbl" style="margin-bottom:8px">Itens vendidos</div>
    <div class="stack" style="gap:10px">${f.itens.map((it, i) => html`<div class="item-line" key=${i}>
      <div class="ph">${it.produto_id !== '' || !it.custom ? html`<${Select} value=${it.produto_id} onChange=${(v) => (v === '__outro' ? setItem(i, { produto_id: '', custom: true }) : escolherProduto(i, v))} aria-label="Produto"><option value="">Escolha o produto…</option>${(prod.data || []).map((p) => html`<option value=${p.id}>${p.nome} — ${fmtBRL(p.preco_centavos)}/${p.unidade}</option>`)}<option value="__outro">Outro (digitar)…</option><//>`
        : html`<${Input} placeholder="Descrição do item" value=${it.descricao} onInput=${(v) => setItem(i, { descricao: v })} />`}</div>
      <${Input} type="number" min="0" step="any" inputmode="decimal" placeholder="Qtd" value=${it.quantidade} onInput=${(v) => setItem(i, { quantidade: v })} aria-label="Quantidade" />
      <${MoneyInput} value=${it.preco} onChange=${(v) => setItem(i, { preco: v })} placeholder="Preço un." aria-label="Preço unitário" />
      <div class="right bold mono">${fmtBRL(Math.round((Number(it.quantidade) || 0) * (it.preco || 0)))}</div>
      <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remover item" disabled=${f.itens.length === 1} onClick=${() => setF((x) => ({ ...x, itens: x.itens.filter((_, j) => j !== i) }))}><${Icon} n="x" s=${16} /></button></div>`)}
      <div><${Btn} sm icon="plus" onClick=${() => setF((x) => ({ ...x, itens: [...x.itens, { produto_id: '', descricao: '', quantidade: 1, preco: null }] }))}>Adicionar item<//></div></div>
    <div class="form-grid" style="margin-top:14px"><${Field} label="Desconto (opcional)"><${MoneyInput} value=${f.desconto} onChange=${set('desconto')} /><//><${Field} label="Nº do pedido/nota (opcional)"><${Input} value=${f.numero} onInput=${set('numero')} /><//></div>
    <div class="sep"></div>
    <div class="lbl" style="margin-bottom:8px">Pagamento</div>
    <${Seg} valor=${f.modo} onChange=${set('modo')} opcoes=${[['avista', 'À vista'], ['prazo', 'A prazo (fica devendo)']]} />
    ${f.modo === 'avista' ? html`<div class="form-grid" style="margin-top:12px">
      <${Field} label="Forma"><${Select} value=${f.forma} onChange=${set('forma')}>${['pix', 'dinheiro', 'cartao', 'transferencia'].map((k) => html`<option value=${k}>${FORMAS[k]}</option>`)}<//><//>
      <div class="field" style="align-content:end"><${Check} checked=${f.pago} onChange=${set('pago')}>Já recebi o pagamento<//></div>
      ${f.pago && html`<${Field} label="Data do pagamento"><${Input} type="date" value=${f.data_pagamento} onInput=${set('data_pagamento')} /><//>`}</div>`
      : html`<div class="form-grid" style="margin-top:12px">
      <${Field} label="Número de parcelas"><${Input} type="number" min="1" max="48" value=${f.n_parcelas} onInput=${set('n_parcelas')} /><//>
      <${Field} label="Vencimento da 1ª parcela"><${Input} type="date" value=${f.primeiro_vencimento} onInput=${set('primeiro_vencimento')} /><//>
      <${Field} label="Intervalo entre parcelas (dias)"><${Input} type="number" min="1" value=${f.intervalo_dias} onInput=${set('intervalo_dias')} /><//>
      <div class="full small muted">${parcelas.map((p, k) => html`<span class="chip" style="margin:2px 6px 2px 0">${k + 1}/${parcelas.length} · ${fmtBR(p.vencimento)} · <b>${fmtBRL(p.valor)}</b></span>`)}</div></div>`}
    <div class="form-grid" style="margin-top:14px"><${Field} label="Observações" cls="full"><${Input} value=${f.observacoes} onInput=${set('observacoes')} placeholder="Opcional" /><//></div>
    ${admin && html`<div style="margin-top:12px"><${Check} checked=${f.baixar_estoque} onChange=${set('baixar_estoque')}>Dar saída destes produtos no depósito<//></div>`}
  <//>`;
}

function VendaDetalhe({ id, admin, onClose, onMudou }) {
  const { data, error, reload } = useApi(`/vendas/${id}`);
  if (error) return html`<${Modal} titulo="Venda" onClose=${onClose}><${ErroCaixa} erro=${error} /><//>`;
  if (!data) return html`<${Modal} titulo="Venda" onClose=${onClose}><${Spinner} /><//>`;
  const { venda: v, itens, titulos } = data;
  const cancelar = async () => {
    if (!(await confirmar({ titulo: 'Cancelar esta venda?', texto: `A venda de ${fmtBRL(v.total_centavos)} e suas parcelas serão canceladas. Pagamentos já baixados nela voltam a ficar sem baixa.`, ok: 'Cancelar venda', perigo: true }))) return;
    if (await tentar(() => api(`/vendas/${id}/cancelar`, { method: 'POST' }), 'Venda cancelada.')) onMudou();
  };
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir esta venda?', texto: 'Ela some do sistema (só é possível se não houver pagamentos baixados).', ok: 'Excluir', perigo: true }))) return;
    if (await tentar(() => api(`/vendas/${id}`, { method: 'DELETE' }), 'Venda excluída.')) onMudou();
  };
  return html`<${Modal} titulo=${`Venda${v.numero ? ` nº ${v.numero}` : ''}`} sub=${`${fmtBR(v.data)} · ${v.cliente_nome || 'Balcão'} · ${v.vendedor_nome || 'sem vendedor'}`} tam="wide" onClose=${onClose}
    rodape=${admin ? html`${v.status !== 'cancelada' && html`<${Btn} tipo="danger" onClick=${cancelar}>Cancelar venda<//>`}<${Btn} tipo="danger" icon="trash" onClick=${excluir}>Excluir<//><${Btn} onClick=${onClose}>Fechar<//>` : html`<${Btn} onClick=${onClose}>Fechar<//>`}>
    ${v.status === 'cancelada' && html`<div class="alert bad" style="margin-bottom:14px">Esta venda está cancelada.</div>`}
    <div class="chips" style="margin-bottom:14px"><span class="chip">Total <b>${fmtBRL(v.total_centavos)}</b></span>${v.desconto_centavos > 0 ? html`<span class="chip">Desconto <b>${fmtBRL(v.desconto_centavos)}</b></span>` : ''}<span class="chip">Forma <b>${FORMAS[v.forma_pagamento] || '—'}</b></span><span class="chip">Origem <b>${v.origem}</b></span></div>
    ${itens.length > 0 && html`<div class="lbl" style="margin-bottom:6px">Itens</div><${Tabela} linhas=${itens} stack=${false} cols=${[
      { t: 'Produto', r: (i) => i.descricao }, { t: 'Qtd', num: true, r: (i) => `${fmtQtd(i.quantidade)} ${i.unidade || ''}` },
      { t: 'Preço', num: true, r: (i) => fmtBRL(i.preco_centavos) }, { t: 'Total', num: true, r: (i) => html`<b>${fmtBRL(i.total_centavos)}</b>` }]} />`}
    <div class="lbl" style="margin:16px 0 6px">Parcelas / contas a receber</div>
    <${Tabela} linhas=${titulos} stack=${false} chave=${(t) => t.id} vazio=${html`<div class="muted small">Sem parcelas.</div>`} cols=${[
      { t: 'Parcela', r: (t) => t.parcela || 'Única' }, { t: 'Vencimento', r: (t) => fmtBR(t.vencimento) }, { t: 'Valor', num: true, r: (t) => fmtBRL(t.valor_centavos) },
      { t: 'Pago', num: true, r: (t) => fmtBRL(t.pago_centavos) }, { t: 'Situação', r: (t) => html`<${StatusTitulo} t=${t} />` }]} />
    ${v.observacoes && html`<div class="small muted" style="margin-top:12px">Obs.: ${v.observacoes}</div>`}
  <//>`;
}
