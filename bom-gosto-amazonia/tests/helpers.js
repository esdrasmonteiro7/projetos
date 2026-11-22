// Utilitários dos testes: sobe o servidor com um banco temporário e oferece um "navegador" simples (cookies + CSRF).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function boot() {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-test-'));
  delete process.env.SETUP_CODE;
  const { createApp } = await import('../server/app.js');
  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
  const client = () => {
    let cookie = '';
    let csrf = '';
    const c = {
      async raw(method, url, { body, form, headers = {} } = {}) {
        const h = { cookie, origin: base, ...headers };
        if (csrf && !('x-csrf-token' in headers)) h['x-csrf-token'] = csrf;
        if (body !== undefined) h['content-type'] = 'application/json';
        const r = await fetch(base + url, { method, headers: h, body: form || (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' });
        const sc = r.headers.get('set-cookie');
        if (sc) cookie = sc.split(';')[0];
        return r;
      },
      async call(method, url, body, form) {
        const r = await c.raw(method, url, { body, form });
        const t = await r.text();
        let j;
        try { j = JSON.parse(t); } catch { j = t; }
        return { status: r.status, body: j };
      },
      get: (u) => c.call('GET', u),
      post: (u, b) => c.call('POST', u, b ?? {}),
      put: (u, b) => c.call('PUT', u, b ?? {}),
      del: (u) => c.call('DELETE', u),
      async login(email, senha) {
        const r = await c.call('POST', '/api/login', { email, senha });
        if (r.status === 200) csrf = r.body.csrf;
        return r;
      },
      setCsrf: (t) => { csrf = t; },
      async setup(nome = 'Admin Teste', email = 'admin@teste.com', senha = 'senha-forte-1') {
        const r = await c.call('POST', '/api/setup', { nome, email, senha });
        if (r.status === 200) csrf = r.body.csrf;
        return r;
      },
    };
    return c;
  };
  return { base, server, client, close: () => server.close() };
}

export const ok = (r, msg = '') => {
  if (r.status >= 400) throw new Error(`${msg} -> HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
