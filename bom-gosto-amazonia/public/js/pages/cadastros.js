// Cadastros: vendedores, clientes e produtos.
import {
  html, useState, useEffect, api, qs, useApi, useDebounced, fmtBRL, fmtBR, fmtQtd, FORMAS, fmtDataHora, tentar, toast, confirmar,
} from '../lib.js';
import {
  PageHead, Select, SearchBox, Btn, Tabela, Pager, Empty, Modal, Field, Input, MoneyInput, Check, Tabs, Icon, ErroCaixa, Spinner, Badge, StatusTitulo,
} from '../ui.js';

// ======================================================== VENDEDORES
export function Vendedores() {
  const { data, error, reload } = useApi('/vendedores');
  const [modal, setModal] = useState(null);
  const alternar = async (v) => {
    const ativar = !v.ativo;
    if (!ativar && !(await confirmar({ titulo: `Desativar ${v.nome}?`, texto: 'O vendedor deixa de poder entrar no painel e some das listas de escolha. O histórico continua.', ok: 'Desativar', perigo: true }))) return;
    if (await tentar(() => api(`/vendedores/${v.id}`, { method: 'PUT', body: { ativo: ativar } }), ativar ? 'Vendedor reativado.' : 'Vendedor desativado.')) reload();
  };
  return html`<div class="page">
    <${PageHead} titulo="Vendedores" sub="Quem vende para a Bom Gosto da Amazônia. Cada vendedor pode ter um acesso próprio e só enxerga os dados dele."><${Btn} tipo="primary" icon="plus" onClick=${() => setModal({})}>Novo vendedor<//><//>
    ${error && !data ? html`<${ErroCaixa} erro=${error} onRetry=${reload} />` : !data ? html`<${Spinner} />` : html`<div class="card"><${Tabela} linhas=${data} rowCls=${(v) => (v.ativo ? '' : 'dim')} onRow=${(v) => setModal(v)}
      vazio=${html`<${Empty} icon="users" titulo="Nenhum vendedor cadastrado">Cadastre o primeiro vendedor para separar vendas, dívidas e retiradas por pessoa.<//>`} cols=${[
        { t: 'Nome', r: (v) => html`<b>${v.nome}</b>${v.telefone ? html`<span class="sub-l">${v.telefone}</span>` : ''}` },
        { t: 'Acesso ao painel', r: (v) => v.usuario_id ? html`<${Badge} tipo=${v.usuario_ativo ? 'ok' : 'mute'}>${v.usuario_email}<//>` : html`<${Badge}>sem acesso<//>` },
        { t: 'Clientes', num: true, r: (v) => v.clientes }, { t: 'Em aberto', num: true, r: (v) => fmtBRL(v.em_aberto_centavos) },
        { t: 'Vencido', num: true, r: (v) => v.vencido_centavos > 0 ? html`<span class="red semi">${fmtBRL(v.vencido_centavos)}</span>` : '—' },
        { t: 'Comissão', num: true, r: (v) => `${v.comissao_pct}%` }, { t: 'Situação', r: (v) => html`<${Badge} tipo=${v.ativo ? 'ok' : 'mute'}>${v.ativo ? 'Ativo' : 'Inativo'}<//>` },
        { t: '', acoes: true, r: (v) => html`<${Btn} sm tipo="ghost" onClick=${() => alternar(v)}>${v.ativo ? 'Desativar' : 'Reativar'}<//>` },
      ]} /></div>`}
    ${modal && html`<${VendedorModal} v=${modal} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} />`}
  </div>`;
}

function VendedorModal({ v, onClose, onFeito }) {
  const novo = !v.id;
  const [f, setF] = useState({ nome: v.nome || '', telefone: v.telefone || '', email: v.usuario_email || v.email || '', comissao_pct: v.comissao_pct ?? 0, observacoes: v.observacoes || '', criar_acesso: false, senha: '' });
  const [novaSenha, setNovaSenha] = useState('');
  const set = (k) => (x) => setF((o) => ({ ...o, [k]: x }));
  const salvar = async () => {
    const body = { ...f, comissao_pct: Number(String(f.comissao_pct).replace(',', '.')) || 0 };
    if (await tentar(() => (novo ? api('/vendedores', { method: 'POST', body }) : api(`/vendedores/${v.id}`, { method: 'PUT', body })), novo ? 'Vendedor cadastrado!' : 'Alterações salvas.')) onFeito();
  };
  const redefinir = async () => {
    if (novaSenha.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'erro');
    if (await tentar(() => api(`/usuarios/${v.usuario_id}/senha`, { method: 'POST', body: { senha: novaSenha } }), 'Senha redefinida. Ele(a) vai criar uma nova no próximo acesso.')) setNovaSenha('');
  };
  return html`<${Modal} titulo=${novo ? 'Novo vendedor' : v.nome} onClose=${onClose} rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>${novo ? 'Cadastrar' : 'Salvar'}<//>`}>
    <div class="form-grid">
      <${Field} label="Nome completo" cls="full"><${Input} value=${f.nome} onInput=${set('nome')} /><//>
      <${Field} label="Telefone / WhatsApp"><${Input} value=${f.telefone} onInput=${set('telefone')} inputmode="tel" /><//>
      <${Field} label="Comissão (%)" hint="Sobre o valor recebido no mês. Aparece como estimativa no painel."><${Input} type="number" min="0" max="100" step="0.1" value=${f.comissao_pct} onInput=${set('comissao_pct')} /><//>
      <${Field} label=${novo ? 'E-mail (para o login)' : 'E-mail'} cls="full"><${Input} type="email" value=${f.email} onInput=${set('email')} disabled=${!!v.usuario_id} /><//>
      ${novo && html`<div class="full stack" style="gap:10px"><${Check} checked=${f.criar_acesso} onChange=${set('criar_acesso')}>Criar acesso ao painel para este vendedor<//>
        ${f.criar_acesso && html`<${Field} label="Senha provisória (mínimo 8 caracteres)" hint="Ele(a) será obrigado(a) a trocar no primeiro acesso."><${Input} value=${f.senha} onInput=${set('senha')} /><//>`}</div>`}
      <${Field} label="Observações" cls="full"><${Input} value=${f.observacoes} onInput=${set('observacoes')} /><//>
    </div>
    ${!novo && v.usuario_id && html`<div class="sep"></div><div class="lbl" style="margin-bottom:8px">Redefinir senha de acesso</div><div class="row"><div class="grow"><${Input} placeholder="Nova senha provisória (mín. 8)" value=${novaSenha} onInput=${setNovaSenha} /></div><${Btn} onClick=${redefinir}>Redefinir<//></div>`}
    ${!novo && !v.usuario_id && html`<div class="alert info" style="margin-top:14px"><${Icon} n="info" /><div>Este vendedor ainda não tem acesso ao painel. Para criar, vá em <a href="#/usuarios">Usuários e acessos</a>.</div></div>`}
  <//>`;
}

// ======================================================== CLIENTES
export function Clientes({ usuario }) {
  const admin = usuario.papel === 'admin';
  const [busca, setBusca] = useState('');
  const [vend, setVend] = useState('');
  const [devedores, setDevedores] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [modal, setModal] = useState(null);
  const b = useDebounced(busca);
  useEffect(() => setPagina(1), [b, vend, devedores]);
  const vs = useApi(admin ? '/vendedores' : null);
  const { data, loading, error, reload } = useApi(`/clientes${qs({ busca: b, vendedor_id: admin ? vend : undefined, devedores, pagina, limite: 50, ordem: devedores ? 'aberto' : 'nome' })}`);
  return html`<div class="page">
    <${PageHead} titulo=${admin ? 'Clientes' : 'Meus clientes'} sub=${data ? `${data.total} ${data.total === 1 ? 'cliente' : 'clientes'}` : ' '}>
      <${Btn} icon="download" href=${`/api/exportar/clientes.csv${qs({ vendedor_id: admin ? vend : undefined })}`}>Planilha<//><${Btn} tipo="primary" icon="plus" onClick=${() => setModal({ novo: true })}>Novo cliente<//><//>
    <div class="card"><div class="pad-s row" style="border-bottom:1px solid var(--line)"><${SearchBox} value=${busca} onInput=${setBusca} placeholder="Buscar nome, CPF/CNPJ ou telefone…" />
      ${admin && html`<${Select} sm value=${vend} onChange=${setVend} style="max-width:210px"><option value="">Todos os vendedores</option>${(vs.data || []).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//>`}
      <${Check} checked=${devedores} onChange=${setDevedores}>Só quem está devendo<//></div>
      ${error && !data ? html`<div class="pad"><${ErroCaixa} erro=${error} onRetry=${reload} /></div>` : !data ? html`<${Spinner} />` : html`<div class=${loading ? 'carregando' : ''}><${Tabela} linhas=${data.itens} onRow=${(c) => setModal({ id: c.id })}
        vazio=${html`<${Empty} icon="user" titulo="Nenhum cliente encontrado">Cadastre clientes ou importe uma planilha em "Importar arquivos".<//>`} cols=${[
          { t: 'Cliente', cls: 'col-nome', r: (c) => html`<b>${c.nome}</b><span class="sub-l">${[c.cidade, c.telefone].filter(Boolean).join(' · ')}</span>` },
          ...(admin ? [{ t: 'Vendedor', r: (c) => c.vendedor_nome || '—' }] : []),
          { t: 'Em aberto', num: true, r: (c) => c.aberto_centavos > 0 ? html`<b>${fmtBRL(c.aberto_centavos)}</b>` : '—' },
          { t: 'Vencido', num: true, r: (c) => c.vencido_centavos > 0 ? html`<span class="red semi">${fmtBRL(c.vencido_centavos)}</span>` : '—' },
          { t: 'Última compra', r: (c) => fmtBR(c.ultima_compra) || '—' },
        ]} /></div><${Pager} pagina=${pagina} limite=${50} total=${data.total} onPage=${setPagina} />`}</div>
    ${modal && html`<${ClienteModal} admin=${admin} usuario=${usuario} m=${modal} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} onMudou=${reload} />`}
  </div>`;
}

function ClienteModal({ admin, usuario, m, onClose, onFeito, onMudou }) {
  const novo = !!m.novo;
  const det = useApi(novo ? null : `/clientes/${m.id}`);
  const vs = useApi(admin ? '/vendedores' : null);
  const [aba, setAba] = useState('dados');
  const [f, setF] = useState(null);
  const [mesclar, setMesclar] = useState(false);
  useEffect(() => { if (novo) setF({ nome: '', documento: '', telefone: '', email: '', endereco: '', cidade: '', observacoes: '', vendedor_id: admin ? '' : usuario.vendedor_id }); }, []);
  useEffect(() => { if (det.data && !f) setF({ ...det.data.cliente, vendedor_id: det.data.cliente.vendedor_id || '' }); }, [det.data]);
  if (!novo && det.error) return html`<${Modal} titulo="Cliente" onClose=${onClose}><${ErroCaixa} erro=${det.error} /><//>`;
  if (!f) return html`<${Modal} titulo="Cliente" onClose=${onClose}><${Spinner} /><//>`;
  const set = (k) => (x) => setF((o) => ({ ...o, [k]: x }));
  const salvar = async () => {
    const body = { ...f, vendedor_id: f.vendedor_id || undefined };
    if (await tentar(() => (novo ? api('/clientes', { method: 'POST', body }) : api(`/clientes/${m.id}`, { method: 'PUT', body })), novo ? 'Cliente cadastrado!' : 'Alterações salvas.')) onFeito();
  };
  const cobrar = async () => { try { const r = await api(`/clientes/${m.id}/cobranca`); window.open(r.link, '_blank', 'noopener'); } catch (e) { toast(e.message, 'erro'); } };
  const D = det.data;
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir este cliente?', texto: 'Só é possível se ele não tiver vendas, dívidas ou pagamentos. Caso contrário, desative-o ou use "Mesclar".', ok: 'Excluir', perigo: true }))) return;
    if (await tentar(() => api(`/clientes/${m.id}`, { method: 'DELETE' }), 'Cliente excluído.')) onFeito();
  };
  return html`<${Modal} titulo=${novo ? 'Novo cliente' : f.nome} sub=${!novo && D ? `${D.vendedor_nome ? `Carteira de ${D.vendedor_nome} · ` : ''}Em aberto ${fmtBRL(D.totais.aberto_centavos)}${D.totais.vencido_centavos ? ` (${fmtBRL(D.totais.vencido_centavos)} vencido)` : ''}` : null} tam="wide" onClose=${onClose}
    rodape=${html`${!novo && admin && html`<${Btn} tipo="danger" icon="trash" onClick=${excluir}>Excluir<//><${Btn} onClick=${() => setMesclar(true)}>Mesclar com outro<//>`}${!novo && D?.totais.aberto_centavos > 0 && html`<${Btn} tipo="wa" icon="chat" onClick=${cobrar}>Cobrar no WhatsApp<//>`}<div class="grow"></div><${Btn} onClick=${onClose}>Fechar<//><${Btn} tipo="primary" onClick=${salvar}>${novo ? 'Cadastrar' : 'Salvar'}<//>`}>
    ${!novo && html`<${Tabs} valor=${aba} onChange=${setAba} abas=${[['dados', 'Dados'], ['dividas', 'Dívidas', D?.titulos.filter((t) => t.valor_centavos > t.pago_centavos).length || 0], ['vendas', 'Vendas'], ['pagamentos', 'Pagamentos']]} />`}
    ${aba === 'dados' && html`<div class="form-grid">
      <${Field} label="Nome / razão social" cls="full"><${Input} value=${f.nome} onInput=${set('nome')} /><//>
      <${Field} label="CPF / CNPJ"><${Input} value=${f.documento || ''} onInput=${set('documento')} inputmode="numeric" /><//>
      <${Field} label="Telefone / WhatsApp"><${Input} value=${f.telefone || ''} onInput=${set('telefone')} inputmode="tel" /><//>
      <${Field} label="E-mail"><${Input} value=${f.email || ''} onInput=${set('email')} /><//>
      <${Field} label="Cidade"><${Input} value=${f.cidade || ''} onInput=${set('cidade')} /><//>
      <${Field} label="Endereço" cls="full"><${Input} value=${f.endereco || ''} onInput=${set('endereco')} /><//>
      ${admin && html`<${Field} label="Vendedor responsável (carteira)"><${Select} value=${f.vendedor_id} onChange=${set('vendedor_id')}><option value="">Sem vendedor</option>${(vs.data || []).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//><//>`}
      ${admin && !novo && html`<div class="field" style="align-content:end"><${Check} checked=${!!f.ativo} onChange=${(x) => set('ativo')(x ? 1 : 0)}>Cliente ativo<//></div>`}
      <${Field} label="Observações" cls="full"><${Input} value=${f.observacoes || ''} onInput=${set('observacoes')} /><//>
    </div>`}
    ${aba === 'dividas' && D && html`<${Tabela} linhas=${D.titulos} stack=${false} vazio=${html`<${Empty} icon="check" titulo="Sem dívidas">Nenhuma conta a receber deste cliente.<//>`} cols=${[
      { t: 'Vencimento', r: (t) => fmtBR(t.vencimento) }, { t: 'Doc', r: (t) => t.documento || '—' }, { t: 'Valor', num: true, r: (t) => fmtBRL(t.valor_centavos) },
      { t: 'Pago', num: true, r: (t) => t.pago_centavos ? fmtBRL(t.pago_centavos) : '—' }, { t: 'Situação', r: (t) => html`<${StatusTitulo} t=${{ ...t, status: t.valor_centavos <= t.pago_centavos ? 'pago' : t.vencimento < new Date().toISOString().slice(0, 10) ? 'vencido' : t.pago_centavos > 0 ? 'parcial' : 'aberto' }} />` }]} />`}
    ${aba === 'vendas' && D && html`<${Tabela} linhas=${D.vendas} stack=${false} vazio=${html`<${Empty} icon="cart" titulo="Sem vendas">Nenhuma venda deste cliente.<//>`} cols=${[
      { t: 'Data', r: (v) => fmtBR(v.data) }, { t: 'Nº', r: (v) => v.numero || '—' }, { t: 'Total', num: true, r: (v) => fmtBRL(v.total_centavos) }, { t: 'Pagamento', r: (v) => FORMAS[v.forma_pagamento] || '—' }]} />`}
    ${aba === 'pagamentos' && D && html`<${Tabela} linhas=${D.recebimentos} stack=${false} vazio=${html`<${Empty} icon="cash" titulo="Sem pagamentos">Nenhum pagamento deste cliente.<//>`} cols=${[
      { t: 'Data', r: (r) => fmtBR(r.data) }, { t: 'Valor', num: true, r: (r) => fmtBRL(r.valor_centavos) }, { t: 'Forma', r: (r) => FORMAS[r.forma] || r.forma }]} />`}
    ${mesclar && html`<${MesclarModal} origem=${m.id} nome=${f.nome} onClose=${() => setMesclar(false)} onFeito=${() => { setMesclar(false); onFeito(); }} />`}
  <//>`;
}

function MesclarModal({ origem, nome, onClose, onFeito }) {
  const [alvo, setAlvo] = useState(null);
  const [busca, setBusca] = useState('');
  const b = useDebounced(busca);
  const { data } = useApi(`/clientes${qs({ busca: b, limite: 8 })}`);
  const go = async () => {
    if (!(await confirmar({ titulo: 'Juntar cadastros?', texto: `Tudo de "${nome}" (vendas, dívidas e pagamentos) passa para "${alvo.nome}" e o cadastro "${nome}" é removido. Não dá para desfazer.`, ok: 'Juntar', perigo: true }))) return;
    if (await tentar(() => api(`/clientes/${origem}/mesclar`, { method: 'POST', body: { destino_id: alvo.id } }), 'Cadastros juntados.')) onFeito();
  };
  return html`<${Modal} titulo="Mesclar com outro cliente" sub=${`Use quando "${nome}" é o mesmo cliente de outro cadastro (nome escrito diferente)`} tam="sm" onClose=${onClose}
    rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="solid-danger" disabled=${!alvo} onClick=${go}>Juntar cadastros<//>`}>
    <${SearchBox} value=${busca} onInput=${setBusca} placeholder="Buscar o cadastro que vai ficar…" />
    <div class="stack" style="gap:6px;margin-top:12px">${(data?.itens || []).filter((c) => c.id !== origem).map((c) => html`<button class=${`btn ${alvo?.id === c.id ? 'btn-primary' : ''}`} style="justify-content:flex-start" onClick=${() => setAlvo(c)}>${c.nome}</button>`)}</div><//>`;
}

// ======================================================== PRODUTOS
export function Produtos() {
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [modal, setModal] = useState(null);
  const b = useDebounced(busca);
  const { data, error, reload } = useApi(`/produtos${qs({ busca: b, inativos })}`);
  return html`<div class="page">
    <${PageHead} titulo="Produtos" sub="Catálogo com preço, custo e estoque atual"><${Btn} tipo="primary" icon="plus" onClick=${() => setModal({})}>Novo produto<//><//>
    <div class="card"><div class="pad-s row" style="border-bottom:1px solid var(--line)"><${SearchBox} value=${busca} onInput=${setBusca} placeholder="Buscar produto ou código…" /><${Check} checked=${inativos} onChange=${setInativos}>Mostrar inativos<//></div>
      ${error && !data ? html`<div class="pad"><${ErroCaixa} erro=${error} onRetry=${reload} /></div>` : !data ? html`<${Spinner} />` : html`<${Tabela} linhas=${data} rowCls=${(p) => (p.ativo ? '' : 'dim')} onRow=${(p) => setModal(p)}
        vazio=${html`<${Empty} icon="tag" titulo="Nenhum produto">Cadastre seus produtos ou importe uma planilha.<//>`} cols=${[
          { t: 'Produto', r: (p) => html`<b>${p.nome}</b>${p.sku ? html`<span class="sub-l">Cód. ${p.sku}</span>` : ''}` }, { t: 'Unidade', r: (p) => p.unidade },
          { t: 'Preço', num: true, r: (p) => fmtBRL(p.preco_centavos) }, { t: 'Custo', num: true, r: (p) => p.custo_centavos ? fmtBRL(p.custo_centavos) : '—' },
          { t: 'Estoque', num: true, r: (p) => html`<b class=${p.saldo < 0 || (p.estoque_minimo > 0 && p.saldo < p.estoque_minimo) ? 'red' : ''}>${fmtQtd(p.saldo)}</b>${p.estoque_minimo > 0 ? html`<span class="muted tiny"> / mín. ${fmtQtd(p.estoque_minimo)}</span>` : ''}` },
        ]} />`}</div>
    ${modal && html`<${ProdutoModal} p=${modal} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} />`}
  </div>`;
}

function ProdutoModal({ p, onClose, onFeito }) {
  const novo = !p.id;
  const [f, setF] = useState({ nome: p.nome || '', sku: p.sku || '', unidade: p.unidade || 'un', preco_centavos: p.preco_centavos ?? null, custo_centavos: p.custo_centavos ?? null, categoria: p.categoria || '', estoque_minimo: p.estoque_minimo ?? 0, ativo: p.ativo ?? 1 });
  const set = (k) => (x) => setF((o) => ({ ...o, [k]: x }));
  const salvar = async () => { if (await tentar(() => (novo ? api('/produtos', { method: 'POST', body: f }) : api(`/produtos/${p.id}`, { method: 'PUT', body: f })), novo ? 'Produto cadastrado!' : 'Alterações salvas.')) onFeito(); };
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir este produto?', texto: 'Só é possível se nunca foi vendido nem movimentado no depósito. Senão, desative-o.', ok: 'Excluir', perigo: true }))) return;
    if (await tentar(() => api(`/produtos/${p.id}`, { method: 'DELETE' }), 'Produto excluído.')) onFeito();
  };
  return html`<${Modal} titulo=${novo ? 'Novo produto' : p.nome} tam="sm" onClose=${onClose} rodape=${html`${!novo && html`<${Btn} tipo="danger" icon="trash" onClick=${excluir}>Excluir<//>`}<div class="grow"></div><${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>${novo ? 'Cadastrar' : 'Salvar'}<//>`}>
    <div class="form-grid">
      <${Field} label="Nome do produto" cls="full"><${Input} value=${f.nome} onInput=${set('nome')} /><//>
      <${Field} label="Código (opcional)"><${Input} value=${f.sku} onInput=${set('sku')} /><//>
      <${Field} label="Unidade (un, kg, cx, pct…)"><${Input} value=${f.unidade} onInput=${set('unidade')} /><//>
      <${Field} label="Preço de venda"><${MoneyInput} value=${f.preco_centavos} onChange=${set('preco_centavos')} /><//>
      <${Field} label="Custo (opcional)"><${MoneyInput} value=${f.custo_centavos} onChange=${set('custo_centavos')} /><//>
      <${Field} label="Estoque mínimo" hint="Avisa quando o estoque ficar abaixo disso."><${Input} type="number" min="0" step="any" value=${f.estoque_minimo} onInput=${set('estoque_minimo')} /><//>
      <${Field} label="Categoria (opcional)"><${Input} value=${f.categoria} onInput=${set('categoria')} /><//>
      ${!novo && html`<div class="full"><${Check} checked=${!!f.ativo} onChange=${(x) => set('ativo')(x ? 1 : 0)}>Produto ativo (aparece nas vendas)<//></div>`}
    </div><//>`;
}
