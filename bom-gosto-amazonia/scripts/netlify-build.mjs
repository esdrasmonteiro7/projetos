// Monta a pasta do site para a Netlify (dist-netlify): páginas, scripts, estilos, imagens e fontes (public/ + shared/)
// e o arquivo _headers com os mesmos cabeçalhos de segurança do servidor. A API roda na função netlify/functions/api.mjs.
// Uso:  node scripts/netlify-build.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { middlewareSeguranca } from '../server/seguranca.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'dist-netlify');

fs.rmSync(saida, { recursive: true, force: true });
fs.cpSync(path.join(raiz, 'public'), saida, { recursive: true });
fs.cpSync(path.join(raiz, 'shared'), path.join(saida, 'shared'), { recursive: true });

// Cabeçalhos de segurança: pega exatamente o que o servidor envia (helmet), menos o HSTS (a Netlify já envia o dela).
const req = new http.IncomingMessage(null);
const res = new http.ServerResponse(req);
middlewareSeguranca(true)(req, res, () => {});
const cabecalhos = Object.entries(res.getHeaders()).filter(([k]) => k !== 'strict-transport-security');
cabecalhos.push(['x-robots-tag', 'noindex, nofollow']); // painel privado: nunca aparecer em buscas

const nomeBonito = (k) => k.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('-').replace('Csp', 'CSP');
const linhas = (lista) => lista.map(([k, v]) => `  ${nomeBonito(k)}: ${v}`).join('\n');
fs.writeFileSync(
  path.join(saida, '_headers'),
  `# Gerado por scripts/netlify-build.mjs — não edite à mão.\n/*\n${linhas(cabecalhos)}\n\n/fonts/*\n  Cache-Control: public, max-age=2592000, immutable\n`,
);

const contar = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? contar(path.join(dir, e.name)) : 1), 0);
console.log(`Site montado em ${path.relative(process.cwd(), saida) || saida}: ${contar(saida)} arquivos`);
