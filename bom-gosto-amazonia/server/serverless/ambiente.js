// Precisa ser o PRIMEIRO import da função da Netlify: ajusta o ambiente antes de o painel ler as configurações.
process.env.PAINEL_SERVERLESS = '1';
process.env.NODE_ENV ||= 'production';
process.env.DATA_DIR ||= '/tmp/painel'; // na Netlify só /tmp é gravável (e é temporário)
process.env.TRUST_PROXY ||= '1';
// O código vai empacotado em um arquivo só; os recursos (logo e fontes do PDF) ficam na pasta da função (/var/task).
if (process.env.LAMBDA_TASK_ROOT) process.env.PAINEL_ROOT ||= process.env.LAMBDA_TASK_ROOT;
