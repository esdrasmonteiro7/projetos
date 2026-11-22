// Administração: usuários e acessos, histórico de ações, configurações e backup.
import {
  html, useState, useEffect, api, qs, useApi, useDebounced, fmtDataHora, fmtBR, tentar, toast, confirmar, baixarUrl,
} from '../lib.js';
import {
  PageHead, Select, SearchBox, Btn, Tabela, Pager, Empty, Modal, Field, Input, Check, Icon, ErroCaixa, Spinner, Badge,
} from '../ui.js';

// ======================================================== USUÁRIOS
export function Usuarios({ usuario }) {
  const { data, error, reload } = useApi('/usuarios');
  const [modal, setModal] = useState(null);
  const admins = (data || []).filter((u) => u.papel === 'admin' && u.ativo).length;
  return html`<div class="page">
    <${PageHead} titulo="Usuários e acessos" sub="Quem pode entrar no painel. Administradores veem e editam tudo; vendedores veem só os dados deles."><${Btn} tipo="primary" icon="plus" onClick=${() => setModal({})}>Novo usuário<//><//>
    <div class="alert info" style="margin-bottom:16px"><${Icon} n="info" /><div>Você tem <b>${admins}</b> ${admins === 1 ? 'administrador ativo' : 'administradores ativos'}. Cadastre aqui os outros administradores da empresa. Para criar o acesso de um vendedor, escolha "Vendedor" e a pessoa correspondente (cadastre o vendedor antes em <a href="#/vendedores">Vendedores</a>).</div></div>
    ${error && !data ? html`<${ErroCaixa} erro=${error} onRetry=${reload} />` : !data ? html`<${Spinner} />` : html`<div class="card"><${Tabela} linhas=${data} rowCls=${(u) => (u.ativo ? '' : 'dim')} onRow=${(u) => setModal(u)} cols=${[
      { t: 'Nome', r: (u) => html`<b>${u.nome}</b>${u.id === usuario.id ? html` <${Badge} tipo="info">você<//>` : ''}<span class="sub-l">${u.email}</span>` },
      { t: 'Tipo', r: (u) => u.papel === 'admin' ? html`<${Badge} tipo="violet">Administrador<//>` : html`<${Badge}>Vendedor${u.vendedor_nome ? `: ${u.vendedor_nome}` : ''}<//>` },
      { t: 'Último acesso', r: (u) => u.ultimo_login ? fmtDataHora(u.ultimo_login) : html`<span class="muted">nunca entrou</span>` },
      { t: 'Situação', r: (u) => html`<${Badge} tipo=${u.ativo ? 'ok' : 'mute'}>${u.ativo ? 'Ativo' : 'Desativado'}<//>` },
    ]} /></div>`}
    ${modal && html`<${UsuarioModal} u=${modal} eu=${usuario} onClose=${() => setModal(null)} onFeito=${() => { setModal(null); reload(); }} />`}
  </div>`;
}

function UsuarioModal({ u, eu, onClose, onFeito }) {
  const novo = !u.id;
  const vs = useApi('/vendedores');
  const [f, setF] = useState({ nome: u.nome || '', email: u.email || '', papel: u.papel || 'admin', vendedor_id: u.vendedor_id || '', ativo: u.ativo ?? 1, senha: '' });
  const [nova, setNova] = useState('');
  const set = (k) => (x) => setF((o) => ({ ...o, [k]: x }));
  const salvar = async () => {
    const body = { ...f, vendedor_id: f.papel === 'vendedor' ? Number(f.vendedor_id) || undefined : undefined };
    if (await tentar(() => (novo ? api('/usuarios', { method: 'POST', body }) : api(`/usuarios/${u.id}`, { method: 'PUT', body })), novo ? 'Usuário criado!' : 'Alterações salvas.')) onFeito();
  };
  const redefinir = async () => {
    if (nova.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'erro');
    if (await tentar(() => api(`/usuarios/${u.id}/senha`, { method: 'POST', body: { senha: nova } }), 'Senha redefinida. A pessoa terá de criar outra ao entrar.')) setNova('');
  };
  return html`<${Modal} titulo=${novo ? 'Novo usuário' : u.nome} tam="sm" onClose=${onClose} rodape=${html`<${Btn} onClick=${onClose}>Cancelar<//><${Btn} tipo="primary" onClick=${salvar}>${novo ? 'Criar usuário' : 'Salvar'}<//>`}>
    <div class="form-grid">
      <${Field} label="Nome" cls="full"><${Input} value=${f.nome} onInput=${set('nome')} /><//>
      <${Field} label="E-mail (é o login)" cls="full"><${Input} type="email" value=${f.email} onInput=${set('email')} /><//>
      <${Field} label="Tipo de acesso" cls="full"><${Select} value=${f.papel} onChange=${set('papel')}><option value="admin">Administrador — vê e edita tudo</option><option value="vendedor">Vendedor — vê só os próprios dados</option><//><//>
      ${f.papel === 'vendedor' && html`<${Field} label="Qual vendedor é esta pessoa?" cls="full"><${Select} value=${f.vendedor_id} onChange=${set('vendedor_id')}><option value="">Escolha…</option>${(vs.data || []).filter((v) => v.ativo).map((v) => html`<option value=${v.id}>${v.nome}</option>`)}<//><//>`}
      ${novo && html`<${Field} label="Senha provisória (mínimo 8 caracteres)" cls="full" hint="A pessoa troca no primeiro acesso."><${Input} value=${f.senha} onInput=${set('senha')} /><//>`}
      ${!novo && u.id !== eu.id && html`<div class="full"><${Check} checked=${!!f.ativo} onChange=${(x) => set('ativo')(x ? 1 : 0)}>Acesso ativo<//></div>`}
    </div>
    ${!novo && html`<div class="sep"></div><div class="lbl" style="margin-bottom:8px">Redefinir senha</div><div class="row"><div class="grow"><${Input} placeholder="Nova senha provisória (mín. 8)" value=${nova} onInput=${setNova} /></div><${Btn} onClick=${redefinir}>Redefinir<//></div>`}
  <//>`;
}

// ======================================================== HISTÓRICO
export function Historico() {
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const b = useDebounced(busca);
  useEffect(() => setPagina(1), [b]);
  const { data, loading, error, reload } = useApi(`/auditoria${qs({ busca: b, pagina, limite: 60 })}`);
  return html`<div class="page">
    <${PageHead} titulo="Histórico de ações" sub="Quem fez o quê e quando — logins, baixas, importações, alterações e exclusões" />
    <div class="card"><div class="pad-s row" style="border-bottom:1px solid var(--line)"><${SearchBox} value=${busca} onInput=${setBusca} placeholder="Buscar por pessoa ou ação…" /></div>
      ${error && !data ? html`<div class="pad"><${ErroCaixa} erro=${error} onRetry=${reload} /></div>` : !data ? html`<${Spinner} />` : html`<div class=${loading ? 'carregando' : ''}><${Tabela} linhas=${data.itens} vazio=${html`<${Empty} icon="history" titulo="Nada registrado ainda">As ações feitas no painel aparecem aqui.<//>`} cols=${[
        { t: 'Quando', r: (a) => fmtDataHora(a.criado_em), cls: 'nowrap' }, { t: 'Quem', r: (a) => html`<b>${a.usuario_nome || 'Sistema'}</b>` }, { t: 'O que fez', r: (a) => a.acao },
        { t: 'Detalhes', r: (a) => html`<span class="muted small" style="word-break:break-all">${a.detalhes ? String(a.detalhes).slice(0, 140) : ''}</span>`, cls: 'hide-m' },
      ]} /></div><${Pager} pagina=${pagina} limite=${60} total=${data.total} onPage=${setPagina} />`}</div>
  </div>`;
}

// ======================================================== CONFIGURAÇÕES
const FUSOS = [['America/Manaus', 'Manaus / Amazonas (UTC−4)'], ['America/Belem', 'Belém / Pará (UTC−3)'], ['America/Sao_Paulo', 'Brasília / São Paulo (UTC−3)'], ['America/Porto_Velho', 'Porto Velho / Rondônia (UTC−4)'], ['America/Boa_Vista', 'Boa Vista / Roraima (UTC−4)'], ['America/Rio_Branco', 'Rio Branco / Acre (UTC−5)'], ['America/Cuiaba', 'Cuiabá / Mato Grosso (UTC−4)'], ['America/Fortaleza', 'Fortaleza / Nordeste (UTC−3)']];

export function Config() {
  const { data, error, reload } = useApi('/configuracoes');
  const saude = useApi('/saude');
  const [f, setF] = useState(null);
  useEffect(() => { if (data && !f) setF(data); }, [data]);
  if (error && !data) return html`<div class="page"><${ErroCaixa} erro=${error} onRetry=${reload} /></div>`;
  if (!f) return html`<div class="page"><${Spinner} /></div>`;
  const set = (k) => (x) => setF((o) => ({ ...o, [k]: x }));
  const salvar = async () => {
    if (await tentar(() => api('/configuracoes', { method: 'PUT', body: { empresa_nome: f.empresa_nome, empresa_telefone: f.empresa_telefone, empresa_cnpj: f.empresa_cnpj, fuso_horario: f.fuso_horario, msg_cobranca: f.msg_cobranca, vendas_a_vista_pagas: f.vendas_a_vista_pagas } }), 'Configurações salvas!')) reload();
  };
  const s = saude.data;
  return html`<div class="page">
    <${PageHead} titulo="Configurações e backup" sub="Dados da empresa, mensagem de cobrança e cópia de segurança"><${Btn} tipo="primary" onClick=${salvar}>Salvar configurações<//><//>
    <div class="grid c2" style="align-items:start">
      <div class="stack">
        <div class="card pad"><div class="card-t" style="margin-bottom:12px">Empresa</div><div class="form-grid">
          <${Field} label="Nome da empresa" cls="full"><${Input} value=${f.empresa_nome} onInput=${set('empresa_nome')} /><//>
          <${Field} label="CNPJ" hint="Ajuda a reconhecer notas fiscais de compra e Pix enviados pela empresa."><${Input} value=${f.empresa_cnpj} onInput=${set('empresa_cnpj')} inputmode="numeric" /><//>
          <${Field} label="Telefone"><${Input} value=${f.empresa_telefone} onInput=${set('empresa_telefone')} /><//>
          <${Field} label="Fuso horário" hint="Define o que é “hoje” para calcular atrasos." cls="full"><${Select} value=${f.fuso_horario} onChange=${set('fuso_horario')}>${FUSOS.map(([k, v]) => html`<option value=${k}>${v}</option>`)}<//><//>
          <div class="full"><${Check} checked=${f.vendas_a_vista_pagas === '1'} onChange=${(x) => set('vendas_a_vista_pagas')(x ? '1' : '0')}>Vendas importadas pagas em Pix/dinheiro/cartão/transferência já entram como recebidas<//></div></div></div>
        <div class="card pad"><div class="card-t" style="margin-bottom:4px">Mensagem de cobrança (WhatsApp)</div><div class="card-s" style="margin-bottom:10px">Usada no botão "Cobrar". Você pode usar: <code>{cliente}</code> <code>{valor}</code> <code>{vencimento}</code> <code>{empresa}</code> <code>{documento}</code></div>
          <textarea class="textarea" rows="5" value=${f.msg_cobranca} onInput=${(e) => set('msg_cobranca')(e.target.value)}></textarea></div>
      </div>
      <div class="stack">
        ${f.armazenamento ? html`<${ArmazenamentoNuvem} a=${f.armazenamento} />` : f.backup_remoto && html`<${BackupRemoto} b=${f.backup_remoto} onMudou=${reload} />`}
        <div class="card pad stack" style="gap:12px"><div><div class="card-t">Cópia de segurança (backup)</div><div class="card-s">Baixa um arquivo com TODOS os dados do painel (vendas, dívidas, pagamentos, cadastros e depósito). Guarde em um lugar seguro, como o Google Drive.</div></div>
          <div><${Btn} tipo="primary" icon="download" onClick=${() => baixarUrl('/api/backup')}>Baixar backup agora<//></div>
          <div class="alert warn small"><${Icon} n="alert" /><div>Faça um backup <b>toda semana</b>. ${f.armazenamento ? 'Seus dados já ficam guardados na nuvem, mas uma cópia sua (por exemplo no Google Drive) é a garantia extra.' : html`Os arquivos enviados (PDFs, XMLs) ficam guardados no servidor, em <code>${f.dados_em}/uploads</code>.`}</div></div></div>
        <div class="card pad"><div class="card-t" style="margin-bottom:10px">Situação do sistema</div>
          ${s ? html`<div class="chips">${[['Vendas', s.vendas], ['Dívidas/títulos', s.titulos], ['Recebimentos', s.recebimentos], ['Clientes', s.clientes], ['Produtos', s.produtos], ['Vendedores', s.vendedores]].map(([k, v]) => html`<span class="chip">${k} <b>${v}</b></span>`)}</div>` : html`<${Spinner} />`}
          <div class="small muted" style="margin-top:12px">Versão ${f.versao} · dados em <code>${f.dados_em}</code></div></div>
      </div>
    </div></div>`;
}

function ArmazenamentoNuvem({ a }) {
  return html`<div class="card pad stack" style="gap:12px">
    <div><div class="card-t">Dados guardados na nuvem (Netlify)</div>
      <div class="card-s">Cada alteração é salva na hora — o painel só confirma depois de guardar. Também é feita uma cópia por dia, e as últimas 30 ficam guardadas.</div></div>
    <div class="chips"><span class="chip">Última gravação <b>${a.ultima_gravacao ? fmtDataHora(a.ultima_gravacao) : '—'}</b></span>
      <span class="chip">Cópia diária mais recente <b>${a.ultima_copia_diaria ? fmtBR(a.ultima_copia_diaria) : 'ainda não'}</b></span></div>
    ${a.ultimo_erro && html`<div class="alert bad"><${Icon} n="alert" /><div>Última falha ao salvar: ${a.ultimo_erro}</div></div>`}
  </div>`;
}

function BackupRemoto({ b, onMudou }) {
  const [enviando, setEnviando] = useState(false);
  const agora = async () => {
    setEnviando(true);
    await tentar(() => api('/backup/remoto/agora', { method: 'POST' }), 'Backup enviado para o GitHub!');
    setEnviando(false);
    onMudou();
  };
  return html`<div class="card pad stack" style="gap:12px">
    <div><div class="card-t">Backup automático no GitHub</div>
      <div class="card-s">Depois de qualquer alteração, o painel envia uma cópia criptografada para um repositório privado seu. Se o servidor reiniciar, os dados voltam sozinhos.</div></div>
    ${b.ativo ? html`
      <div class="chips"><span class="chip">Repositório <b>${b.repo}</b></span>
        <span class="chip">Último backup <b>${b.ultimo_ok ? fmtDataHora(b.ultimo_ok) : 'ainda não enviado'}</b></span>
        ${b.pendente ? html`<span class="chip" style="background:var(--amber-bg)">alterações aguardando envio</span>` : ''}
        ${b.restaurado_de ? html`<span class="chip">Restaurado de <b>${b.restaurado_de.replace('painel-', '').replace('.db.enc', '')}</b></span>` : ''}</div>
      ${(b.ultimo_erro || b.config_erro) && html`<div class="alert bad"><${Icon} n="alert" /><div>${b.config_erro || b.ultimo_erro}</div></div>`}
      <div><${Btn} icon="refresh" disabled=${enviando} onClick=${agora}>${enviando ? 'Enviando…' : 'Fazer backup agora'}<//></div>`
    : html`<div class="alert ${b.dados_efemeros ? 'bad' : 'info'}"><${Icon} n=${b.dados_efemeros ? 'alert' : 'info'} /><div>${b.dados_efemeros
        ? 'NÃO está ligado — e os dados deste servidor estão em disco temporário. Configure BACKUP_GITHUB_REPO, BACKUP_GITHUB_TOKEN e BACKUP_KEY (passo a passo no README).'
        : 'Não está ligado (opcional quando o servidor tem disco permanente). Para um backup extra fora do servidor, configure BACKUP_GITHUB_REPO, BACKUP_GITHUB_TOKEN e BACKUP_KEY.'}</div></div>`}
  </div>`;
}
