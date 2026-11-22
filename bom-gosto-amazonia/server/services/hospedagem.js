// Ganchos da hospedagem "sem servidor" (Netlify). No modo normal (computador, Docker, Render) nada disso é usado.
//
// Na Netlify o disco é temporário e some entre um acesso e outro. Por isso o banco de dados e os arquivos enviados
// (comprovantes, PDFs, planilhas) ficam guardados no Netlify Blobs. Este objeto é o "ponto de ligação": o código do
// painel só chama estes ganchos e quem os preenche é server/serverless/persistencia.js.
export const hospedagem = {
  /** Chamado depois que um arquivo enviado foi gravado no disco temporário (caminho relativo dentro de uploads). */
  aoSalvarArquivo: (_caminho) => {},
  /** Procura no armazenamento externo um arquivo que não está no disco temporário. Devolve Buffer ou null. */
  buscarArquivo: async (_caminho) => null,
  /** Informações para a tela de Configurações (ou null no modo normal). */
  info: () => null,
};
