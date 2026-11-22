// Função da Netlify que atende TODA a API do painel (/api/*). Os arquivos do site (HTML, JS, CSS, imagens)
// são servidos direto pela rede da Netlify, sem passar por aqui.
import '../../server/serverless/ambiente.js'; // 1º: ajusta o ambiente antes do painel carregar
import { getStore } from '@netlify/blobs';
import { montarSemServidor } from '../../server/serverless/montar.js';

// O Blobs é criado a cada requisição (o acesso vem do contexto dela). "strong" = sempre lê a versão mais recente.
const { manipulador } = montarSemServidor({ obterStore: () => getStore({ name: 'painel', consistency: 'strong' }) });

export default (req, context) => manipulador(req, context);

export const config = { path: '/api/*' };
