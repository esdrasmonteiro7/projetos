// Ferramenta de suporte para o painel hospedado na Netlify: ver, baixar, restaurar e zerar os dados guardados no Netlify Blobs.
//
// Precisa de duas variáveis de ambiente:
//   NETLIFY_AUTH_TOKEN  chave pessoal da Netlify (app.netlify.com/user/applications → New access token)
//   NETLIFY_SITE_ID     ID do site (Netlify → Site configuration → Site ID)
//
// Comandos:
//   node scripts/netlify-blobs.mjs listar                       mostra tudo que está guardado (banco, cópias diárias, arquivos)
//   node scripts/netlify-blobs.mjs baixar [saida.db]            baixa o banco atual, já descompactado (abre em qualquer visualizador SQLite)
//   node scripts/netlify-blobs.mjs baixar-copia 2026-11-22      baixa a cópia diária de um dia
//   node scripts/netlify-blobs.mjs restaurar arquivo.db --sim   SUBSTITUI o banco atual por este arquivo (.db ou .db.gz)
//   node scripts/netlify-blobs.mjs zerar --sim                  APAGA TUDO (banco, cópias e arquivos) — o painel volta ao "primeiro acesso"
import fs from 'node:fs';
import zlib from 'node:zlib';
import { getStore } from '@netlify/blobs';

const [comando, arg, ...resto] = process.argv.slice(2);
const sim = [arg, ...resto].includes('--sim');
const token = process.env.NETLIFY_AUTH_TOKEN;
const siteID = process.env.NETLIFY_SITE_ID;
if (!comando || !token || !siteID) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(comando ? 1 : 0);
}
const store = getStore({ name: 'painel', siteID, token, consistency: 'strong' });
const CHAVE = 'banco/painel.db.gz';

const baixar = async (chave, saida) => {
  const ab = await store.get(chave, { type: 'arrayBuffer' });
  if (!ab) throw new Error(`Não existe: ${chave}`);
  fs.writeFileSync(saida, zlib.gunzipSync(Buffer.from(ab)));
  console.log(`Salvo em ${saida} (${fs.statSync(saida).size} bytes)`);
};

if (comando === 'listar') {
  const { blobs } = await store.list();
  const grupos = {};
  for (const b of blobs) (grupos[b.key.split('/')[0]] ||= []).push(b.key);
  for (const [g, chaves] of Object.entries(grupos)) console.log(`${g}: ${chaves.length} item(ns)${g === 'arquivos' ? '' : '\n  ' + chaves.join('\n  ')}`);
  if (!blobs.length) console.log('Nada guardado ainda (o painel está no "primeiro acesso").');
} else if (comando === 'baixar') {
  await baixar(CHAVE, arg && !arg.startsWith('--') ? arg : `painel-${new Date().toISOString().slice(0, 10)}.db`);
} else if (comando === 'baixar-copia') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg || '')) throw new Error('Informe o dia assim: 2026-11-22');
  await baixar(`copias/${arg}.db.gz`, `painel-copia-${arg}.db`);
} else if (comando === 'restaurar') {
  if (!arg || arg.startsWith('--')) throw new Error('Informe o arquivo (.db ou .db.gz).');
  const bruto = fs.readFileSync(arg);
  const db = arg.endsWith('.gz') ? zlib.gunzipSync(bruto) : bruto;
  if (db.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('Esse arquivo não é um banco SQLite do painel.');
  if (!sim) throw new Error('Isto SUBSTITUI todos os dados atuais pelos do arquivo. Para confirmar, repita o comando com --sim.');
  const atual = await store.get(CHAVE, { type: 'arrayBuffer' });
  if (atual) { fs.writeFileSync(`antes-de-restaurar-${Date.now()}.db.gz`, Buffer.from(atual)); console.log('Cópia dos dados atuais guardada neste computador (antes-de-restaurar-*.db.gz).'); }
  await store.set(CHAVE, zlib.gzipSync(db), { metadata: { gravado_em: new Date().toISOString() } });
  console.log('Banco restaurado.');
} else if (comando === 'zerar') {
  if (!sim) throw new Error('Isto APAGA todos os dados do painel. Para confirmar, repita o comando com --sim.');
  const { blobs } = await store.list();
  for (const b of blobs) await store.delete(b.key);
  console.log(`${blobs.length} item(ns) apagado(s). O painel volta ao "primeiro acesso".`);
} else {
  throw new Error(`Comando desconhecido: ${comando}`);
}
