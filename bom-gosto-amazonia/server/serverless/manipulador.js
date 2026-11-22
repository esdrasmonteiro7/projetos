// Liga a função da Netlify ao painel (Express) e cuida de salvar o banco a cada alteração.
//
// A Netlify entrega cada acesso como uma Request. Aqui ela é repassada para o Express por um servidor local
// (127.0.0.1) que vive dentro da própria função — o painel roda igualzinho ao modo normal, sem adaptações nas rotas.
//
// Para cada acesso à API:  sincronizar banco → rodar a requisição → se gravou algo: salvar (só se ninguém gravou antes).
// Se alguém gravou antes (conflito), a requisição é repetida sobre o banco atualizado.
import http from 'node:http';

const SEM_CORPO = new Set([101, 204, 205, 304]);
// cabeçalhos que não devem ser repassados como vieram (o servidor local define os seus)
const NAO_REPASSAR = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding', 'content-length', 'host',
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port', 'forwarded', 'x-real-ip',
]);
const NAO_DEVOLVER = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length']);
const LIMITE_RESPOSTA = 5.8 * 1024 * 1024; // a Netlify recusa respostas acima de ~6 MB

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, corpo, extra = {}) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store', ...extra } });

function encaminhar(porta, { metodo, caminho, cabecalhos, corpo }, limiteMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cabecalhos, agent: false }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes) }));
    });
    req.setTimeout(limiteMs, () => req.destroy(new Error('A requisição demorou demais.')));
    req.on('error', reject);
    if (corpo?.length) req.write(corpo);
    req.end();
  });
}

function paraResponse({ status, headers, corpo }) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (NAO_DEVOLVER.has(k)) continue;
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else if (v !== undefined) h.set(k, v);
  }
  return new Response(SEM_CORPO.has(status) ? null : corpo, { status, headers: h });
}

/**
 * @param opts.app                 aplicativo Express
 * @param opts.persistencia        PersistenciaBlobs
 * @param opts.db                  { escritas() }
 * @param opts.obterStore          () => store do Blobs (chamado a cada requisição)
 * @param opts.depoisDeSincronizar async () => void — roda depois de cada sincronização (ex.: redefinição de senha por variável)
 */
export function criarManipulador({ app, persistencia, db, obterStore, depoisDeSincronizar = null, maxTentativas = 4, orcamentoMs = 22000, log = console }) {
  let servidor = null;
  let porta = 0;
  let fila = Promise.resolve();

  async function garantirServidor() {
    if (servidor) return;
    const s = http.createServer(app);
    await new Promise((ok, erro) => { s.once('error', erro); s.listen(0, '127.0.0.1', ok); });
    servidor = s;
    porta = s.address().port;
  }

  async function tratar(req, ctx) {
    const inicio = Date.now();
    const url = new URL(req.url);
    const metodo = req.method.toUpperCase();
    // O corpo é lido uma vez só: se for preciso repetir a requisição, ele é reaproveitado.
    const corpo = metodo === 'GET' || metodo === 'HEAD' ? null : Buffer.from(await req.arrayBuffer());
    const hostPublico = req.headers.get('host') || url.host;
    const cabecalhos = {};
    req.headers.forEach((v, k) => { if (!NAO_REPASSAR.has(k.toLowerCase())) cabecalhos[k] = v; });
    Object.assign(cabecalhos, {
      host: hostPublico,
      'x-forwarded-proto': url.protocol.replace(':', ''),
      'x-forwarded-host': hostPublico,
      'x-forwarded-for': ctx?.ip || req.headers.get('x-nf-client-connection-ip') || '',
    });
    if (corpo) cabecalhos['content-length'] = String(corpo.length);
    const pedido = { metodo, caminho: url.pathname + url.search, cabecalhos, corpo };

    persistencia.usarStore(obterStore());
    await garantirServidor();

    for (let tentativa = 1; ; tentativa++) {
      let resposta;
      let antes;
      try {
        await persistencia.sincronizar();
        if (depoisDeSincronizar) await depoisDeSincronizar();
        antes = db.escritas();
        resposta = await encaminhar(porta, pedido, Math.max(2000, 26000 - (Date.now() - inicio)));
      } catch (e) {
        if (antes !== undefined && db.escritas() !== antes) persistencia.invalidar(); // gravações que não serão salvas
        log.error('[sem-servidor] erro ao atender', metodo, url.pathname, e);
        return json(502, { erro: 'O servidor não conseguiu responder agora. Tente de novo em instantes.' });
      }

      if (db.escritas() === antes) return resposta.corpo.length > LIMITE_RESPOSTA ? json(502, { erro: 'O arquivo gerado é grande demais para esta hospedagem (limite de cerca de 6 MB).' }) : paraResponse(resposta);

      // A requisição gravou algo no banco.
      if (resposta.status >= 500) {
        persistencia.invalidar(); // erro do servidor: nada do que ela gravou deve ser guardado
        return paraResponse(resposta);
      }
      if (resposta.corpo.length > LIMITE_RESPOSTA) {
        persistencia.invalidar();
        return json(502, { erro: 'O arquivo gerado é grande demais para esta hospedagem (limite de cerca de 6 MB).' });
      }
      try {
        await persistencia.enviarArquivosPendentes();
        if (await persistencia.confirmar()) return paraResponse(resposta);
      } catch (e) {
        persistencia.invalidar();
        log.error('[sem-servidor] não consegui salvar o banco:', e);
        return json(503, { erro: 'Não foi possível salvar agora. Nada foi alterado — tente de novo em instantes.' }, { 'retry-after': '3' });
      }
      // Conflito: outra pessoa salvou antes. Repete sobre o banco novo.
      if (tentativa >= maxTentativas || Date.now() - inicio > orcamentoMs) {
        return json(503, { erro: 'Muitas pessoas alteraram dados ao mesmo tempo. Nada foi alterado — tente de novo.' }, { 'retry-after': '2' });
      }
      await pausa(30 + Math.random() * 120);
    }
  }

  const manipulador = (req, ctx) => {
    // um acesso por vez dentro do mesmo servidor (a Netlify já faz isso; aqui é só segurança extra)
    const p = fila.then(() => tratar(req, ctx));
    fila = p.catch(() => {});
    return p;
  };
  manipulador.fechar = () => new Promise((ok) => (servidor ? servidor.close(() => ok()) : ok()));
  return manipulador;
}
