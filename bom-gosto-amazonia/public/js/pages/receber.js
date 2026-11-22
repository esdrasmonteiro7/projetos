// A receber (devedores): quem deve, quanto, desde quando — dar baixa, cobrar por WhatsApp.
import {
  html, useState, useEffect, api, qs, useApi, useRoute, useDebounced, fmtBRL, fmtBR, ymLabel, ymAdd, todayISO, FORMAS, tentar, toast, confirmar,
} from '../lib.js';
import {
  PageHead, Select, SearchBox, Btn, Tabela, Pager, Empty, Modal, Field, Input, MoneyInput, Seg, ClientePicker, Icon, ErroCaixa, Spinner, StatusTitulo, Badge, KPI,
} from '../ui.js';
import { COR } from '../charts.js';

async function abrirWhats(url) {
  try {
    const r = await api(url);
    if (!r.telefone) toast('Este cliente está sem telefone cadastrado — escolha o contato no WhatsApp.', 'aviso');
    window.open(r.link, '_blank', 'noopener');
  } catch (e) { toast(e.message, 'erro'); }
}

export default function Receber({ usuario }) {
  const admin = usuario.papel === 'admin';
  const route = useRoute();
  const [status, setStatus] = useState(route.query.status || 'abertos');
  const [mesV, setMesV] = useState(route.query.mes || '');
  const [cliente, setCliente] = useState(route.query.cliente_id || '');
  const [vend, setVend] = useState('');
  const [busca, setBusca] = useState('');
  const [visao, setVisao] = useState('titulos');
  const [pagina, setPagina] = useState(1);
  const [sel, setSel] = useState(new Set());
  const [modal, setModal] = useState(null);
  useEffect(() => { if (route.query.status) setStatus(route.query.status); setMesV(route.query.mes || ''); setCliente(route.query.cliente_id || ''); }, [route.query.status, route.query.mes, route.query.cliente_id]);
  const b = useDebounced(busca);
  useEffect(() => { setPagina(1); setSel(new Set()); }, [status, mesV, vend, b, visao, cliente]);
  const vs = useApi(admin ? '/vendedores' : null);

  const t = useApi(visao === 'titulos' ? `/titulos${qs({ status, mes: mesV, busca: b, vendedor_id: admin ? vend : undefined, cliente_id: cliente, pagina, limite: 100 })}` : null);
  const c = useApi(visao === 'clientes' ? `/clientes${qs({ devedores: true, ordem: 'aberto', busca: b, vendedor_id: admin ? vend : undefined, pagina, limite: 100 })}` : null);
  const reload = () => { t.reload(); c.reload(); setSel(new Set()); };

  const meses = Array.from({ length: 10 }, (_, i) => ymAdd(todayISO().slice(0, 7), i - 3));
  const tot = t.data?.totais;
  const itens = t.data?.itens || [];
  const selTit = itens.filter((x) => sel.has(x.id));
  const selSoma = selTit.reduce((s, x) => s + x.aberto_centavos, 0);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return html`<div class="page">
    <${PageHead} titulo=${admin ? 'A receber' : 'A receber dos meus clientes'} sub="Contas em aberto, vencidas e pagas — tudo que os clientes devem">
      <${Btn} icon="download" href=${`/api/exportar/a-receber.csv${qs({ status, mes: mesV, busca: b, vendedor_id: admin ? vend : undefined, cliente_id: cliente })}`}>Planilha<//>
      ${admin && html`<${Btn} tipo="primary" icon="plus" onClick=${() => setModal({ tipo: 'divida' })}>Lançar dívida<//>`}
    <//>
    ${visao === 'titulos' && tot && html`<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:16px">
      <${KPI} cor=${COR.azul} rotulo=${status === 'pagos' ? 'Valor pago' : 'Em aberto'} valor=${fmtBRL(status === 'pagos' ? tot.pago_total : tot.aberto_total)} sub=${`${tot.qtd} títulos · ${tot.clientes} clientes`} />
      <${KPI} cor=${COR.alerta} alerta=${tot.vencido_total > 0} rotulo="Vencido" valor=${html`<span class=${tot.vencido_total > 0 ? 'red' : ''}>${fmtBRL(tot.vencido_total)}</span>`} sub=${tot.vencido_total > 0 ? 'Já passou do vencimento' : 'Nada atrasado'} />
      <${KPI} cor=${COR.verde} rotulo="Já pago (nestes títulos)" valor=${fmtBRL(tot.pago_total)} sub=${`de ${fmtBRL(tot.valor_total)} lançados`} />
    </div>`}
    <div class="card">
      <div class="pad-s row" style="border-bottom:1px solid var(--line)">
        <${Seg} valor=${visao} onChange=${setVisao} opcoes=${[['titulos', 'Por título'], ['clientes', 'Por cliente']]} />
        ${visao === 'titulos' && html`<${Seg} valor=${status} onChange=${setStatus} opcoes=${[['abertos', 'Em aberto'], ['vencidos', 'Vencidos'], ['a_vencer', 'A vencer'], ['pagos', 'Pagos'], ['todos', 'Todos']]} />`}
      </div>
      <div class="pad-s row" style="border-bottom:1px solid var(--line)">
        <${SearchBox} value=${busca} onInput=${setBusca} placeholder="Buscar cliente ou documento…" />
        ${admin && html`<${Select} sm value=${vend} onChange=${setVend} aria-label="Vendedor" style="max-width:200px"><option value="">Todos os vendedores</option>${(vs.data || []).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//>`}
        ${visao === 'titulos' && html`<${Select} sm value=${mesV} onChange=${setMesV} aria-label="Mês de vencimento" style="max-width:200px"><option value="">Qualquer vencimento</option>${meses.map((m) => html`<option value=${m}>Vence em ${ymLabel(m)}</option>`)}<//>`}
        ${cliente && html`<button class="chip" onClick=${() => { setCliente(''); location.hash = '#/receber'; }}>Filtrando por 1 cliente <b>✕</b></button>`}
      </div>
      ${visao === 'titulos' ? (t.error && !t.data ? html`<div class="pad"><${ErroCaixa} erro=${t.error} onRetry=${t.reload} /></div>` : !t.data ? html`<${Spinner} />` : html`
        ${admin && sel.size > 0 && html`<div class="pad-s row between" style="background:var(--tint);border-bottom:1px solid var(--line)"><b>${sel.size} selecionados · ${fmtBRL(selSoma)}</b><${Btn} tipo="primary" sm icon="check" onClick=${() => setModal({ tipo: 'lote', ids: [...sel], soma: selSoma })}>Dar baixa nos selecionados<//></div>`}
        <div class=${t.loading ? 'carregando' : ''}><${Tabela} linhas=${itens} chave=${(x) => x.id} onRow=${(x) => setModal({ tipo: 'detalhe', id: x.id })}
          vazio=${html`<${Empty} icon="check" titulo=${status === 'vencidos' ? 'Nenhum título vencido' : 'Nada por aqui'}>Nenhum título encontrado com estes filtros.<//>`}
          cols=${[
            ...(admin ? [{ t: '', w: '34px', cls: 'no-l', r: (x) => x.aberto_centavos > 0 ? html`<input type="checkbox" checked=${sel.has(x.id)} onChange=${() => toggle(x.id)} aria-label="Selecionar" style="width:18px;height:18px;accent-color:var(--br600)" />` : '' }] : []),
            { t: 'Cliente', cls: 'col-nome', r: (x) => html`<b>${x.cliente_nome || '—'}</b>${x.documento || x.parcela ? html`<span class="sub-l">${[x.documento && `Doc ${x.documento}`, x.parcela && `Parcela ${x.parcela}`].filter(Boolean).join(' · ')}</span>` : ''}` },
            ...(admin ? [{ t: 'Vendedor', r: (x) => x.vendedor_nome || '—' }] : []),
            { t: 'Vencimento', cls: 'nowrap', r: (x) => fmtBR(x.vencimento) },
            { t: 'Valor', num: true, r: (x) => fmtBRL(x.valor_centavos) },
            { t: 'Pago', num: true, r: (x) => x.pago_centavos ? fmtBRL(x.pago_centavos) : '—' },
            { t: 'Em aberto', num: true, r: (x) => x.aberto_centavos > 0 ? html`<b>${fmtBRL(x.aberto_centavos)}</b>` : '—' },
            { t: 'Situação', r: (x) => html`<${StatusTitulo} t=${x} />` },
            { t: '', acoes: true, r: (x) => x.aberto_centavos > 0 ? html`<div class="row gap-s nw">
              ${admin ? html`<${Btn} sm tipo="primary" onClick=${() => setModal({ tipo: 'baixa', t: x })}>Dar baixa<//>` : html`<${Btn} sm onClick=${() => setModal({ tipo: 'informar', t: x })}>Informar pagamento<//>`}
              <${Btn} sm tipo="wa" icon="chat" title="Cobrar pelo WhatsApp" onClick=${() => abrirWhats(`/titulos/${x.id}/cobranca`)}>Cobrar<//></div>` : '' },
          ]} /></div>
        <${Pager} pagina=${pagina} limite=${100} total=${t.data.totais.qtd} onPage=${setPagina} />`)
      : (c.error && !c.data ? html`<div class="pad"><${ErroCaixa} erro=${c.error} onRetry=${c.reload} /></div>` : !c.data ? html`<${Spinner} />` : html`
        <div class=${c.loading ? 'carregando' : ''}><${Tabela} linhas=${c.data.itens}
          vazio=${html`<${Empty} icon="check" titulo="Nenhum cliente devendo">Quando houver dívidas em aberto, elas aparecem aqui.<//>`}
          cols=${[
            { t: 'Cliente', cls: 'col-nome', r: (x) => html`<b>${x.nome}</b>${x.telefone ? html`<span class="sub-l">${x.telefone}</span>` : ''}` },
            ...(admin ? [{ t: 'Vendedor', r: (x) => x.vendedor_nome || '—' }] : []),
            { t: 'Em aberto', num: true, r: (x) => html`<b>${fmtBRL(x.aberto_centavos)}</b>` },
            { t: 'Vencido', num: true, r: (x) => x.vencido_centavos > 0 ? html`<span class="red semi">${fmtBRL(x.vencido_centavos)}</span>` : '—' },
            { t: 'Última compra', r: (x) => fmtBR(x.ultima_compra) || '—' },
            { t: '', acoes: true, r: (x) => html`<div class="row gap-s nw"><${Btn} sm onClick=${() => { setVisao('titulos'); setCliente(String(x.id)); setStatus('abertos'); }}>Ver títulos<//>
              <${Btn} sm tipo="wa" icon="chat" onClick=${() => abrirWhats(`/clientes/${x.id}/cobranca`)}>Cobrar tudo<//></div>` },
          ]} /></div>
        <${Pager} pagina=${pagina} limite=${100} total=${c.data.total} onPage=${setPagina} />`)}
    </div>
    ${modal?.tipo === 'baixa' && html`<${BaixaModal} t=${modal.t} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} />`}
    ${modal?.tipo === 'lote' && html`<${LoteModal} m=${modal} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} />`}
    ${modal?.tipo === 'informar' && html`<${InformarModal} t=${modal.t} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} />`}
    ${modal?.tipo === 'divida' && html`<${DividaModal} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} />`}
    ${modal?.tipo === 'detalhe' && html`<${TituloDetalhe} id=${modal.id} admin=${admin} onClose=${() => setModal(null)} onMudou=${() => { reload(); }} onBaixa=${(x) => setModal({ tipo: 'baixa', t: x })} />`}
  </div>`;
}

function BaixaModal({ t, onClose, onFeito }) {
  const [f, setF] = useState({ valor: t.aberto_centavos, data: todayISO(), forma: 'pix', obs: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async () => {
    if (await tentar(() => api(`/titulos/${t.id}/baixar`, { method: 'POST', body: { valor_centavos: f.valor, data: f.data, forma: f.forma, observacoes: f.obs } }), 'Baixa registrada!')) onFeito();
  };
  return html`<${Modal} titulo="Dar baixa" sub=${`${t.cliente_nome || ''} · vence ${fmtBR(t.vencimento)}`} tam="sm" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" icon="check" onClick=${salvar}>Confirmar baixa<//>`}>
    <div class="alert info" style="margin-bottom:14px">Em aberto: <b>${fmtBRL(t.aberto_centavos)}</b>. Para pagamento parcial, diminua o valor.</div>
    <div class="form-grid">
      <${Field} label="Valor recebido"><${MoneyInput} value=${f.valor} onChange=${set('valor')} /><//>
      <${Field} label="Data do pagamento"><${Input} type="date" value=${f.data} onInput=${set('data')} /><//>
      <${Field} label="Forma"><${Select} value=${f.forma} onChange=${set('forma')}>${['pix', 'dinheiro', 'cartao', 'transferencia', 'boleto', 'cheque', 'outro'].map((k) => html`<option value=${k}>${FORMAS[k]}</option>`)}<//><//>
      <${Field} label="Observação (opcional)"><${Input} value=${f.obs} onInput=${set('obs')} /><//>
    </div><//>`;
}

function LoteModal({ m, onClose, onFeito }) {
  const [f, setF] = useState({ data: todayISO(), forma: 'pix' });
  const salvar = async () => {
    const r = await tentar(() => api('/titulos/baixar-lote', { method: 'POST', body: { titulo_ids: m.ids, data: f.data, forma: f.forma } }));
    if (r) { toast(`${r.feitos} títulos baixados (${fmtBRL(r.total_centavos)}).`); onFeito(); }
  };
  return html`<${Modal} titulo=${`Dar baixa em ${m.ids.length} títulos`} sub=${`Total ${fmtBRL(m.soma)} — cada título é baixado pelo valor que falta pagar`} tam="sm" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" icon="check" onClick=${salvar}>Confirmar<//>`}>
    <div class="form-grid"><${Field} label="Data do pagamento"><${Input} type="date" value=${f.data} onInput=${(v) => setF({ ...f, data: v })} /><//>
      <${Field} label="Forma"><${Select} value=${f.forma} onChange=${(v) => setF({ ...f, forma: v })}>${['pix', 'dinheiro', 'cartao', 'transferencia'].map((k) => html`<option value=${k}>${FORMAS[k]}</option>`)}<//><//></div><//>`;
}

function InformarModal({ t, onClose, onFeito }) {
  const [f, setF] = useState({ valor: t.aberto_centavos, data: todayISO(), obs: '', arq: null });
  const enviar = async () => {
    const fd = new FormData();
    fd.set('valor_centavos', f.valor || ''); fd.set('data', f.data); fd.set('forma', 'pix'); fd.set('observacoes', f.obs);
    if (f.arq) fd.set('comprovante', f.arq);
    if (await tentar(() => api(`/titulos/${t.id}/informar-pagamento`, { method: 'POST', form: fd }), 'Pagamento informado! O administrador vai confirmar.')) onFeito();
  };
  return html`<${Modal} titulo="Cliente pagou?" sub=${`${t.cliente_nome} · ${fmtBRL(t.aberto_centavos)} em aberto`} tam="sm" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${enviar}>Enviar para confirmação<//>`}>
    <div class="alert info" style="margin-bottom:14px">Você avisa que o cliente pagou; o administrador confere o Pix e dá a baixa.</div>
    <div class="form-grid">
      <${Field} label="Valor que o cliente pagou"><${MoneyInput} value=${f.valor} onChange=${(v) => setF({ ...f, valor: v })} /><//>
      <${Field} label="Data do pagamento"><${Input} type="date" value=${f.data} onInput=${(v) => setF({ ...f, data: v })} /><//>
      <${Field} label="Comprovante (foto ou PDF)" cls="full"><input class="input" type="file" accept="application/pdf,image/*" style="padding-top:8px" onChange=${(e) => setF({ ...f, arq: e.target.files[0] || null })} /><//>
      <${Field} label="Observação (opcional)" cls="full"><${Input} value=${f.obs} onInput=${(v) => setF({ ...f, obs: v })} /><//>
    </div><//>`;
}

function DividaModal({ onClose, onFeito }) {
  const vs = useApi('/vendedores');
  const [f, setF] = useState({ cliente: null, vendedor_id: '', valor: null, vencimento: todayISO(), emissao: '', documento: '', descricao: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async () => {
    if (!f.cliente) return toast('Escolha o cliente (cadastre em Clientes se for novo).', 'erro');
    const body = { cliente_id: f.cliente.id, vendedor_id: f.vendedor_id || undefined, valor_centavos: f.valor, vencimento: f.vencimento, emissao: f.emissao || undefined, documento: f.documento, descricao: f.descricao };
    if (await tentar(() => api('/titulos', { method: 'POST', body }), 'Dívida lançada.')) onFeito();
  };
  return html`<${Modal} titulo="Lançar dívida" sub="Para registrar um valor que um cliente deve sem passar por uma venda (ex.: fiado antigo)" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>Lançar<//>`}>
    <div class="form-grid">
      <${Field} label="Cliente" cls="full"><${ClientePicker} valor=${f.cliente} onChange=${set('cliente')} permitirNovo=${false} /><//>
      <${Field} label="Valor devido"><${MoneyInput} value=${f.valor} onChange=${set('valor')} /><//>
      <${Field} label="Vencimento"><${Input} type="date" value=${f.vencimento} onInput=${set('vencimento')} /><//>
      <${Field} label="Vendedor (se vazio, usa o da carteira do cliente)"><${Select} value=${f.vendedor_id} onChange=${set('vendedor_id')}><option value="">—</option>${(vs.data || []).filter((v) => v.ativo).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//><//>
      <${Field} label="Data da compra (opcional)"><${Input} type="date" value=${f.emissao} onInput=${set('emissao')} /><//>
      <${Field} label="Nº do documento (opcional)"><${Input} value=${f.documento} onInput=${set('documento')} /><//>
      <${Field} label="Descrição (opcional)"><${Input} value=${f.descricao} onInput=${set('descricao')} /><//>
    </div><//>`;
}

function TituloDetalhe({ id, admin, onClose, onMudou, onBaixa }) {
  const { data, error, reload } = useApi(`/titulos/${id}`);
  if (error) return html`<${Modal} titulo="Título" onClose=${onClose}><${ErroCaixa} erro=${error} /><//>`;
  if (!data) return html`<${Modal} titulo="Título" onClose=${onClose}><${Spinner} /><//>`;
  const { titulo: t, baixas, cliente } = data;
  const estornar = async (b) => {
    if (!(await confirmar({ titulo: 'Desfazer esta baixa?', texto: `A baixa de ${fmtBRL(b.valor_centavos)} será desfeita e o valor volta a ficar em aberto.`, ok: 'Desfazer baixa', perigo: true }))) return;
    if (await tentar(() => api(`/baixas/${b.id}`, { method: 'DELETE' }), 'Baixa desfeita.')) { reload(); onMudou(); }
  };
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir este título?', texto: 'Só é possível se não tiver baixas.', ok: 'Excluir', perigo: true }))) return;
    if (await tentar(() => api(`/titulos/${id}`, { method: 'DELETE' }), 'Título excluído.')) { onMudou(); onClose(); }
  };
  return html`<${Modal} titulo=${cliente?.nome || 'Título'} sub=${`Vence em ${fmtBR(t.vencimento)}${t.documento ? ` · Doc ${t.documento}` : ''}${t.parcela ? ` · Parcela ${t.parcela}` : ''}`} onClose=${onClose}
    rodape=${html`${admin && html`<${Btn} tipo="danger" icon="trash" onClick=${excluir}>Excluir<//>`}${admin && t.aberto_centavos > 0 && html`<${Btn} tipo="primary" onClick=${() => { onClose(); onBaixa({ ...t, cliente_nome: cliente?.nome }); }}>Dar baixa<//>`}<${Btn} onClick=${onClose}>Fechar<//>`}>
    <div class="chips" style="margin-bottom:14px"><span class="chip">Valor <b>${fmtBRL(t.valor_centavos)}</b></span><span class="chip">Pago <b>${fmtBRL(t.pago_centavos)}</b></span><span class="chip">Em aberto <b>${fmtBRL(t.aberto_centavos)}</b></span><${StatusTitulo} t=${t} /></div>
    ${t.descricao && html`<div class="small muted" style="margin-bottom:10px">${t.descricao}</div>`}
    <div class="lbl" style="margin-bottom:6px">Pagamentos (baixas)</div>
    <${Tabela} linhas=${baixas} stack=${false} vazio=${html`<div class="muted small">Nenhum pagamento ainda.</div>`} cols=${[
      { t: 'Data', r: (b) => fmtBR(b.data) }, { t: 'Valor', num: true, r: (b) => html`<b>${fmtBRL(b.valor_centavos)}</b>` }, { t: 'Forma', r: (b) => FORMAS[b.forma] || b.forma },
      { t: 'Quem pagou', r: (b) => b.pagador_nome || '—' }, ...(admin ? [{ t: '', r: (b) => html`<${Btn} sm tipo="danger" onClick=${() => estornar(b)}>Desfazer<//>` }] : [])]} />
  <//>`;
}
