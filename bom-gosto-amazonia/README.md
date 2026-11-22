# Painel Bom Gosto da Amazônia

Sistema **web** (abre no navegador do computador ou do celular, sem instalar nada) para controlar **vendas, devedores, Pix, depósito e produção**, com login para os administradores e para cada vendedor.

![Painel](docs/telas/01-painel.png)

## O que ele faz

| Área | O que você consegue |
|---|---|
| **Painel** | Vendido no mês, recebido, em aberto, vencido, quanto vence no mês seguinte, retiradas, previsão de recebimento dos próximos meses, resultado por vendedor, maiores devedores. |
| **Vendas** | Lançar venda (à vista ou a prazo com parcelas), cliente novo na hora, itens do catálogo, cancelar, exportar para Excel. |
| **A receber (devedores)** | Todas as dívidas: em aberto, vencidas, a vencer, pagas. **Dar baixa** (total ou parcial), baixa em lote, **cobrar por WhatsApp** com mensagem pronta, ver por cliente. |
| **Recebimentos (Pix)** | Pagamentos que entraram. O painel **sugere em qual dívida cada Pix entra** (compara nome e valor, inclusive 2 ou 3 parcelas juntas) e dá baixa com 1 clique. Vendedor avisa "cliente pagou" e o administrador confirma. |
| **Importar arquivos** | Jogue **PDF, XML de nota fiscal (NF-e), planilha Excel, CSV, extrato OFX e comprovantes de Pix**. O painel lê, separa por vendedor, avisa o que está repetido e mostra uma **prévia** antes de gravar. Qualquer importação pode ser **desfeita**. |
| **Depósito e produção** | Entradas, saídas, perdas, **retiradas dos vendedores** (e devoluções), produção **planejada × produzida** (mostra o que **não foi produzido**), estoque atual, estoque mínimo. |
| **Relatório em PDF** | PDF bonito e direto: 1ª página com **vendido, em aberto, a receber no mês seguinte e retiradas**; páginas opcionais por vendedor e do depósito. Dá para abrir, baixar ou compartilhar no WhatsApp. |
| **Cadastros e acessos** | Vendedores, clientes, produtos, usuários. Administradores veem tudo; **cada vendedor só vê os próprios clientes, vendas e dívidas**. |
| **Segurança** | Histórico de quem fez o quê, backup com um clique, senha protegida, bloqueio de tentativas erradas. |

Mais telas em [`docs/telas`](docs/telas) e um exemplo do PDF em [`docs/exemplo-relatorio-novembro-2026.pdf`](docs/exemplo-relatorio-novembro-2026.pdf).

---

## Identidade visual (logo e cores da marca)

O painel e o PDF usam a logo e as cores da **Bom Gosto da Amazônia**:

| Cor | Código | Onde aparece |
|---|---|---|
| Vinho (da logo) | `#A6050F` | botões, menu ativo, gráficos (vendido) |
| Vinho escuro | `#3F050B` → `#7D0A14` | menu lateral, cabeçalho do PDF |
| Dourado do trigo | `#F7A511` | detalhes, nome "da Amazônia", gráficos (recebido: `#D98E00`) |

Verde continua significando **pago/ok** e vermelho de alerta significa **atrasado**, para não confundir com a cor da marca.
A logo original está em [`docs/marca/`](docs/marca) (e a versão redonda usada nas telas, em `public/img/`). Para trocar a logo no futuro, substitua esses arquivos e as cores em `public/css/app.css` (variáveis `--br*`) e `server/services/relatorio-pdf.js`.

---

## 1. Testar no seu computador (opcional)

Precisa do [Node.js 22](https://nodejs.org) instalado.

```bash
cd bom-gosto-amazonia
npm install
# cria dados FICTÍCIOS só para conhecer o painel:
DATA_DIR=./data-demo npm run demo
DATA_DIR=./data-demo npm start
```
Windows (PowerShell): `$env:DATA_DIR="./data-demo"; npm run demo; npm start`

Abra <http://localhost:3000> e entre com **admin@demo.com / demo12345** (vendedor de teste: **marcos@demo.com / demo12345**).
Na pasta [`samples/`](samples) há arquivos de exemplo (NF-e, planilha, PDF, Pix, extrato) para testar a importação.

---

## 2. Colocar na internet

Este sistema precisa de um **servidor** e de um **banco de dados** — por isso o `web.app` do Firebase (que só hospeda sites estáticos de graça) não serve sem cartão de crédito. A forma **grátis e sem cartão** que está **no ar** é a **Netlify** (Opção A). As demais opções ficam como alternativa.

### Opção A — Netlify (no ar) · grátis, sem cartão

**Endereço:** `https://bom-gosto-amazonia.netlify.app` (dá para trocar o nome do endereço em *Site configuration → Change project name*).

**Como funciona por dentro**
* As telas (HTML, CSS, JS, imagens) são servidas direto pela rede da Netlify; toda a API roda numa *função* da Netlify (`netlify/functions/api.mjs`).
* O banco de dados (SQLite) fica guardado no **Netlify Blobs**. **Cada alteração é salva antes de o painel responder** — nunca aparece "salvo" sem ter salvo.
* Se duas pessoas salvam ao mesmo tempo, a gravação da segunda é recusada e a operação é **refeita automaticamente** sobre os dados novos: ninguém sobrescreve o trabalho do outro (há testes automáticos para isso).
* **Cópia diária** do banco (as últimas 30 ficam guardadas) e os **arquivos enviados** (PDFs, XMLs, comprovantes) também ficam no Blobs.
* O limite de tentativas de senha vale para todos os acessos (fica no banco).

**Limites do plano grátis (bom saber)**
* Cada envio aceita até ~**4,5 MB** — a tela de importação divide os arquivos em lotes sozinha; um arquivo único maior que isso precisa ser dividido ou compactado em ZIP.
* Cada ação tem até 30 segundos; respostas até ~6 MB (um PDF de relatório tem algumas centenas de KB).
* A Netlify dá uma franquia mensal de uso (300 "créditos" no plano grátis; para o uso deste painel sobra muito). Se um dia acabar, o site pausa até o próximo ciclo — veja em *Team → Usage*.
* O primeiro acesso depois de um tempo parado leva ~1 segundo a mais.

**Primeiro acesso:** abra o endereço → **Primeiro acesso** → informe o **código de instalação** (valor da variável `SETUP_CODE`, em *Site configuration → Environment variables*) e crie o administrador. O código só vale enquanto não existe nenhum usuário.

**Atualizar o painel (publicar uma nova versão)** — num computador com Node 22:
```bash
cd bom-gosto-amazonia
npm install
npm run netlify:build
npx netlify-cli login                 # só na primeira vez
npx netlify-cli deploy --prod --dir dist-netlify --functions netlify/functions --site bom-gosto-amazonia --no-build
```
Cada publicação gasta 15 dos 300 créditos mensais; não precisa publicar à toa. Os dados **não** são afetados por publicações.

**Esqueceu a senha** e não há outro administrador? Em *Environment variables* crie `REDEFINIR_SENHA_EMAIL` (seu e-mail) e `REDEFINIR_SENHA_NOVA` (senha provisória), faça uma nova publicação (comando acima), entre com a provisória e depois **apague as duas variáveis**.

**Ver, baixar ou restaurar os dados** (suporte): `node scripts/netlify-blobs.mjs` mostra os comandos (`listar`, `baixar`, `baixar-copia 2026-11-22`, `restaurar`, `zerar`). Precisa de `NETLIFY_AUTH_TOKEN` e `NETLIFY_SITE_ID`.

**Importante:** não apague o site na Netlify — os dados ficam guardados no site. E continue baixando um **backup toda semana** (*Configurações e backup*): é a garantia extra, fora da Netlify.

### Opção B — Render grátis, sem cartão (com backup no GitHub)

**Endereço:** `https://bomgosto-painel.onrender.com` (ou outro nome livre que você escolher; domínio próprio pode ser ligado depois).

1. **O código precisa estar no seu GitHub** (repositório `projetos`). Se o envio automático não funcionar, no GitHub use *Add file → Upload files* e arraste o conteúdo do `.zip`.
2. **Crie o repositório de backup:** GitHub → **New repository** → nome `bomgosto-backup` → marque **Private** e **Add a README file** → Create.
3. **Crie o token do backup:** GitHub → sua foto → *Settings* → *Developer settings* → *Personal access tokens* → **Fine-grained tokens** → *Generate new token*:
   nome `painel-backup`; validade 1 ano (anote um lembrete para renovar); *Repository access* → **Only select repositories** → `bomgosto-backup`; *Permissions → Repository permissions* → **Contents: Read and write**. Gere e **copie o token** (começa com `github_pat_`).
4. **Render:** crie a conta em [render.com](https://render.com) entrando **com o GitHub** → **New + → Blueprint** → escolha o repositório `projetos` (autorize o acesso) e a branch que tem o painel → preencha:
   * `SETUP_CODE`: um código secreto e longo, só seu;
   * `BACKUP_GITHUB_REPO`: `seuusuario/bomgosto-backup`;
   * `BACKUP_GITHUB_TOKEN`: o token do passo 3 → **Apply**.
5. Quando terminar o primeiro deploy, abra o endereço → **Primeiro acesso** → crie o administrador (com o `SETUP_CODE`).
6. **Muito importante:** na Render, abra o serviço → **Environment** → copie o valor de **`BACKUP_KEY`** e guarde em lugar seguro (gerenciador de senhas). É a senha que protege os backups; sem ela eles não podem ser restaurados.
7. Em **Configurações e backup**, confira que aparece *"Último backup: …"*. Se aparecer um aviso vermelho no topo do painel, há algo errado com o backup — leia a mensagem.

**Como fica no dia a dia**
* Depois de **qualquer alteração**, o painel envia um novo backup em ~15 segundos (e ao desligar). Se o serviço reiniciar ou "dormir", ao voltar ele **restaura sozinho** o último backup (e não inicia com banco vazio se não conseguir restaurar).
* O plano grátis **dorme após 15 minutos sem acesso** e leva cerca de 1 minuto para acordar no próximo acesso. Para evitar, crie um monitor gratuito no [UptimeRobot](https://uptimerobot.com) apontando para `https://SEU-ENDERECO.onrender.com/api/sessao` a cada 5 minutos (a Render dá 750 horas grátis por mês — suficiente para 1 serviço ligado o mês todo).
* **O que NÃO é guardado no plano grátis:** os arquivos originais enviados (PDFs, XMLs, comprovantes). Todos os **dados** (vendas, dívidas, pagamentos, estoque…) ficam salvos. Para guardar também os arquivos, use um disco permanente (opção C).
* Evite usar o painel durante uma atualização do código (deploy): alterações dos últimos segundos antes de reiniciar podem não entrar no backup.
* **Esqueceu a senha** e não há outro administrador? Na Render → **Environment**, crie `REDEFINIR_SENHA_EMAIL` (seu e-mail) e `REDEFINIR_SENHA_NOVA` (uma senha provisória), salve, entre com ela e depois **apague as duas variáveis**.

### Opção C — Plano pago com disco permanente (mais simples e seguro)
Na Render, troque o plano do serviço para **Starter** (a partir de ~US$ 7/mês) e acrescente um **disco** de 1–5 GB montado em `/data` (~US$ 0,25 por GB/mês; confira em <https://render.com/pricing>). Os dados e os arquivos ficam no disco; o backup no GitHub continua funcionando como **cópia extra fora do servidor**. Mantenha `DATA_DIR=/data`.

### Opção D — Outros serviços
* **Google Cloud (Cloud Run + Firebase Hosting `web.app`)** e **Oracle Cloud (VM "Always Free")** têm camadas gratuitas, mas **exigem cartão** para criar a conta. Dá para usar o mesmo `Dockerfile`; me avise se preferir um desses.
* Qualquer servidor com Docker serve: monte um disco em `/data` e defina `SETUP_CODE`.

---

## 3. Primeiros passos no painel

1. **Configurações:** confira o nome da empresa, o **fuso horário** (Manaus, Belém…), o CNPJ e a mensagem de cobrança do WhatsApp.
2. **Usuários e acessos:** crie os outros **administradores** (ex.: Peterson e Seu Messias). Eles entram com e-mail e senha provisória e trocam no primeiro acesso.
3. **Vendedores:** cadastre cada vendedor (marque *Criar acesso* se ele for usar o painel). A **comissão %** aparece como estimativa no painel.
4. **Produtos:** cadastre o catálogo com preço, custo e estoque mínimo.
5. **Alimentar os dados:** lance à mão (*Vendas*, *Lançar dívida*, *Nova movimentação*) **ou** use **Importar arquivos**.

## 4. Importando arquivos

| Arquivo | O que o painel faz |
|---|---|
| **XML de NF-e** (pode enviar vários, ou um `.zip`) | Cria a venda com cliente, itens, valor e **parcelas/vencimentos**. Se a nota tiver "Vendedor: Nome" nas informações adicionais, já atribui ao vendedor. Notas canceladas (XML de evento) cancelam a venda. |
| **Planilha Excel (.xlsx)** | Cada **aba** é lida separadamente e o tipo é identificado (devedores, vendas, depósito, clientes, produtos). Entende "Sim/Não" em *Pago*, datas, valores com vírgula. |
| **CSV** do Excel brasileiro | Separador `;` e acentos (Windows-1252) são reconhecidos automaticamente. |
| **PDF de relatório** (com texto) | Lê como tabela (colunas, linhas, totais ignorados, seções "Vendedor: …"). |
| **Comprovante de Pix (PDF)** | Lê valor, data, **quem pagou**, banco e código da transação; anexa o PDF ao recebimento. Vários comprovantes viram uma única importação. |
| **Extrato bancário OFX** | Só as **entradas** viram recebimentos. |

**Sempre há uma prévia.** Você confere os dados, ajusta (tipo de dado, colunas, vendedor de cada nome, clientes parecidos) e só então confirma. Linhas repetidas vêm desmarcadas. Depois de importar é possível **desfazer**.

O painel **dá baixa automática** quando o Pix tem **nome e valor batendo** com uma dívida do mesmo cliente. Os demais ficam em *Recebimentos → A conciliar* com sugestões.

**Limites conhecidos:** PDF que é foto/escaneado (sem texto) não pode ser lido; planilha antiga `.xls` precisa ser salva como `.xlsx`; cada banco desenha o comprovante de um jeito — se algum não for lido direito, a prévia deixa você preencher o que faltar, e basta enviar um exemplo para a leitura ser ajustada.

## 5. Como os números são calculados

* **Vendido no mês:** soma das vendas ativas com data no mês.
* **Recebido no mês:** soma dos pagamentos confirmados com data no mês.
* **Em aberto:** tudo que ainda falta pagar nas dívidas (hoje, de qualquer mês).
* **Vencido:** parte do "em aberto" cujo vencimento já passou (usa o fuso da empresa).
* **A receber no mês seguinte:** dívidas em aberto que **vencem** no mês seguinte ao escolhido.
* **Retiradas:** unidades retiradas do depósito por vendedores no mês (devoluções aparecem à parte; "em mãos" = retirado − devolvido).
* **Não produzido:** quanto faltou para completar o que foi planejado na produção.
* **Comissão estimada:** % do vendedor sobre o que ele **recebeu** no mês.

## 6. Segurança e cópia de segurança

* **Dados guardados na nuvem** (Netlify: salvos a cada alteração + cópia diária) ou **backup automático no GitHub** (Render) — seção 2. Além disso, **baixe um backup toda semana:** *Configurações e backup → Baixar backup agora* (arquivo com todos os dados) e guarde no Google Drive.
* Cada vendedor só acessa os próprios dados (testado automaticamente). Senhas são guardadas criptografadas; após 8 tentativas erradas o login é bloqueado por 15 minutos (o bloqueio vale para todos os acessos).
* Esqueceu a senha? Outro administrador redefine em *Usuários e acessos*. Se for o único: veja "Esqueceu a senha" na seção 2 (variáveis `REDEFINIR_SENHA_*`) ou, com acesso ao terminal do servidor, `node scripts/redefinir-senha.js email@exemplo.com NovaSenha123`.
* Os arquivos enviados (PDF, XML…) ficam no servidor em `/data/uploads` (ou no Netlify Blobs, na Netlify).

## 7. Para quem for mexer no código

* **Tecnologia:** Node.js 22 + Express, banco SQLite (arquivo único em `DATA_DIR/painel.db`; na Netlify, guardado no Blobs), front-end em Preact sem etapa de build, PDF com PDFKit, leitura de PDF com pdf.js.
* **Pastas:** `server/` (API, regras, importação, PDF), `shared/` (dinheiro, datas e nomes — usado no servidor **e** no navegador), `public/` (telas), `server/serverless/` (modo Netlify: persistência no Blobs e ponte com o Express), `netlify/functions/` (a função), `scripts/` (demonstração, exemplos, recuperação de senha, build e suporte da Netlify), `tests/`.
* **Dinheiro** é sempre guardado em **centavos** (inteiro). Datas em `AAAA-MM-DD`.
* **Testes:** `npm test` (66 testes: segurança, isolamento entre vendedores, vendas/baixas, depósito, importação de todos os formatos, PDF e o modo Netlify — gravação no Blobs, conflito entre dois acessos, falha de rede, cópia diária).
* **Variáveis:** veja [`.env.example`](.env.example).
