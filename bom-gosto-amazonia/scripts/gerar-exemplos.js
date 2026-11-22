// Gera arquivos de EXEMPLO (fictícios) em /samples para testar a importação:
//   NF-e (XML), planilha XLSX com várias abas, CSV do Excel brasileiro, PDF de devedores, comprovantes de Pix (PDF) e extrato OFX.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(raiz, 'samples');
fs.mkdirSync(out, { recursive: true });
const w = (nome, conteudo) => fs.writeFileSync(path.join(out, nome), conteudo);

// ------------------------------------------------------------ NF-e (XML)
function nfe({ n, chave, data, dest, itens, parcelas, tPag, vendedor }) {
  const total = itens.reduce((s, i) => s + i.q * i.v, 0);
  const det = itens.map((i, k) => `
      <det nItem="${k + 1}"><prod><cProd>${i.cod}</cProd><cEAN>SEM GTIN</cEAN><xProd>${i.nome}</xProd><NCM>20089900</NCM><CFOP>5102</CFOP><uCom>${i.un}</uCom><qCom>${i.q.toFixed(4)}</qCom><vUnCom>${i.v.toFixed(10)}</vUnCom><vProd>${(i.q * i.v).toFixed(2)}</vProd><uTrib>${i.un}</uTrib><qTrib>${i.q.toFixed(4)}</qTrib><vUnTrib>${i.v.toFixed(10)}</vUnTrib><indTot>1</indTot></prod></det>`).join('');
  const dups = parcelas.length ? `<cobr><fat><nFat>${n}</nFat><vOrig>${total.toFixed(2)}</vOrig><vLiq>${total.toFixed(2)}</vLiq></fat>${parcelas.map((p, k) => `<dup><nDup>${String(k + 1).padStart(3, '0')}</nDup><dVenc>${p.venc}</dVenc><vDup>${p.valor.toFixed(2)}</vDup></dup>`).join('')}</cobr>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}" versao="4.00">
  <ide><cUF>13</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>${data}T10:15:00-04:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe></ide>
  <emit><CNPJ>12345678000195</CNPJ><xNome>BOM GOSTO DA AMAZONIA LTDA</xNome></emit>
  <dest><CNPJ>${dest.cnpj}</CNPJ><xNome>${dest.nome}</xNome><enderDest><xLgr>${dest.rua}</xLgr><nro>100</nro><xBairro>Centro</xBairro><xMun>Manaus</xMun><fone>${dest.fone}</fone></enderDest></dest>${det}
  <total><ICMSTot><vProd>${total.toFixed(2)}</vProd><vDesc>0.00</vDesc><vNF>${total.toFixed(2)}</vNF></ICMSTot></total>
  ${dups}
  <pag><detPag><tPag>${tPag}</tPag><vPag>${total.toFixed(2)}</vPag></detPag></pag>
  <infAdic><infCpl>Pedido 4${n}. Vendedor: ${vendedor}. Obrigado pela preferencia.</infCpl></infAdic>
</infNFe></NFe><protNFe versao="4.00"><infProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`;
}
const itensA = [{ cod: 'P001', nome: 'POLPA DE ACAI 1KG', un: 'PCT', q: 40, v: 28 }, { cod: 'P002', nome: 'POLPA DE CUPUACU 1KG', un: 'PCT', q: 20, v: 24 }, { cod: 'P006', nome: 'FARINHA DE MANDIOCA 1KG', un: 'PCT', q: 30, v: 9 }];
w('nfe-001-mercadinho-souza.xml', nfe({ n: '1501', chave: '13261112345678000195550010000015011000015017', data: '2026-11-05', dest: { cnpj: '98765432000110', nome: 'MERCADINHO SOUZA LTDA', rua: 'Rua das Palmeiras', fone: '92988887777' }, itens: itensA, parcelas: [{ venc: '2026-12-05', valor: 935 }, { venc: '2027-01-05', valor: 935 }], tPag: '15', vendedor: 'Marcos Lima' }));
w('nfe-002-padaria-pao-de-ouro.xml', nfe({ n: '1502', chave: '13261112345678000195550010000015021000015024', data: '2026-11-09', dest: { cnpj: '11222333000144', nome: 'PADARIA PAO DE OURO ME', rua: 'Av. Brasil', fone: '92977776666' }, itens: [{ cod: 'P005', nome: 'CASTANHA-DO-PARA 500G', un: 'PCT', q: 25, v: 38 }, { cod: 'P010', nome: 'BISCOITO DE CASTANHA 200G', un: 'PCT', q: 40, v: 11 }], parcelas: [{ venc: '2026-12-09', valor: 1390 }], tPag: '15', vendedor: 'Ana Paula Souza' }));
w('nfe-003-restaurante-pix.xml', nfe({ n: '1503', chave: '13261112345678000195550010000015031000015031', data: '2026-11-12', dest: { cnpj: '55666777000188', nome: 'RESTAURANTE SABOR DA TERRA', rua: 'Rua do Comercio', fone: '92966665555' }, itens: [{ cod: 'P007', nome: 'TUCUPI 500ML', un: 'GF', q: 30, v: 14 }], parcelas: [], tPag: '17', vendedor: 'Carlos Monteiro' }));

// XML de CANCELAMENTO da NF-e 1501 (evento 110111): ao importar, a venda correspondente é cancelada
w('nfe-cancelamento-1501.xml', `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><evento versao="1.00"><infEvento Id="ID11011113261112345678000195550010000015011000015017">
<cOrgao>13</cOrgao><tpAmb>1</tpAmb><CNPJ>12345678000195</CNPJ><chNFe>13261112345678000195550010000015011000015017</chNFe><dhEvento>2026-11-20T10:00:00-04:00</dhEvento>
<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>113260000000001</nProt><xJust>Erro de digitacao no pedido</xJust></detEvento></infEvento></evento></procEventoNFe>`);

// ------------------------------------------------------------ CSV (Excel brasileiro: ; e Windows-1252)
const csv = [
  'Cliente;Vendedor;Data da Compra;Vencimento;Valor;Pago;Observação',
  'Mercadinho Souza;Marcos Lima;05/10/2026;05/11/2026;1.870,00;Sim;Pedido 1480',
  'Padaria Pão de Ouro;Ana Paula;12/10/2026;12/11/2026;"2.450,50";Não;',
  'Lanchonete Estrela do Norte;Carlos;18/10/2026;18/11/2026;780,00;não;Ligar na segunda',
  'Supermercado Amazonas;Juliana Ferreira;25/10/2026;25/12/2026;5.230,00;;',
  'Hotel Rio Negro;Rafael;02/11/2026;02/12/2026;1.120,90;Sim;Pagou no Pix',
  'Casa do Açaí Tropical;Marcos Lima;08/11/2026;08/12/2026;640,00;;',
  'TOTAL;;;;12.091,40;;',
].join('\r\n');
w('devedores-excel.csv', Buffer.from(csv, 'latin1'));

// ------------------------------------------------------------ XLSX com abas (Devedores, Vendas, Estoque)
{
  const wb = new ExcelJS.Workbook();
  const d = wb.addWorksheet('Devedores');
  d.addRow(['DEVEDORES — BOM GOSTO DA AMAZÔNIA']);
  d.addRow([]);
  d.addRow(['Cliente', 'Vendedor', 'Valor devido', 'Vencimento', 'Já pagou?', 'Telefone']);
  d.addRow(['Mercantil Boa Esperança', 'Marcos Lima', 1840.5, new Date(Date.UTC(2026, 10, 10)), 'não', '(92) 99888-1122']);
  d.addRow(['Sorveteria Gelo Fino', 'Ana Paula Souza', 2300, new Date(Date.UTC(2026, 10, 28)), 'não', '(92) 99777-3344']);
  d.addRow(['Mercado do Zé Maria', 'Carlos Monteiro', 975.25, new Date(Date.UTC(2026, 11, 15)), 'sim', '(92) 99666-5566']);
  d.addRow(['Empório Floresta Viva', 'Juliana Ferreira', 4120, new Date(Date.UTC(2026, 11, 20)), 'não', '']);
  const v = wb.addWorksheet('Vendas');
  v.addRow(['Data', 'Nº Pedido', 'Cliente', 'Vendedor', 'Produto', 'Qtd', 'Preço Unit.', 'Total', 'Forma de Pagamento']);
  v.addRow([new Date(Date.UTC(2026, 10, 3)), '2001', 'Atacadão do Norte', 'Rafael Nogueira', 'Polpa de Açaí 1kg', 50, 28, 1400, 'Prazo']);
  v.addRow([new Date(Date.UTC(2026, 10, 3)), '2001', 'Atacadão do Norte', 'Rafael Nogueira', 'Goma de Tapioca 1kg', 30, 12, 360, 'Prazo']);
  v.addRow([new Date(Date.UTC(2026, 10, 6)), '2002', 'Mini Box Central', 'Marcos Lima', 'Guaraná em Pó 100g', 12, 19, 228, 'Pix']);
  v.addRow([new Date(Date.UTC(2026, 10, 7)), '2003', 'Doceria Amor Cupuaçu', 'Ana Paula Souza', 'Doce de Cupuaçu 400g', 24, 16, 384, 'Dinheiro']);
  const e = wb.addWorksheet('Estoque');
  e.addRow(['Data', 'Produto', 'Entrada', 'Saída', 'Produzido', 'Retirada', 'Vendedor']);
  e.addRow([new Date(Date.UTC(2026, 10, 2)), 'Polpa de Açaí 1kg', 0, 0, 300, 0, '']);
  e.addRow([new Date(Date.UTC(2026, 10, 4)), 'Polpa de Açaí 1kg', 0, 0, 0, 60, 'Marcos Lima']);
  e.addRow([new Date(Date.UTC(2026, 10, 5)), 'Castanha-do-Pará 500g', 120, 0, 0, 0, '']);
  e.addRow([new Date(Date.UTC(2026, 10, 9)), 'Tucupi 500ml', 0, 40, 0, 0, '']);
  await wb.xlsx.writeFile(path.join(out, 'planilha-exemplo.xlsx'));
}

// ------------------------------------------------------------ PDFs
function pdf(nome, fn) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(path.join(out, nome));
    doc.pipe(stream);
    fn(doc);
    doc.end();
    stream.on('finish', resolve);
  });
}

await pdf('relatorio-devedores.pdf', (doc) => {
  doc.font('Helvetica-Bold').fontSize(14).text('Relatório de Contas a Receber', 40, 40);
  doc.font('Helvetica').fontSize(9).text('Emitido em 22/11/2026', 40, 60);
  const cols = [40, 200, 320, 410, 490];
  const head = ['Cliente', 'Vendedor', 'Vencimento', 'Valor', 'Situação'];
  let y = 90;
  doc.font('Helvetica-Bold').fontSize(9);
  head.forEach((h, i) => doc.text(h, cols[i], y, { lineBreak: false }));
  doc.moveTo(40, y + 14).lineTo(555, y + 14).stroke();
  y += 22;
  const linhas = [
    ['Frutaria Tambaqui', 'Marcos Lima', '10/11/2026', '1.250,00', 'Em aberto'],
    ['Pastelaria Estação Verde', 'Ana Paula Souza', '14/11/2026', '830,40', 'Em aberto'],
    ['Churrascaria Ribeirinha', 'Carlos Monteiro', '18/11/2026', '3.100,00', 'Pago'],
    ['Quitanda da Dona Raimunda', 'Juliana Ferreira', '25/11/2026', '460,00', 'Em aberto'],
    ['Buffet Sabores do Pará', 'Rafael Nogueira', '30/11/2026', '2.780,90', 'Em aberto'],
  ];
  doc.font('Helvetica').fontSize(9);
  for (const l of linhas) {
    l.forEach((c, i) => {
      if (i === 3) doc.text(c, cols[i], y, { width: 60, align: 'right', lineBreak: false });
      else doc.text(c, cols[i], y, { lineBreak: false });
    });
    y += 18;
  }
  doc.font('Helvetica-Bold').text('Total geral', 40, y + 6, { lineBreak: false });
  doc.text('8.421,30', 410, y + 6, { width: 60, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(8).text('Página 1 de 1', 40, 780, { lineBreak: false });
});

await pdf('comprovante-pix-nubank.pdf', (doc) => {
  const linha = (rot, val, y) => { doc.font('Helvetica').fontSize(10).fillColor('#555').text(rot, 50, y, { lineBreak: false }); doc.fillColor('#000').text(val, 200, y, { lineBreak: false }); };
  doc.font('Helvetica-Bold').fontSize(16).text('Comprovante de transferência', 50, 50);
  doc.font('Helvetica').fontSize(10).fillColor('#555').text('11 NOV 2026 - 14:32:10', 50, 78);
  linha('Valor', 'R$ 1.870,00', 110);
  linha('Tipo de transferência', 'Pix', 130);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('Destino', 50, 170);
  linha('Nome', 'Bom Gosto da Amazônia Ltda', 190); linha('CPF/CNPJ', '12.345.678/0001-95', 208); linha('Instituição', 'BANCO INTER S.A.', 226);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('Origem', 50, 266);
  linha('Nome', 'MERCADINHO SOUZA LTDA', 286); linha('CPF/CNPJ', '98.765.432/0001-10', 304); linha('Instituição', 'NU PAGAMENTOS - IP', 322);
  linha('ID da transação', 'E18236120202611111732s0a1b2c3d4e', 362);
});

await pdf('comprovante-pix-banco.pdf', (doc) => {
  doc.font('Helvetica-Bold').fontSize(15).text('Comprovante de Pix', 50, 50);
  doc.font('Helvetica').fontSize(10);
  doc.text('Valor: R$ 2.450,50', 50, 90, { lineBreak: false });
  doc.text('Data da transferência: 13/11/2026 09:41', 50, 108, { lineBreak: false });
  doc.font('Helvetica-Bold').text('Quem pagou', 50, 140);
  doc.font('Helvetica').text('Nome: PADARIA PAO DE OURO ME', 50, 158, { lineBreak: false });
  doc.text('CNPJ: 11.222.333/0001-44', 50, 174, { lineBreak: false });
  doc.text('Instituição: ITAU UNIBANCO S.A.', 50, 190, { lineBreak: false });
  doc.font('Helvetica-Bold').text('Quem recebeu', 50, 222);
  doc.font('Helvetica').text('Nome: BOM GOSTO DA AMAZONIA LTDA', 50, 240, { lineBreak: false });
  doc.text('ID da transação: E60701190202611131241Zq8W7e6R5t4', 50, 280, { lineBreak: false });
});

// ------------------------------------------------------------ OFX
const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>20261122120000</DTSERVER><LANGUAGE>POR</LANGUAGE><FI><ORG>Banco Inter</ORG></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261110120000[-3:BRT]</DTPOSTED><TRNAMT>1250.00</TRNAMT><FITID>20261110001</FITID><MEMO>PIX RECEBIDO - FRUTARIA TAMBAQUI</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261112120000[-3:BRT]</DTPOSTED><TRNAMT>780.00</TRNAMT><FITID>20261112002</FITID><MEMO>PIX RECEBIDO - LANCHONETE ESTRELA DO NORTE</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261113120000[-3:BRT]</DTPOSTED><TRNAMT>-540.00</TRNAMT><FITID>20261113003</FITID><MEMO>PAGTO FORNECEDOR EMBALAGENS</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261116120000[-3:BRT]</DTPOSTED><TRNAMT>3100.00</TRNAMT><FITID>20261116004</FITID><MEMO>TRANSF PIX - CHURRASCARIA RIBEIRINHA</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261118120000[-3:BRT]</DTPOSTED><TRNAMT>460.00</TRNAMT><FITID>20261118005</FITID><MEMO>PIX RECEBIDO - QUITANDA DA D RAIMUNDA</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`;
w('extrato-banco.ofx', ofx);

console.log('Exemplos gerados em', out, '\n ', fs.readdirSync(out).join('\n  '));
