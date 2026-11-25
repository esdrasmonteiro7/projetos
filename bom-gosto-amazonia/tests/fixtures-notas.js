// Arquivos de TESTE no mesmo formato dos que a empresa recebe (XML de NF-e, relatório de vendas do sistema e relatório de boletos do
// Sicoob), mas com dados inventados.
import PDFDocument from 'pdfkit';

const CNPJ_EMITENTE = '02692153000172';

/** Chave de acesso de 44 dígitos com o número da nota no lugar certo (posições 25 a 33). */
export const chaveDaNota = (numero) => `1326110269215300017255001${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}${numero % 10}`;

/**
 * @param itens    [{ codigo, descricao, qtd, preco }]
 * @param parcelas [{ venc: 'AAAA-MM-DD', valor: 123.45 }]  (vazio = à vista)
 */
export function xmlNFe({ numero, data, cliente, itens, parcelas = [], status = '100', natureza }) {
  const total = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const det = itens.map((i, k) => `<det nItem="${k + 1}"><prod><cProd>${i.codigo}</cProd><cEAN>${i.codigo}</cEAN><xProd>${i.descricao}</xProd><uCom>cx</uCom><qCom>${i.qtd.toFixed(4)}</qCom><vUnCom>${i.preco.toFixed(10)}</vUnCom><vProd>${(i.qtd * i.preco).toFixed(2)}</vProd></prod></det>`).join('');
  const dup = parcelas.map((p, k) => `<dup><nDup>${String(k + 1).padStart(3, '0')}</nDup><dVenc>${p.venc}</dVenc><vDup>${p.valor.toFixed(2)}</vDup></dup>`).join('');
  const aVista = !parcelas.length;
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chaveDaNota(numero)}" versao="4.00">
<ide><natOp>${natureza || (aVista ? 'Venda a vista' : 'Venda a prazo')}</natOp><mod>55</mod><serie>1</serie><nNF>${String(numero).padStart(9, '0')}</nNF><dhEmi>${data}T10:00:00-04:00</dhEmi><finNFe>1</finNFe></ide>
<emit><CNPJ>${CNPJ_EMITENTE}</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></emit>
<dest><CNPJ>${cliente.doc}</CNPJ><xNome>${cliente.nome}</xNome><enderDest><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><xMun>${cliente.cidade || 'MANAUS'}</xMun><fone>${cliente.fone || '9291111111'}</fone></enderDest></dest>
${det}
<total><ICMSTot><vProd>${total.toFixed(2)}</vProd><vNF>${total.toFixed(2)}</vNF></ICMSTot></total>
${parcelas.length ? `<cobr><fat><nFat>${numero}</nFat></fat>${dup}</cobr>` : ''}
<pag><detPag><tPag>${aVista ? '01' : '15'}</tPag><vPag>${total.toFixed(2)}</vPag></detPag></pag>
</infNFe></NFe><protNFe versao="4.00"><infProt><cStat>${status}</cStat><xMotivo>${status === '100' ? 'Autorizado o uso da NF-e' : 'Rejeicao: Irregularidade fiscal do destinatario'}</xMotivo></infProt></protNFe></nfeProc>`;
}

export const xmlCancelamento = (numero) => `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00"><infEvento><chNFe>${chaveDaNota(numero)}</chNFe><tpEvento>110111</tpEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><xJust>Erro no Preenchimento</xJust></detEvento></infEvento></evento></procEventoNFe>`;

// ------------------------------------------------------------------ PDFs
const pdfParaBuffer = (doc) => new Promise((resolve) => { const partes = []; doc.on('data', (c) => partes.push(c)); doc.on('end', () => resolve(Buffer.concat(partes))); doc.end(); });
const real = (centavos) => (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

/**
 * "Relatório de vendas totalizado por nota": o sistema CORTA o ano da data ("24/11/202") e o nome do cliente na coluna, e o
 * vendedor começa logo depois (o leitor de PDF devolve cliente + vendedor num texto só quando o nome ocupa a coluna inteira).
 * @param linhas [{ data: 'AAAA-MM-DD', nota, cliente, vendedor, prazo: true|false, valor: centavos }]
 */
export function pdfRelatorioVendas(linhas, { de = '2026-11-01', ate = '2026-11-25' } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 14 });
  doc.font('Helvetica').fontSize(10);
  const br = (iso) => iso.split('-').reverse().join('/');
  doc.text('25/11/2026', 14.2, 40, { lineBreak: false }); doc.text('EMPRESA TESTE', 252, 40, { lineBreak: false });
  doc.text('Página 1', 14.2, 52, { lineBreak: false }); doc.text(`Relatório de vendas totalizado por nota - Período: ${br(de)} a ${br(ate)}`, 131.5, 52, { lineBreak: false });
  const cab = (y) => { [['Data', 14.2], ['Nota', 67], ['Cliente', 94.7], ['Vendedor', 205.8], ['Tipo de saída', 303], ['Tipo de recebimento', 400.2], ['Valor total', 508.3]].forEach(([t, x]) => doc.text(t, x, y, { lineBreak: false })); };
  cab(71);
  let y = 88;
  let soma = 0;
  for (const l of linhas) {
    soma += l.valor;
    doc.text(`${br(l.data).slice(0, 9)}`, 14.2, y, { lineBreak: false }); // ano cortado: "24/11/202"
    doc.text(String(l.nota ?? 0), 67, y, { lineBreak: false });
    let cli = l.cliente; // corta na largura da coluna (111 pt)
    while (doc.widthOfString(cli) > 108) cli = cli.slice(0, -1);
    doc.text(cli, 94.7, y, { lineBreak: false });
    doc.text(l.vendedor, 205.8, y, { lineBreak: false });
    doc.text(l.prazo === false ? 'Venda a vista' : 'Venda a prazo', 303, y, { lineBreak: false });
    doc.text(l.prazo === false ? 'Dinheiro' : 'A prazo', 400.2, y, { lineBreak: false });
    const v = real(l.valor);
    doc.text(v, 553 - doc.widthOfString(v), y, { lineBreak: false });
    y += 11;
  }
  doc.text('Total', 14.2, y + 6, { lineBreak: false });
  const t = real(soma);
  doc.text(t, 553 - doc.widthOfString(t), y + 6, { lineBreak: false });
  return pdfParaBuffer(doc);
}

/**
 * Sicoobnet "Títulos por Período" (tipo "Vencido"): página girada em 90° (relatório "deitado"), como o banco gera.
 * @param linhas [{ sacado, nosso, seu, entrada, venc: 'AAAA-MM-DD', valor: centavos }]
 */
export function pdfSicoobVencidos(linhas, { de = '2026-11-01', ate = '2026-11-24', consulta = 'Vencido' } = {}) {
  const doc = new PDFDocument({ size: [595, 842], margin: 0 });
  doc.page.dictionary.data.Rotate = 90; // a página é retrato, mas o conteúdo aparece deitado
  doc.font('Helvetica').fontSize(10);
  const br = (iso) => iso.split('-').reverse().join('/');
  // (x, y) como a pessoa vê a página deitada (842 de largura por 595 de altura, y para baixo) → espaço girado do PDF
  const T = (t, x, y) => { doc.save(); doc.translate(y, 842 - x); doc.rotate(-90, { origin: [0, 0] }); doc.text(t, 0, -10, { lineBreak: false }); doc.restore(); };
  T('Relatório - Títulos por Período', 52, 40);
  T('Cedente:', 28, 105); T('3902676 - EMPRESA TESTE LTDA', 127, 105);
  T('Tipo Consulta:', 28, 122); T(consulta, 127, 122); T('Data Inicial:', 278, 122); T(br(de), 360, 122); T('Data Final:', 491, 122); T(br(ate), 574, 122);
  T('Conta Corrente:', 28, 140); T('830950', 127, 140); T('Nº de Contrato:', 491, 140); T('1278788', 574, 140);
  [['Sacado', 153], ['Nosso Número', 316], ['Seu Número', 415], ['Entrada', 513], ['Vencimento', 571], ['Dt. Limite Pgto', 639], ['Valor (R$)', 740]].forEach(([t, x]) => T(t, x, 164));
  let y = 189;
  let soma = 0;
  for (const l of linhas) {
    soma += l.valor;
    T(l.sacado, 31, y); T(l.nosso, 341, y); T(l.seu, 426, y); T(br(l.entrada), 507, y); T(br(l.venc), 574, y);
    const v = real(l.valor);
    T(v, 811 - doc.widthOfString(v), y);
    y += 28;
  }
  T('Total de Registros:', 660, y + 20); T(String(linhas.length), 780, y + 20);
  T('Total de Valores:', 660, y + 34); T(real(soma), 760, y + 34);
  return pdfParaBuffer(doc);
}
