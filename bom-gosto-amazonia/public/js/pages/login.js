// Entrar, primeiro acesso e troca de senha obrigatória.
import { html, useState, api, setCsrf, tentar, toast } from '../lib.js';
import { Field, Input, Check, Btn, Modal, Logo } from '../ui.js';

export function Login({ sessao, onEntrou }) {
  const setup = sessao.precisa_setup;
  const [f, setF] = useState({ nome: '', email: '', senha: '', codigo: '', lembrar: true });
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const enviar = async (e) => {
    e.preventDefault();
    setErro(''); setCarregando(true);
    try {
      const r = setup
        ? await api('/setup', { method: 'POST', body: { nome: f.nome, email: f.email, senha: f.senha, codigo: f.codigo } })
        : await api('/login', { method: 'POST', body: { email: f.email, senha: f.senha, lembrar: f.lembrar } });
      setCsrf(r.csrf);
      onEntrou(r.usuario);
    } catch (e2) { setErro(e2.message); } finally { setCarregando(false); }
  };
  return html`<div class="login"><form class="login-card" onSubmit=${enviar}>
    <div class="login-brand"><${Logo} size=${116} /><div class="sub-t">Painel de gestão</div></div>
    <h1>${setup ? 'Primeiro acesso' : 'Entrar no painel'}</h1>
    <p class="muted small" style="margin:0 0 18px">${setup ? 'Crie a conta do primeiro administrador. Depois você cadastra os outros administradores e os vendedores.' : 'Use o e-mail e a senha que o administrador cadastrou para você.'}</p>
    <div class="stack" style="gap:14px">
      ${setup && html`<${Field} label="Seu nome"><${Input} value=${f.nome} onInput=${set('nome')} autocomplete="name" required /><//>`}
      <${Field} label="E-mail"><${Input} type="email" value=${f.email} onInput=${set('email')} autocomplete="username" inputmode="email" required autofocus /><//>
      <${Field} label=${setup ? 'Crie uma senha (mínimo 8 caracteres)' : 'Senha'}><${Input} type="password" value=${f.senha} onInput=${set('senha')} autocomplete=${setup ? 'new-password' : 'current-password'} required /><//>
      ${setup && sessao.setup_requer_codigo && html`<${Field} label="Código de instalação" hint="É o valor de SETUP_CODE que você definiu no servidor."><${Input} value=${f.codigo} onInput=${set('codigo')} required /><//>`}
      ${!setup && html`<${Check} checked=${f.lembrar} onChange=${set('lembrar')}>Manter conectado neste aparelho<//>`}
      ${erro && html`<div class="alert bad">${erro}</div>`}
      <${Btn} tipo="primary" type="submit" disabled=${carregando} cls="" >${carregando ? 'Aguarde…' : setup ? 'Criar conta e entrar' : 'Entrar'}<//>
    </div></form></div>`;
}

export function TrocarSenha({ onFeito, obrigatorio, onClose }) {
  const [f, setF] = useState({ atual: '', nova: '', repetir: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async () => {
    if (f.nova !== f.repetir) return toast('As senhas novas não são iguais.', 'erro');
    const ok = await tentar(() => api('/minha-senha', { method: 'POST', body: { atual: f.atual, nova: f.nova } }), 'Senha alterada.');
    if (ok) onFeito();
  };
  return html`<${Modal} titulo=${obrigatorio ? 'Crie sua senha pessoal' : 'Trocar minha senha'} sub=${obrigatorio ? 'Por segurança, troque a senha provisória antes de continuar.' : null} tam="sm" onClose=${obrigatorio ? undefined : onClose}
    rodape=${html`${!obrigatorio && html`<${Btn} onClick=${onClose}>Cancelar<//>`}<${Btn} tipo="primary" onClick=${salvar}>Salvar nova senha<//>`}>
    <div class="stack" style="gap:14px">
      <${Field} label=${obrigatorio ? 'Senha provisória (a que você recebeu)' : 'Senha atual'}><${Input} type="password" value=${f.atual} onInput=${set('atual')} autocomplete="current-password" /><//>
      <${Field} label="Nova senha (mínimo 8 caracteres)"><${Input} type="password" value=${f.nova} onInput=${set('nova')} autocomplete="new-password" /><//>
      <${Field} label="Repita a nova senha"><${Input} type="password" value=${f.repetir} onInput=${set('repetir')} autocomplete="new-password" /><//>
    </div><//>`;
}
