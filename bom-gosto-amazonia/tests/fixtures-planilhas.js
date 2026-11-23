// Planilhas de TESTE com o mesmo formato das que a empresa usa (Lista de Devedores e Controle), mas com dados inventados.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const dia = (iso) => new Date(`${iso}T12:00:00Z`);
const col = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const letraParaNum = (L) => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function put(ws, ref, valor, { data = false } = {}) {
  const c = ws.getCell(ref);
  c.value = data && typeof valor === 'string' ? dia(valor) : valor;
  if (data) c.numFmt = 'yyyy-mm-dd';
  return c;
}

// ------------------------------------------------------------------ Lista de Devedores
export async function construirDevedores() {
  const wb = new ExcelJS.Workbook();
  const nov = wb.addWorksheet('NOVEMBRO');
  ['SACADOS', 'NFE', 'ENTRADA', 'VENCIMENTO', 'VENDEDOR', 'VALOR', 'BOLETO', 'SITUAÇÃO', 'OBSERVAÇÃO', 'PAGAMENTO DATA', null, null, 'FATURAMENTO DO MÊS', null, 'COMPARATIVO'].forEach((h, i) => h && put(nov, `${col(i + 1)}1`, h));
  const linha = (ws, n, v) => v.forEach((x, i) => { if (x === null || x === undefined) return; const datas = [2, 3, 9]; put(ws, `${col(i + 1)}${n}`, x, { data: datas.includes(i) && typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) }); });
  linha(nov, 2, ['CLIENTE ALFA LTDA', '0821', '2026-11-04', '2026-11-18', 'HÉLIO', null, '70-1', 'PAGO', 'BOLETO PAGO', '2026-11-18', 1900]);
  linha(nov, 3, ['CLIENTE OMEGA LTDA', '0792', '2026-10-28', '2026-11-18', 'VALTER BRITO', 6860, '70-8', 'VENCIDO']);
  linha(nov, 4, ['CLIENTE SIGMA', '0793-01', '2026-10-28', '2026-11-18', 'BRITO', 1715, '71-0', 'VENCIDO']);
  linha(nov, 5, ['CLIENTE BETA LTDA', '0829', '2026-11-04', '2026-12-02', 'HÉLIO', 2210, '72-0', null]);
  linha(nov, 6, ['G DE V PEREA LTDA', '0751-02', '2026-10-21', '2026-11-04', 'ALESSANDRA', null, '67-0', 'BAIXADO', 'BAIXA A PEDIDO CEDENTE 04/11', '2026-11-04']);
  put(nov, 'H7', 'EM ABERTO'); // linha reservada, sem cliente
  put(nov, 'H8', 'EM ABERTO');
  put(nov, 'F9', { formula: 'SUM(F2:F8)' }); // linha de total
  // quadros do lado direito (não são boletos)
  put(nov, 'M2', 123170.5); put(nov, 'O2', { formula: 'M2-M6' }); put(nov, 'M5', 'FATURAMENTO MÊS PASSADO');
  // colunas de apoio mais à direita (cópias antigas) — devem ser ignoradas
  put(nov, 'P2', '2026-10-28', { data: true }); put(nov, 'Y2', 6860);

  const set = wb.addWorksheet('SETEMBRO');
  ['SACADOS', 'NFE', 'ENTRADA', 'VENCIMENTO', 'VENDEDOR', 'VALOR', 'BOLETO', 'SITUAÇÃO', 'OBSERVAÇÃO', 'OBSERVAÇÃO', 'DATA', 'FATURAMENTO DO MÊS', null, 'COMPARATIVO'].forEach((h, i) => h && put(set, `${col(i + 1)}1`, h));
  const linhaS = (n, v) => v.forEach((x, i) => { if (x === null || x === undefined) return; put(set, `${col(i + 1)}${n}`, x, { data: [2, 3, 10].includes(i) && typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) }); });
  linhaS(2, ['CLIENTE PI', '0498-01', '2026-08-31', '2026-09-14', 'PETERSSON', null, '42-5', 'PAGO', 533.5, 'PAGO NO PIX', '2026-10-31']);
  linhaS(3, ['CLIENTE RO', '0562-02', '2026-09-11', '2026-10-09', 'PETERSON', 1000, '48-9', 'EM ABERTO']);
  linhaS(4, ['CLIENTE TAU', '0484-02', '2026-08-27', '2026-09-17', 'PETTERSON', null, '41-0', 'PAGO', { formula: '1000*2' }, 'BOLETO LIQUIDADO SICOOB 13/10/2026']);
  return wb;
}

// ------------------------------------------------------------------ Controle
const PROD_VENDA = ['400', '300', 'CRAK', 'FOLHADO', '30GRAMAS', 'AMANTEIGADO', 'DOCE', 'MAIZENA', '400G', '300G', '200G', 'ROSCA', 'PALITO'];
const PROD_DEP = ['400BG', '300BG', 'CRAK', 'FOLHADO', 'FOLH.DOCE', '30GR', 'AMANT', 'DOCE', 'MAIZENA', '400G', '300G', '200G', 'ROSCA', 'PALITO'];
const PRECOS = [85, 75, 75, 82.8, 55.8, 75, 69.3, null, 85, 75, 47, 60, 60];
// posição de cada produto nas linhas de venda (V = coluna 22)
const colProduto = (nome) => col(22 + PROD_VENDA.indexOf(nome));

export async function construirControle({ pagar829 = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('NOVEMBRO - 2026');
  put(ws, 'A1', 'RELATÓRIO MENSAL'); put(ws, 'S1', 'CONTROLE VENDEDOR');
  put(ws, 'A2', 'MÊS:'); put(ws, 'B2', '2026-11-01', { data: true });
  put(ws, 'A3', 'RETIRADAS'); put(ws, 'B3', 'VENDEDOR');
  ['400BG', '300BG', 'CRAK', 'FOLHADO', '30GR', 'AMANT', 'DOCE', 'MAIZENA', '400G', '300G', '200G', 'ROSCA', 'PALITO'].forEach((p, i) => put(ws, `${col(3 + i)}3`, p));
  put(ws, 'P3', 'VALOR'); put(ws, 'Q3', 'CAIXAS');
  put(ws, 'A10', 'PREÇO'); put(ws, 'B10', 'VENDEDOR (R$)');
  PRECOS.forEach((v, i) => { if (v) put(ws, `${col(3 + i)}10`, v); });

  const cabecalho = (linha, vendedor) => {
    put(ws, `S${linha}`, vendedor); put(ws, `T${linha}`, 'NFE'); put(ws, `U${linha}`, 'CLIENTES');
    PROD_VENDA.forEach((p, i) => put(ws, `${col(22 + i)}${linha}`, p));
    ['RECEBIMENTO', 'VENCIMENTO', 'VALOR', 'SITUAÇÃO', 'PREÇO NOTA', 'PREÇO VENDEDOR', 'COMISSÃO'].forEach((h, i) => put(ws, `${col(35 + i)}${linha}`, h));
    put(ws, `S${linha + 1}`, 'DATA'); put(ws, `T${linha + 1}`, 'SALDO DE BOLACHA:'); put(ws, `T${linha + 2}`, 'SALDO ATUAL:'); put(ws, `AJ${linha + 2}`, 'TOTAL PAGO:');
  };
  const venda = (linha, { data, nf, cliente, qtd = {}, receb, venc = null, valor, sit }) => {
    put(ws, `S${linha}`, data, { data: true }); put(ws, `T${linha}`, nf); put(ws, `U${linha}`, cliente);
    for (const [p, q] of Object.entries(qtd)) put(ws, `${colProduto(p)}${linha}`, q);
    put(ws, `AI${linha}`, receb); if (venc) put(ws, `AJ${linha}`, venc, { data: true });
    put(ws, `AK${linha}`, valor); put(ws, `AL${linha}`, sit);
    put(ws, `AM${linha}`, { formula: `IF(AK${linha}="","",AK${linha})` }); // fórmulas sem resultado guardado (como no arquivo real)
  };
  cabecalho(4, 'HÉLIO');
  venda(7, { data: '2026-11-04', nf: '821', cliente: 'CLIENTE ALFA LTDA', qtd: { '400G': 20 }, receb: 'A PRAZO / BOLETO PAGO 18/11', venc: '2026-11-18', valor: 1900, sit: 'PAGO' });
  venda(8, { data: '2026-11-04', nf: '829', cliente: 'CLIENTE BETA LTDA', qtd: { 300: 20, AMANTEIGADO: 6 }, receb: pagar829 ? 'A PRAZO / BOLETO PAGO 20/11' : 'A PRAZO', venc: '2026-12-02', valor: 2210, sit: pagar829 ? 'PAGO' : 'EM ABERTO' });
  venda(9, { data: '2026-11-11', nf: '871', cliente: 'CLIENTE GAMA', qtd: { 400: 1, 300: 1 }, receb: 'DINHEIRO (SIC)', valor: 469, sit: 'PAGO' });
  venda(10, { data: '2026-11-16', nf: '900-01', cliente: 'CLIENTE DELTA', qtd: { 300: 3.5 }, receb: 'A PRAZO (PARCELA 1/2)', venc: '2026-11-30', valor: 1146, sit: 'EM ABERTO' });
  venda(11, { data: '2026-11-16', nf: '900-02', cliente: 'CLIENTE DELTA', qtd: { 300: 3.5 }, receb: 'A PRAZO (PARCELA 2/2)', venc: '2026-12-07', valor: 1146, sit: 'EM ABERTO' });
  cabecalho(110, 'PETERSON');
  venda(113, { data: '2026-11-06', nf: '840', cliente: 'CLIENTE EPSILON', qtd: { 300: 40 }, receb: 'A PRAZO', venc: '2026-11-27', valor: 3400, sit: 'EM ABERTO' });
  cabecalho(540, 'DEWID / GRACY');
  venda(541, { data: '2026-11-12', nf: '885-01', cliente: 'CLIENTE ZETA', qtd: { '400G': 25 }, receb: 'A PRAZO (PARCELA 1/2)', venc: '2026-11-26', valor: 2672.5, sit: 'EM ABERTO' });
  venda(542, { data: '2026-11-12', nf: '885-02', cliente: 'CLIENTE ZETA', qtd: { '400G': 25 }, receb: 'A PRAZO (PARCELA 2/2)', venc: '2026-12-03', valor: 2672.5, sit: 'EM ABERTO' });
  venda(543, { data: '2026-11-09', nf: '851', cliente: 'CLIENTE ETA', qtd: { '400G': 100, '300G': 100 }, receb: 'A PRAZO (2 PARCELAS)', venc: '2026-11-23', valor: 19200, sit: 'EM ABERTO' });
  cabecalho(547, 'A CONFIRMAR');

  // quadro "RELATÓRIO GERAL": é ele que diz de quem é cada faixa de linhas
  put(ws, 'AT14', 'VENDEDOR'); put(ws, 'AU14', 'FATURAMENTO (TOTAL DAS NOTAS)');
  [['HÉLIO', 15, 'SUM(AK7:AK106)'], ['PETERSON', 16, 'SUM(AK113:AK212)'], ['PAULO', 17, 'SUM(AK219:AK323)']].forEach(([n, l, f]) => { put(ws, `AT${l}`, n); put(ws, `AU${l}`, { formula: f }); });
  put(ws, 'AT20', 'TOTAL GERAL'); put(ws, 'AU20', { formula: 'SUM(AU15:AU19,AU21:AU23)' });
  [['DEWID FURTADO', 21, 'SUM(AK541:AK542)'], ['GRACY NEY', 22, 'SUM(AK543:AK544)'], ['VENDEDOR A CONFIRMAR', 23, 'SUM(AK550:AK560)']].forEach(([n, l, f]) => { put(ws, `AT${l}`, n); put(ws, `AU${l}`, { formula: f }); });
  put(ws, 'AQ6', 'VENDIDO (TODAS AS NOTAS)'); put(ws, 'AR6', { formula: 'SUM(AK7:AK106)' }); // resumo do bloco (não é o quadro geral)

  const prod = wb.addWorksheet('PRODUÇÃO NOVEMBRO - 2026');
  put(prod, 'B1', 'PRODUÇÃO BOM GOSTO');
  ['DATA', 400, 300, 'Crak', 'Folhado', 'Folh.Doce', '10x10x30', 'Recr.Am', 'Recr.Doce', 'Maizena'].forEach((h, i) => put(prod, `${col(i + 1)}2`, h));
  put(prod, 'A3', '2026-11-03', { data: true }); put(prod, 'C3', 298);
  put(prod, 'A4', '2026-11-11', { data: true }); put(prod, 'C4', 200); put(prod, 'D4', 101);

  const dep = wb.addWorksheet('DEPÓSITO');
  put(dep, 'A1', 'DEPÓSITO'); put(dep, 'A3', 'ESTOQUE');
  put(dep, 'A11', 'ENTRADAS'); put(dep, 'S11', 'SAÍDAS');
  put(dep, 'A12', 'DATA'); put(dep, 'B12', 'DESCRIÇÃO / ORIGEM');
  PROD_DEP.forEach((p, i) => { put(dep, `${col(3 + i)}12`, p); put(dep, `${col(22 + i)}12`, p); });
  put(dep, 'S12', 'DATA'); put(dep, 'T12', 'VENDEDOR'); put(dep, 'U12', 'DESTINO / MOTIVO');
  put(dep, 'A13', '2026-11-04', { data: true }); put(dep, 'B13', 'ENTROU NO ESTOQUE'); put(dep, 'D13', 298); // = a produção de 03/11
  const saida = (l, data, vend, destino, qtd) => {
    put(dep, `S${l}`, data, { data: true }); if (vend) put(dep, `T${l}`, vend); if (destino) put(dep, `U${l}`, destino);
    for (const [p, q] of Object.entries(qtd)) put(dep, `${col(22 + PROD_DEP.indexOf(p))}${l}`, q);
  };
  saida(13, '2026-11-03', 'PAULO', null, { CRAK: 1, '300G': 1 });
  saida(14, '2026-11-04', 'HÉLIO', null, { '300BG': 20, AMANT: 6 });
  saida(15, '2026-11-09', 'PETERSON', '(GRACY NEY)', { '300BG': 10 });
  saida(16, '2026-11-10', null, 'PERDA', { DOCE: 2 });
  return wb;
}

export const paraBuffer = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());

/**
 * Reproduz a forma como alguns programas (ex.: Python/openpyxl) gravam as anotações das células: a parte de comentários
 * fica em xl/comments/comment1.xml e a ligação usa um caminho absoluto. O ExcelJS "trava" com esse arquivo.
 */
export async function comComentariosEstiloOpenpyxl(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const nomes = Object.keys(zip.files);
  const com = nomes.find((n) => /^xl\/comments\d*\.xml$/.test(n));
  if (!com) throw new Error('A planilha de teste precisa ter pelo menos uma anotação.');
  const xml = await zip.file(com).async('string');
  zip.remove(com);
  zip.file('xl/comments/comment1.xml', xml);
  for (const n of nomes.filter((x) => /^xl\/worksheets\/_rels\/.*\.rels$/.test(x))) {
    let r = await zip.file(n).async('string');
    r = r.replace(/Target="[^"]*comments\d*\.xml"/g, 'Target="/xl/comments/comment1.xml"').replace(/Id="rId\d+"([^>]*comments)/g, 'Id="comments"$1');
    zip.file(n, r);
  }
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace(/\/xl\/comments\d*\.xml/g, '/xl/comments/comment1.xml');
  zip.file('[Content_Types].xml', ct);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

export { letraParaNum };
