// Depósito: o que entrou, saiu, foi produzido e retirado pelos vendedores.
import {
  html, useState, useEffect, api, qs, useApi, useMes, fmtBRL, fmtBR, fmtQtd, ymLabel, todayISO, TIPOS_MOV, tentar, toast, confirmar,
} from '../lib.js';
import {
  PageHead, MonthBar, Select, Btn, Tabela, Pager, Empty, Modal, Field, Input, MoneyInput, Tabs, Icon, ErroCaixa, Spinner, Badge, KPI,
} from '../ui.js';
import { COR } from '../charts.js';

const COR_TIPO = { entrada: 'ok', producao: 'info', devolucao: 'ok', ajuste: 'warn', saida: 'bad', venda: 'bad', retirada: 'violet', perda: 'bad' };
const STATUS_ORDEM = { concluida: ['ok', 'Concluída'], parcial: ['info', 'Em andamento'], planejada: ['mute', 'Planejada'], nao_produzida: ['bad', 'Não produzida'], cancelada: ['mute', 'Cancelada'] };

export default function Deposito({ usuario }) {
  const admin = usuario.papel === 'admin';
  const [aba, setAba] = useState(admin ? 'geral' : 'retiradas');
  const [mes, setMes] = useMes();
  const [modal, setModal] = useState(null);
  const [vendFiltro, setVendFiltro] = useState('');
  const [prodFiltro, setProdFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [mes, vendFiltro, prodFiltro, tipoFiltro, aba]);

  const resumo = useApi(admin && aba === 'geral' ? `/estoque/resumo${qs({ mes })}` : null);
  const movs = useApi(aba === 'movimentos' || (!admin && aba === 'retiradas') ? `/estoque/movimentos${qs({ mes, vendedor_id: vendFiltro, produto_id: prodFiltro, tipo: tipoFiltro, pagina, limite: 100 })}` : null);
  const ret = useApi(aba === 'retiradas' ? `/estoque/retiradas${qs({ mes })}` : null);
  const prod = useApi(admin && aba === 'producao' ? `/producao${qs({ mes })}` : null);
  const produtos = useApi(admin ? '/produtos' : null);
  const vs = useApi(admin ? '/vendedores' : null);
  const recarregar = () => { resumo.reload(); movs.reload(); ret.reload(); prod.reload(); produtos.reload(); };

  const excluirMov = async (m) => {
    if (!(await confirmar({ titulo: 'Excluir esta movimentação?', texto: `${TIPOS_MOV[m.tipo]} de ${fmtQtd(Math.abs(m.quantidade))} ${m.unidade} — ${m.produto_nome}`, ok: 'Excluir', perigo: true }))) return;
    if (await tentar(() => api(`/estoque/movimentos/${m.id}`, { method: 'DELETE' }), 'Movimentação excluída.')) recarregar();
  };

  return html`<div class="page">
    <${PageHead} titulo=${admin ? 'Depósito e produção' : 'Minhas retiradas'} sub=${admin ? 'O que entrou, o que saiu, o que foi produzido e o que não foi' : 'Mercadoria que você retirou do depósito'}>
      <${MonthBar} mes=${mes} setMes=${setMes} />
      ${admin && html`<${Btn} icon="download" href=${`/api/exportar/estoque.csv${qs({ mes })}`}>Planilha<//><${Btn} tipo="primary" icon="plus" onClick=${() => setModal({ tipo: 'mov' })}>Nova movimentação<//>`}
    <//>
    ${admin && html`<${Tabs} valor=${aba} onChange=${setAba} abas=${[['geral', 'Visão geral'], ['movimentos', 'Movimentações'], ['retiradas', 'Retiradas dos vendedores'], ['producao', 'Produção']]} />`}

    ${aba === 'geral' && admin && (resumo.error && !resumo.data ? html`<${ErroCaixa} erro=${resumo.error} onRetry=${resumo.reload} />` : !resumo.data ? html`<${Spinner} />` : html`<${VisaoGeral} d=${resumo.data} mes=${mes} loading=${resumo.loading} />`)}

    ${(aba === 'movimentos' || (!admin && aba === 'retiradas')) && html`<div class="card">
      ${admin && html`<div class="pad-s row" style="border-bottom:1px solid var(--line)">
        <${Select} sm value=${prodFiltro} onChange=${setProdFiltro} style="max-width:230px"><option value="">Todos os produtos</option>${(produtos.data || []).map((p) => html`<option value=${p.id}>${p.nome}</option>`)}<//>
        <${Select} sm value=${tipoFiltro} onChange=${setTipoFiltro} style="max-width:180px"><option value="">Todos os tipos</option>${Object.entries(TIPOS_MOV).map(([k, v]) => html`<option value=${k}>${v}</option>`)}<//>
        <${Select} sm value=${vendFiltro} onChange=${setVendFiltro} style="max-width:210px"><option value="">Todos os vendedores</option>${(vs.data || []).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//></div>`}
      ${movs.error && !movs.data ? html`<div class="pad"><${ErroCaixa} erro=${movs.error} onRetry=${movs.reload} /></div>` : !movs.data ? html`<${Spinner} />` : html`
        <div class=${movs.loading ? 'carregando' : ''}><${Tabela} linhas=${movs.data.itens} vazio=${html`<${Empty} icon="box" titulo="Nenhuma movimentação neste mês">Registre entradas, saídas, produção e retiradas.<//>`}
          cols=${[
            { t: 'Data', r: (m) => fmtBR(m.data), cls: 'nowrap' }, { t: 'Produto', r: (m) => html`<b>${m.produto_nome}</b>` },
            { t: 'Tipo', r: (m) => html`<${Badge} tipo=${COR_TIPO[m.tipo]}>${TIPOS_MOV[m.tipo]}<//>` },
            { t: 'Quantidade', num: true, r: (m) => html`<b class=${m.quantidade < 0 ? 'red' : 'ok'}>${m.quantidade > 0 ? '+' : ''}${fmtQtd(m.quantidade)}</b> <span class="muted small">${m.unidade}</span>` },
            { t: 'Vendedor', r: (m) => m.vendedor_nome || '—' }, { t: 'Observação', r: (m) => html`<span class="muted small">${m.observacoes || ''}</span>`, cls: 'hide-m' },
            ...(admin ? [{ t: '', acoes: true, r: (m) => html`<${Btn} sm tipo="ghost" icon="trash" title="Excluir" onClick=${() => excluirMov(m)}>${''}<//>` }] : []),
          ]} /></div>
        <${Pager} pagina=${pagina} limite=${100} total=${movs.data.total} onPage=${setPagina} />`}</div>`}

    ${aba === 'retiradas' && (ret.error && !ret.data ? html`<${ErroCaixa} erro=${ret.error} onRetry=${ret.reload} />` : !ret.data ? html`<${Spinner} />` : html`<div class="card" style=${!admin ? 'margin-top:16px' : ''}>
      <div class="card-h"><div><div class="card-t">Retiradas por vendedor — ${ymLabel(mes)}</div><div class="card-s">"Em mãos" é tudo que o vendedor retirou e ainda não devolveu (somando todos os meses)</div></div>
        ${admin && html`<${Btn} tipo="primary" icon="plus" onClick=${() => setModal({ tipo: 'mov', padrao: 'retirada' })}>Nova retirada<//>`}</div>
      <div style="padding:8px 4px 4px"><${Tabela} linhas=${ret.data.itens} chave=${(r) => r.vendedor_id} vazio=${html`<${Empty} icon="users" titulo="Sem retiradas">Nenhum vendedor retirou mercadoria neste mês.<//>`} cols=${[
        { t: 'Vendedor', r: (r) => html`<b>${r.nome}</b>` }, { t: 'Retiradas', num: true, r: (r) => r.retiradas_qtd }, { t: 'Unidades retiradas', num: true, r: (r) => html`<b>${fmtQtd(r.retirado_mes)}</b>` },
        { t: 'Valor da mercadoria', num: true, r: (r) => fmtBRL(r.valor_mes_centavos) }, { t: 'Devolvido', num: true, r: (r) => r.devolvido_mes ? fmtQtd(r.devolvido_mes) : '—' },
        { t: 'Em mãos (total)', num: true, r: (r) => html`<b>${fmtQtd(r.em_maos)}</b>` },
        ...(admin ? [{ t: '', acoes: true, r: (r) => html`<div class="row gap-s nw"><${Btn} sm onClick=${() => setModal({ tipo: 'mov', padrao: 'retirada', vendedor: r.vendedor_id })}>Retirada<//><${Btn} sm onClick=${() => setModal({ tipo: 'mov', padrao: 'devolucao', vendedor: r.vendedor_id })}>Devolução<//><${Btn} sm tipo="ghost" onClick=${() => { setVendFiltro(String(r.vendedor_id)); setAba('movimentos'); }}>Ver detalhes<//></div>` }] : []),
      ]} /></div></div>`)}

    ${aba === 'producao' && admin && (prod.error && !prod.data ? html`<${ErroCaixa} erro=${prod.error} onRetry=${prod.reload} />` : !prod.data ? html`<${Spinner} />` : html`<div class="card">
      <div class="card-h"><div><div class="card-t">Produção planejada × produzida — ${ymLabel(mes)}</div><div class="card-s">Planeje o que vai fabricar e registre o que realmente foi produzido. O que faltar aparece como "não produzido".</div></div>
        <${Btn} tipo="primary" icon="plus" onClick=${() => setModal({ tipo: 'plano' })}>Planejar produção<//></div>
      <div style="padding:8px 4px 4px"><${Tabela} linhas=${prod.data.itens} vazio=${html`<${Empty} icon="box" titulo="Nenhuma produção planejada neste mês">Clique em "Planejar produção" para começar.<//>`} cols=${[
        { t: 'Data', r: (o) => fmtBR(o.data), cls: 'nowrap' }, { t: 'Produto', r: (o) => html`<b>${o.produto_nome}</b>${o.observacoes ? html`<span class="sub-l">${o.observacoes}</span>` : ''}` },
        { t: 'Planejado', num: true, r: (o) => fmtQtd(o.planejado) }, { t: 'Produzido', num: true, r: (o) => html`<b>${fmtQtd(o.produzido)}</b>` },
        { t: 'Progresso', r: (o) => html`<div class="track o" style="min-width:90px"><div class="fill" style=${{ width: `${Math.min(100, (o.produzido / o.planejado) * 100)}%` }}></div></div>` },
        { t: 'Não produzido', num: true, r: (o) => o.faltou > 0 ? html`<span class="red semi">${fmtQtd(o.faltou)}</span>` : '—' },
        { t: 'Situação', r: (o) => html`<${Badge} tipo=${STATUS_ORDEM[o.status][0]}>${STATUS_ORDEM[o.status][1]}<//>` },
        { t: '', acoes: true, r: (o) => o.cancelada ? '' : html`<div class="row gap-s nw"><${Btn} sm tipo=${o.faltou > 0 ? 'primary' : undefined} onClick=${() => setModal({ tipo: 'produzir', o })}>Registrar produção<//>
          <${Btn} sm tipo="ghost" icon="x" title="Cancelar plano" onClick=${async () => { if (await confirmar({ titulo: 'Cancelar esta produção planejada?', texto: 'O que já foi produzido continua no estoque.', ok: 'Cancelar plano', perigo: true }) && await tentar(() => api(`/producao/${o.id}/cancelar`, { method: 'POST' }), 'Plano cancelado.')) recarregar(); }}>${''}<//></div>` },
      ]} /></div></div>`)}

    ${modal?.tipo === 'mov' && html`<${MovModal} padrao=${modal.padrao} vendedorId=${modal.vendedor} produtos=${produtos.data || []} vendedores=${vs.data || []} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); recarregar(); }} />`}
    ${modal?.tipo === 'plano' && html`<${PlanoModal} produtos=${produtos.data || []} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); recarregar(); }} />`}
    ${modal?.tipo === 'produzir' && html`<${ProduzirModal} o=${modal.o} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); recarregar(); }} />`}
  </div>`;
}

function VisaoGeral({ d, mes, loading }) {
  const r = d.resumo;
  const p = r.producao;
  return html`<div class=${`stack ${loading ? 'carregando' : ''}`}>
    <div class="kpis">
      <${KPI} cor=${COR.verde} rotulo="Entrou" valor=${fmtQtd(r.entradas)} sub="compras, devoluções e ajustes (+)" />
      <${KPI} cor=${COR.azul} rotulo="Produzido" valor=${fmtQtd(r.produzido)} sub=${`${fmtQtd(p.produzido_do_plano)} dentro do que foi planejado`} />
      <${KPI} cor=${COR.marca} rotulo="Saiu" valor=${fmtQtd(r.vendas_saidas + r.perdas)} sub=${`${fmtQtd(r.vendas_saidas)} vendas/saídas · ${fmtQtd(r.perdas)} perdas`} />
      <${KPI} cor=${COR.violeta} rotulo="Retiradas pelos vendedores" valor=${fmtQtd(r.retiradas)} sub="levadas para vender" />
      <${KPI} cor="#5d0710" rotulo="Estoque atual" valor=${`${fmtQtd(r.estoque.total_unidades)} un`} sub=${`Valor ${fmtBRL(r.estoque.valor_centavos)}`} />
      <${KPI} alerta=${p.nao_produzido > 0} cor=${COR.alerta} rotulo="Não produzido (planejado)" valor=${html`<span class=${p.nao_produzido > 0 ? 'red' : ''}>${fmtQtd(p.nao_produzido)}</span>`} sub=${p.planejado ? `de ${fmtQtd(p.planejado)} planejados em ${p.ordens} ordens` : 'Nada planejado neste mês'} />
    </div>
    ${r.estoque.abaixo_minimo.length > 0 && html`<div class="alert warn"><${Icon} n="alert" /><div><b>Abaixo do estoque mínimo:</b> ${r.estoque.abaixo_minimo.map((a) => `${a.nome} (${fmtQtd(a.saldo)}/${fmtQtd(a.minimo)})`).join(' · ')}</div></div>`}
    <div class="card"><div class="card-h"><div><div class="card-t">Movimento por produto — ${ymLabel(mes)}</div><div class="card-s">Saldo é o estoque atual (todos os meses)</div></div></div>
      <div style="padding:8px 4px 4px"><${Tabela} linhas=${d.por_produto} cols=${[
        { t: 'Produto', r: (x) => html`<b>${x.nome}</b>` }, { t: 'Entrou', num: true, r: (x) => x.entrou ? fmtQtd(x.entrou) : '—' }, { t: 'Produzido', num: true, r: (x) => x.produzido ? fmtQtd(x.produzido) : '—' },
        { t: 'Planejado', num: true, r: (x) => x.planejado ? fmtQtd(x.planejado) : '—' }, { t: 'Saiu', num: true, r: (x) => x.saiu ? fmtQtd(x.saiu) : '—' },
        { t: 'Retirado', num: true, r: (x) => x.retirado ? fmtQtd(x.retirado) : '—' }, { t: 'Perdido', num: true, r: (x) => x.perdido ? fmtQtd(x.perdido) : '—' },
        { t: 'Saldo', num: true, r: (x) => html`<b class=${x.saldo < 0 || (x.estoque_minimo > 0 && x.saldo < x.estoque_minimo) ? 'red' : ''}>${fmtQtd(x.saldo)} ${x.unidade}</b>` },
      ]} vazio=${html`<${Empty} icon="box" titulo="Nenhum produto cadastrado">Cadastre produtos em Cadastros → Produtos.<//>`} /></div></div></div>`;
}

function MovModal({ padrao, vendedorId, produtos, vendedores, onClose, onFeito }) {
  const [f, setF] = useState({ tipo: padrao || 'entrada', produto_id: '', quantidade: '', sinal: '+', data: todayISO(), vendedor_id: vendedorId || '', obs: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const precisaVendedor = f.tipo === 'retirada' || f.tipo === 'devolucao';
  const salvar = async () => {
    if (!f.produto_id) return toast('Escolha o produto.', 'erro');
    const r = await tentar(() => api('/estoque/movimentos', { method: 'POST', body: { ...f, vendedor_id: precisaVendedor ? f.vendedor_id || undefined : undefined } }));
    if (r) { toast(r.aviso || 'Movimentação registrada!', r.aviso ? 'aviso' : 'ok'); onFeito(); }
  };
  return html`<${Modal} titulo="Nova movimentação" sub="Registre o que entrou, saiu, foi produzido ou retirado" tam="sm" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>Registrar<//>`}>
    <div class="form-grid">
      <${Field} label="Tipo" cls="full"><${Select} value=${f.tipo} onChange=${set('tipo')}>${Object.entries(TIPOS_MOV).map(([k, v]) => html`<option value=${k}>${{ entrada: 'Entrada (compra / recebimento)', producao: 'Produção (fabricado)', devolucao: 'Devolução (volta ao depósito)', ajuste: 'Ajuste de estoque', saida: 'Saída', venda: 'Saída por venda', retirada: 'Retirada por vendedor', perda: 'Perda / avaria / vencido' }[k] || v}</option>`)}<//><//>
      <${Field} label="Produto" cls="full"><${Select} value=${f.produto_id} onChange=${set('produto_id')}><option value="">Escolha…</option>${produtos.map((p) => html`<option value=${p.id}>${p.nome} (estoque ${fmtQtd(p.saldo)})</option>`)}<//><//>
      <${Field} label="Quantidade"><${Input} type="number" min="0" step="any" inputmode="decimal" value=${f.quantidade} onInput=${set('quantidade')} /><//>
      ${f.tipo === 'ajuste' ? html`<${Field} label="Sentido"><${Select} value=${f.sinal} onChange=${set('sinal')}><option value="+">Aumentar o estoque (+)</option><option value="-">Diminuir o estoque (−)</option><//><//>` : html`<${Field} label="Data"><${Input} type="date" value=${f.data} onInput=${set('data')} /><//>`}
      ${f.tipo === 'ajuste' && html`<${Field} label="Data"><${Input} type="date" value=${f.data} onInput=${set('data')} /><//>`}
      ${precisaVendedor && html`<${Field} label="Vendedor" cls="full"><${Select} value=${f.vendedor_id} onChange=${set('vendedor_id')}><option value="">Escolha…</option>${vendedores.filter((v) => v.ativo).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//><//>`}
      <${Field} label="Observação (opcional)" cls="full"><${Input} value=${f.obs} onInput=${(v) => set('obs')(v)} /><//>
    </div><//>`;
}

function PlanoModal({ produtos, onClose, onFeito }) {
  const [f, setF] = useState({ produto_id: '', planejado: '', data: todayISO(), observacoes: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async () => { if (await tentar(() => api('/producao', { method: 'POST', body: f }), 'Produção planejada!')) onFeito(); };
  return html`<${Modal} titulo="Planejar produção" tam="sm" onClose=${onClose} rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>Planejar<//>`}>
    <div class="form-grid"><${Field} label="Produto" cls="full"><${Select} value=${f.produto_id} onChange=${set('produto_id')}><option value="">Escolha…</option>${produtos.map((p) => html`<option value=${p.id}>${p.nome}</option>`)}<//><//>
      <${Field} label="Quantidade a produzir"><${Input} type="number" min="0" step="any" value=${f.planejado} onInput=${set('planejado')} /><//>
      <${Field} label="Data prevista"><${Input} type="date" value=${f.data} onInput=${set('data')} /><//>
      <${Field} label="Observação (opcional)" cls="full"><${Input} value=${f.observacoes} onInput=${set('observacoes')} /><//></div><//>`;
}

function ProduzirModal({ o, onClose, onFeito }) {
  const [f, setF] = useState({ quantidade: o.faltou || '', data: todayISO(), observacoes: '' });
  const salvar = async () => { if (await tentar(() => api(`/producao/${o.id}/produzir`, { method: 'POST', body: f }), 'Produção registrada!')) onFeito(); };
  return html`<${Modal} titulo="Registrar produção realizada" sub=${`${o.produto_nome} · planejado ${fmtQtd(o.planejado)} · já produzido ${fmtQtd(o.produzido)}`} tam="sm" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>Registrar<//>`}>
    <div class="form-grid"><${Field} label="Quantidade produzida"><${Input} type="number" min="0" step="any" value=${f.quantidade} onInput=${(v) => setF({ ...f, quantidade: v })} /><//>
      <${Field} label="Data"><${Input} type="date" value=${f.data} onInput=${(v) => setF({ ...f, data: v })} /><//></div>
    <div class="hint" style="margin-top:10px">Isso soma ao estoque automaticamente.</div><//>`;
}
