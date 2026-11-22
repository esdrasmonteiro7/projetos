// Painel: os números do mês em um olhar.
import { html, useState, useApi, qs, useMes, fmtBRL, fmtQtd, ymLabel, ymMonthName, FORMAS } from '../lib.js';
import { PageHead, MonthBar, Select, KPI, Icon, Spinner, ErroCaixa, Btn, Tabela, Empty, Badge } from '../ui.js';
import { ColunasMeses, BarrasH, COR, mesCurto } from '../charts.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Painel({ usuario }) {
  const admin = usuario.papel === 'admin';
  const [mes, setMes] = useMes();
  const [vend, setVend] = useState('');
  const { data: d, loading, error, reload } = useApi(`/dashboard${qs({ mes, vendedor_id: admin ? vend : undefined })}`);
  const vs = useApi(admin ? '/vendedores' : null);
  const meu = useApi(!admin ? '/vendedores' : null);
  if (error && !d) return html`<div class="page"><${ErroCaixa} erro=${error} onRetry=${reload} /></div>`;
  if (!d) return html`<div class="page"><${Spinner} /></div>`;

  const prox = cap(ymMonthName(d.proximo_mes));
  const comissao = !admin && meu.data?.[0]?.comissao_pct > 0 ? Math.round((d.recebido.total * meu.data[0].comissao_pct) / 100) : null;
  const filtroV = admin && vend ? vs.data?.find((v) => String(v.id) === String(vend)) : null;

  return html`<div class="page">
    <${PageHead} titulo=${admin ? 'Painel' : 'Meu painel'} sub=${`${ymLabel(mes)}${filtroV ? ` · ${filtroV.nome}` : admin ? ' · todos os vendedores' : ''}`}>
      <${MonthBar} mes=${mes} setMes=${setMes} />
      ${admin && html`<${Select} value=${vend} onChange=${setVend} aria-label="Filtrar por vendedor" style="min-width:190px"><option value="">Todos os vendedores</option>${(vs.data || []).filter((v) => v.ativo).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//>`}
      <${Btn} icon="file" href=${`#/relatorios`}>Gerar PDF<//>
    <//>

    <div class=${loading ? 'carregando' : ''}>
    <div class="stack">
      ${admin && (d.recebido.sem_baixa_qtd > 0 || d.pendentes.qtd > 0) && html`<div class="grid">
        ${d.recebido.sem_baixa_qtd > 0 && html`<div class="alert info"><${Icon} n="cash" /><div class="grow"><b>${d.recebido.sem_baixa_qtd} ${d.recebido.sem_baixa_qtd === 1 ? 'pagamento recebido' : 'pagamentos recebidos'}</b> (${fmtBRL(d.recebido.sem_baixa_total)}) ainda sem baixa em nenhuma dívida. <a href="#/recebimentos">Conciliar agora</a></div></div>`}
        ${d.pendentes.qtd > 0 && html`<div class="alert warn"><${Icon} n="clock" /><div class="grow"><b>${d.pendentes.qtd} ${d.pendentes.qtd === 1 ? 'pagamento informado' : 'pagamentos informados'}</b> por vendedores (${fmtBRL(d.pendentes.total)}) aguardando sua confirmação. <a href="#/recebimentos">Revisar</a></div></div>`}
      </div>`}

      <div class="kpis">
        <${KPI} cor=${COR.verde} rotulo="Vendido no mês" valor=${fmtBRL(d.vendido.total)} sub=${`${d.vendido.qtd} ${d.vendido.qtd === 1 ? 'venda' : 'vendas'}`} sub2=${d.vendido.qtd ? `Ticket médio ${fmtBRL(d.vendido.ticket_medio)}` : 'Nenhuma venda neste mês'} href="#/vendas" />
        <${KPI} cor=${COR.violeta} rotulo="Recebido no mês" valor=${fmtBRL(d.recebido.total)} sub=${`${d.recebido.qtd} ${d.recebido.qtd === 1 ? 'pagamento' : 'pagamentos'}`} sub2=${d.recebido.pix > 0 ? `${fmtBRL(d.recebido.pix)} em Pix` : ''} href="#/recebimentos" />
        <${KPI} cor=${COR.laranja} rotulo="Em aberto (a receber)" valor=${fmtBRL(d.em_aberto.total)} sub=${`${d.em_aberto.clientes} ${d.em_aberto.clientes === 1 ? 'cliente devendo' : 'clientes devendo'}`} sub2=${`${d.em_aberto.qtd} títulos`} href="#/receber" />
        <${KPI} alerta=${d.vencido.total > 0} cor="#b3261e" rotulo="Vencido (atrasado)" valor=${html`<span class=${d.vencido.total > 0 ? 'red' : ''}>${fmtBRL(d.vencido.total)}</span>`} sub=${d.vencido.total > 0 ? `${d.vencido.clientes} ${d.vencido.clientes === 1 ? 'cliente' : 'clientes'} em atraso` : 'Nada vencido'} sub2=${d.vencido.qtd ? `${d.vencido.qtd} títulos` : ''} href="#/receber?status=vencidos" />
        <${KPI} cor=${COR.azul} rotulo=${`A receber em ${prox}`} valor=${fmtBRL(d.a_receber_proximo_mes.total)} sub=${`${d.a_receber_proximo_mes.qtd} ${d.a_receber_proximo_mes.qtd === 1 ? 'título vence' : 'títulos vencem'} no mês seguinte`} sub2=${`Vence em ${ymMonthName(mes)}: ${fmtBRL(d.vence_no_mes.total)}`} href=${`#/receber?mes=${d.proximo_mes}`} />
        <${KPI} cor=${COR.ambar} rotulo="Retiradas no mês" valor=${`${fmtQtd(d.retiradas.unidades)} un`} sub=${`em ${d.retiradas.qtd} ${d.retiradas.qtd === 1 ? 'retirada' : 'retiradas'}${d.retiradas.valor > 0 ? ` · ${fmtBRL(d.retiradas.valor)}` : ''}`} sub2=${d.retiradas.devolvidas > 0 ? `${fmtQtd(d.retiradas.devolvidas)} un devolvidas` : ''} href="#/deposito" />
        ${comissao !== null && html`<${KPI} cor=${COR.verde} rotulo="Minha comissão estimada" valor=${fmtBRL(comissao)} sub=${`${meu.data[0].comissao_pct}% sobre o que foi recebido no mês`} />`}
      </div>

      <div class="grid c-main">
        <div class="card pad"><div class="card-t">Vendido e recebido</div><div class="card-s">Últimos 6 meses</div><div style="margin-top:10px"><${ColunasMeses} dados=${d.meses}
          series=${[{ k: 'vendido', nome: 'Vendido', cor: COR.verde }, { k: 'recebido', nome: 'Recebido', cor: COR.violeta }]} /></div></div>
        <div class="card pad"><div class="card-t">Previsão de recebimento</div><div class="card-s">O que vence em cada mês (só o que ainda está em aberto)</div>
          <div style="margin-top:14px"><${BarrasH} itens=${d.previsao.map((p, i) => ({ rotulo: `${cap(mesCurto(p.ym))}/${p.ym.slice(2, 4)}`, valor: p.total, texto: p.total > 0 ? fmtBRL(p.total) : '—', destaque: i === 0 }))} /></div></div>
      </div>

      ${admin && html`<div class="card"><div class="card-h"><div><div class="card-t">Por vendedor</div><div class="card-s">Vendido e recebido em ${ymLabel(mes)} · em aberto é o total atual</div></div></div>
        <div style="padding:8px 4px 4px"><${Tabela} linhas=${d.por_vendedor} chave=${(v) => v.id ?? 'sem'}
          vazio=${html`<${Empty} icon="users" titulo="Ainda não há vendedores com movimento">Cadastre vendedores e lance vendas ou importe arquivos.<//>`}
          cols=${[
            { t: 'Vendedor', r: (v) => html`<b>${v.nome}</b>${!v.ativo && html` <${Badge}>inativo<//>`}` },
            { t: 'Vendido', num: true, r: (v) => fmtBRL(v.vendido) },
            { t: 'Recebido', num: true, r: (v) => fmtBRL(v.recebido) },
            { t: 'Em aberto', num: true, r: (v) => fmtBRL(v.em_aberto) },
            { t: 'Vencido', num: true, r: (v) => v.vencido > 0 ? html`<span class="red semi">${fmtBRL(v.vencido)}</span>` : '—' },
            { t: 'Retiradas', num: true, r: (v) => v.retiradas_un ? `${fmtQtd(v.retiradas_un)} un` : '—' },
            { t: 'Comissão', num: true, r: (v) => v.comissao_pct > 0 ? html`${fmtBRL(v.comissao_centavos)} <span class="muted tiny">(${v.comissao_pct}%)</span>` : '—' },
          ]} /></div></div>`}

      <div class=${`grid ${admin && d.deposito ? 'c2' : ''}`}>
        <div class="card"><div class="card-h"><div><div class="card-t">Maiores devedores</div><div class="card-s">Quem mais deve hoje</div></div><${Btn} sm href="#/receber">Ver todos<//></div>
          <div style="padding:8px 4px 4px">${d.top_devedores.length ? html`<${Tabela} linhas=${d.top_devedores} stack=${false} cols=${[
            { t: 'Cliente', r: (c) => html`<b>${c.nome}</b>${c.vencido > 0 ? html`<span class="sub-l red">${fmtBRL(c.vencido)} vencido</span>` : ''}` },
            { t: 'Em aberto', num: true, r: (c) => html`<b>${fmtBRL(c.aberto)}</b>` },
          ]} />` : html`<${Empty} icon="check" titulo="Ninguém devendo">Todas as dívidas estão pagas.<//>`}</div></div>

        ${admin && d.deposito && html`<div class="card pad"><div class="row between"><div><div class="card-t">Depósito em ${ymLabel(mes)}</div><div class="card-s">O que entrou, saiu e foi produzido</div></div><${Btn} sm href="#/deposito">Abrir<//></div>
          <div class="grid c2" style="margin-top:14px;gap:10px">
            ${[['Entrou', d.deposito.entradas, COR.verde], ['Produzido', d.deposito.produzido, COR.azul], ['Saiu (vendas/perdas)', d.deposito.vendas_saidas + d.deposito.perdas, COR.laranja], ['Retiradas', d.deposito.retiradas, COR.violeta]].map(([r, v, c]) => html`<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px"><div class="kpi-l"><span class="kpi-dot" style=${{ background: c }}></span>${r}</div><div style="font-size:21px;font-weight:800;margin-top:4px">${fmtQtd(v)}</div></div>`)}</div>
          <div style="margin-top:16px"><div class="row between small"><b>Produção planejada × produzida</b><span class="muted">${fmtQtd(d.deposito.producao.produzido_do_plano)} de ${fmtQtd(d.deposito.producao.planejado)}</span></div>
            <div class="track o" style="margin-top:8px"><div class="fill" style=${{ width: `${d.deposito.producao.planejado ? Math.min(100, (d.deposito.producao.produzido_do_plano / d.deposito.producao.planejado) * 100) : 0}%` }}></div></div>
            <div class="small" style="margin-top:6px">${d.deposito.producao.nao_produzido > 0 ? html`<span class="red semi">${fmtQtd(d.deposito.producao.nao_produzido)} ainda não produzidos</span>` : html`<span class="muted">${d.deposito.producao.planejado ? 'Tudo que foi planejado já foi produzido.' : 'Sem produção planejada neste mês.'}</span>`}</div></div>
          ${d.deposito.estoque.abaixo_minimo.length > 0 && html`<div class="alert warn" style="margin-top:14px"><${Icon} n="alert" /><div>${d.deposito.estoque.abaixo_minimo.length} ${d.deposito.estoque.abaixo_minimo.length === 1 ? 'produto abaixo' : 'produtos abaixo'} do estoque mínimo: ${d.deposito.estoque.abaixo_minimo.slice(0, 3).map((p) => p.nome).join(', ')}${d.deposito.estoque.abaixo_minimo.length > 3 ? '…' : ''}</div></div>`}
        </div>`}
      </div>
    </div></div></div>`;
}
