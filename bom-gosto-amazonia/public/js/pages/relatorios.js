// Relatório em PDF (bonito e direto) e exportação de planilhas.
import { html, useState, useApi, qs, useMes, ymLabel, toast, tentar } from '../lib.js';
import { PageHead, MonthBar, Select, Btn, Check, Icon, Field } from '../ui.js';

export default function Relatorios({ usuario }) {
  const admin = usuario.papel === 'admin';
  const [mes, setMes] = useMes();
  const [vend, setVend] = useState('');
  const [porVendedor, setPorVendedor] = useState(true);
  const [deposito, setDeposito] = useState(true);
  const vs = useApi(admin ? '/vendedores' : null);
  const completo = admin && !vend;
  const params = { mes, vendedor_id: admin ? vend : undefined, vendedores: completo && porVendedor ? 1 : 0, deposito: completo && deposito ? 1 : 0 };
  const url = `/api/relatorios/resumo.pdf${qs(params)}`;
  const nomeVend = vend ? vs.data?.find((v) => String(v.id) === String(vend))?.nome : null;

  const compartilhar = async () => {
    await tentar(async () => {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Não consegui gerar o PDF.');
      const file = new File([await r.blob()], `resumo-${mes}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `Resumo ${ymLabel(mes)}`, text: 'Resumo do mês — Bom Gosto da Amazônia' });
      else toast('Este navegador não compartilha arquivos direto. Use "Baixar PDF" e envie pelo WhatsApp.', 'aviso');
    });
  };

  return html`<div class="page">
    <${PageHead} titulo=${admin ? 'Relatório em PDF' : 'Meu relatório'} sub="Um resumo visual e direto: quanto vendeu, quanto está em aberto, quanto vai receber no mês seguinte e quantas retiradas">
      <${MonthBar} mes=${mes} setMes=${setMes} />
    <//>
    <div class="grid c-main" style="align-items:start">
      <div class="stack">
        <div class="card pad stack" style="gap:16px">
          <div class="card-t">Montar relatório</div>
          ${admin && html`<${Field} label="De quem?"><${Select} value=${vend} onChange=${setVend}><option value="">Todos os vendedores (relatório geral)</option>${(vs.data || []).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//><//>`}
          ${completo && html`<div class="stack" style="gap:10px"><${Check} checked=${porVendedor} onChange=${setPorVendedor}>Incluir página "Por vendedor" e maiores devedores<//><${Check} checked=${deposito} onChange=${setDeposito}>Incluir página do Depósito (entrou, saiu, produzido, não produzido)<//></div>`}
          <div class="small muted">${completo ? 'A 1ª página traz os 4 números principais: vendido, em aberto, a receber no mês seguinte e retiradas.' : `Relatório de ${nomeVend || 'seus números'} — 1 página.`}</div>
          <div class="stack" style="gap:10px">
            <${Btn} tipo="primary" icon="file" href=${url} target="_blank">Abrir PDF<//>
            <${Btn} icon="download" href=${`${url}&baixar=1`} download>Baixar PDF<//>
            <${Btn} icon="share" onClick=${compartilhar}>Compartilhar (WhatsApp…)<//>
          </div>
        </div>
        <div class="card pad stack" style="gap:12px">
          <div><div class="card-t">Planilhas para Excel</div><div class="card-s">Abrem direto no Excel / Google Planilhas</div></div>
          <div class="stack" style="gap:8px">
            <${Btn} icon="sheet" href=${`/api/exportar/vendas.csv${qs({ mes, vendedor_id: admin ? vend : undefined })}`}>Vendas de ${ymLabel(mes)}<//>
            <${Btn} icon="sheet" href=${`/api/exportar/a-receber.csv${qs({ status: 'abertos', vendedor_id: admin ? vend : undefined })}`}>Contas a receber (em aberto)<//>
            <${Btn} icon="sheet" href=${`/api/exportar/recebimentos.csv${qs({ mes })}`}>Recebimentos de ${ymLabel(mes)}<//>
            <${Btn} icon="sheet" href=${`/api/exportar/clientes.csv${qs({ vendedor_id: admin ? vend : undefined })}`}>Clientes e saldos<//>
            ${admin && html`<${Btn} icon="sheet" href=${`/api/exportar/estoque.csv${qs({ mes })}`}>Movimentação do depósito<//>`}
          </div>
        </div>
      </div>
      <div class="card pad"><div class="card-t" style="margin-bottom:10px">Pré-visualização</div>
        <iframe class="pdf-frame" title="Pré-visualização do PDF" key=${url} src=${`${url}#toolbar=0&navpanes=0`}></iframe>
        <div class="small muted" style="display:none" id="prev-aviso"></div>
        <div class="muted small" style="margin-top:8px">Se a pré-visualização não aparecer no seu navegador, use "Abrir PDF".</div></div>
    </div>
  </div>`;
}
