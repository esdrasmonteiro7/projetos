// Ponto de entrada: sessão, menu lateral, rotas e carregamento das telas.
import { html, render, useState, useEffect, useRef, api, setCsrf, ambiente, useRoute, useApi, go, cx } from './lib.js';
import { Icon, Logo, Spinner, ToastHost, ConfirmHost, Btn } from './ui.js';
import { Login, TrocarSenha } from './pages/login.js';

const MENU_ADMIN = [
  ['Visão geral', [['painel', 'Painel', 'home']]],
  ['Dinheiro', [['vendas', 'Vendas', 'cart'], ['receber', 'A receber', 'clock'], ['recebimentos', 'Recebimentos (Pix)', 'cash', 'rec'], ['importar', 'Importar arquivos', 'upload']]],
  ['Depósito', [['deposito', 'Depósito e produção', 'box']]],
  ['Relatórios', [['relatorios', 'Relatório em PDF', 'file']]],
  ['Cadastros', [['vendedores', 'Vendedores', 'users'], ['clientes', 'Clientes', 'user'], ['produtos', 'Produtos', 'tag']]],
  ['Administração', [['usuarios', 'Usuários e acessos', 'gear'], ['historico', 'Histórico de ações', 'history'], ['config', 'Configurações e backup', 'gear']]],
];
const MENU_VENDEDOR = [
  ['Meu espaço', [['painel', 'Meu painel', 'home'], ['vendas', 'Minhas vendas', 'cart'], ['receber', 'A receber dos clientes', 'clock', 'venc'], ['recebimentos', 'Pagamentos', 'cash', 'rec'], ['clientes', 'Meus clientes', 'user'], ['deposito', 'Minhas retiradas', 'box'], ['relatorios', 'Meu relatório', 'file']]],
];
const PAGINAS = {
  painel: () => import('./pages/painel.js'),
  vendas: () => import('./pages/vendas.js'),
  receber: () => import('./pages/receber.js'),
  recebimentos: () => import('./pages/recebimentos.js'),
  importar: () => import('./pages/importar.js'),
  deposito: () => import('./pages/deposito.js'),
  relatorios: () => import('./pages/relatorios.js'),
  vendedores: () => import('./pages/cadastros.js').then((m) => ({ default: m.Vendedores })),
  clientes: () => import('./pages/cadastros.js').then((m) => ({ default: m.Clientes })),
  produtos: () => import('./pages/cadastros.js').then((m) => ({ default: m.Produtos })),
  usuarios: () => import('./pages/admin.js').then((m) => ({ default: m.Usuarios })),
  historico: () => import('./pages/admin.js').then((m) => ({ default: m.Historico })),
  config: () => import('./pages/admin.js').then((m) => ({ default: m.Config })),
};
const SO_ADMIN = new Set(['importar', 'vendedores', 'produtos', 'usuarios', 'historico', 'config']);

function Pagina({ nome, usuario }) {
  const [Comp, setComp] = useState(null);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    let vivo = true;
    setComp(null); setErro(null);
    (PAGINAS[nome] || PAGINAS.painel)().then((m) => vivo && setComp(() => m.default)).catch((e) => vivo && setErro(e));
    return () => { vivo = false; };
  }, [nome]);
  if (erro) return html`<div class="page"><div class="alert bad">Não consegui carregar esta tela (${erro.message}). Recarregue a página.</div></div>`;
  if (!Comp) return html`<div class="page"><${Spinner} /></div>`;
  return html`<${Comp} usuario=${usuario} />`;
}

function Shell({ sessao, usuario, onSair }) {
  const { path } = useRoute();
  const [aberto, setAberto] = useState(false);
  const [trocar, setTrocar] = useState(usuario.trocar_senha);
  const admin = usuario.papel === 'admin';
  const al = useApi('/alertas');
  const alertasRef = useRef(al.reload);
  alertasRef.current = al.reload;
  useEffect(() => { const t = setInterval(() => document.visibilityState === 'visible' && alertasRef.current(), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { setAberto(false); window.scrollTo(0, 0); }, [path]);
  const nome = path.replace(/^\//, '').split('/')[0] || 'painel';
  const pagina = SO_ADMIN.has(nome) && !admin ? 'painel' : nome;
  const menu = admin ? MENU_ADMIN : MENU_VENDEDOR;
  const numeros = { rec: (al.data?.sem_baixa || 0) + (al.data?.pendentes || 0), venc: al.data?.vencidos || 0 };
  useEffect(() => { document.title = `${sessao.empresa} — Painel`; }, []);

  return html`<div class="app">
    <aside class=${cx('sidebar', aberto && 'aberta')}>
      <a class="brand" href="#/painel"><${Logo} /><div><div class="brand-t1">Bom Gosto</div><div class="brand-t2">da Amazônia</div></div></a>
      <nav class="nav">${menu.map(([sec, itens]) => html`<div key=${sec}><div class="nav-sec">${sec}</div>
        ${itens.map(([k, rot, ic, nb]) => html`<a key=${k} href=${`#/${k}`} class=${pagina === k ? 'ativo' : ''}><${Icon} n=${ic} s=${19} />${rot}${nb && numeros[nb] > 0 ? html`<span class="badge-n">${numeros[nb]}</span>` : ''}</a>`)}</div>`)}</nav>
      <div class="side-foot"><div class="who">${usuario.nome}</div><div class="role">${admin ? 'Administrador' : 'Vendedor'}</div>
        <div class="row" style="gap:8px;flex-wrap:nowrap"><button onClick=${() => setTrocar('voluntaria')} title="Trocar minha senha"><${Icon} n="gear" s=${16} />Senha</button><button onClick=${onSair}><${Icon} n="out" s=${16} />Sair</button></div></div>
    </aside>
    <div class=${cx('scrim', aberto && 'on')} onClick=${() => setAberto(false)}></div>
    <div class="main">
      <div class="topbar"><button aria-label="Abrir menu" onClick=${() => setAberto(true)}><${Icon} n="menu" /></button><${Logo} size=${34} /><div class="t">Bom Gosto da Amazônia</div></div>
      ${admin && al.data?.backup && html`<div class="faixa-alerta"><div class="alert bad"><${Icon} n="alert" /><div class="grow"><b>Atenção:</b> ${al.data.backup.texto} <a href="#/config">Ver como resolver</a></div></div></div>`}
      <${Pagina} nome=${pagina} usuario=${usuario} key=${pagina} />
    </div>
    ${trocar && html`<${TrocarSenha} obrigatorio=${trocar === true} onClose=${() => setTrocar(false)} onFeito=${() => setTrocar(false)} />`}
  </div>`;
}

function App() {
  const [sessao, setSessao] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [erro, setErro] = useState(null);
  const carregar = () => api('/sessao').then((s) => { setCsrf(s.csrf); ambiente.limiteEnvioMB = s.limite_envio_mb ?? null; setSessao(s); setUsuario(s.usuario); }).catch((e) => setErro(e));
  useEffect(() => {
    carregar();
    const f = () => { setUsuario(null); };
    addEventListener('sessao-expirada', f);
    return () => removeEventListener('sessao-expirada', f);
  }, []);
  const sair = async () => { try { await api('/logout', { method: 'POST' }); } catch { /* sai mesmo assim */ } setCsrf(null); setUsuario(null); location.hash = ''; carregar(); };
  if (erro) return html`<div class="login"><div class="login-card"><h1>Não consegui falar com o servidor</h1><p class="muted">${erro.message}</p><${Btn} tipo="primary" onClick=${() => location.reload()}>Tentar de novo<//></div></div>`;
  if (!sessao) return html`<div class="boot"><div class="spinner"></div></div>`;
  return html`${usuario ? html`<${Shell} sessao=${sessao} usuario=${usuario} onSair=${sair} />` : html`<${Login} sessao=${sessao} onEntrou=${(u) => { setUsuario(u); carregar(); }} />`}
    <${ToastHost} /><${ConfirmHost} />`;
}

render(html`<${App} />`, document.getElementById('app'));
