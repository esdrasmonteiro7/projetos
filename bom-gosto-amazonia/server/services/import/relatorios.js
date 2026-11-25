// Relatórios em PDF que a empresa tira do próprio sistema ("Relatório de vendas totalizado por nota") e do banco
// (Sicoobnet: "Títulos por Período"). Os dois são tabelas largas, recortadas pelo programa que gerou o PDF, então a leitura é por
// POSIÇÃO das colunas (e não por texto corrido).
import { norm } from '../../../shared/text.js';
import { parseMoney } from '../../../shared/money.js';

const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const dataISO = (s) => { const m = DMY.exec(String(s).trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const DINHEIRO = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
const textoDaLinha = (L) => L.itens.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ medir texto (para separar dois textos que o PDF grudou)
// Larguras da Helvetica/Arial em milésimos de "em". O PDF do sistema corta o nome do cliente na coluna e o nome do vendedor
// começa logo depois; o leitor de PDF devolve os dois num texto só, e o jeito de separar é medir quanto o vendedor ocupa.
const LARGURA = {};
const larguras = (letras, w) => { for (const c of letras) LARGURA[c] = w; };
larguras(' .,:;/!|\\[]ftI', 278); larguras('ijl\'', 222); larguras('r()-', 333); larguras('cksvxyzJ', 500); larguras('FTZ', 611);
larguras('ABEKPSVXY&', 667); larguras('CDHNRUw', 722); larguras('GOQ', 778); larguras('mM', 833); larguras('W', 944);
function larguraDoTexto(texto, tamanho) {
  let total = 0;
  for (const c of String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '')) total += LARGURA[c] ?? 556;
  return (total * tamanho) / 1000;
}

/** Separa "Rayanara Supermercad Alessandra" em ["Rayanara Supermercad", "Alessandra"], sabendo que o 2º texto começa em xCorte. */
function separarGrudado(item, xCorte) {
  const alvo = item.x + item.w - xCorte; // espaço que o texto da direita ocupa
  const palavras = item.str.trim().split(/\s+/);
  let melhor = null;
  for (let k = 1; k < palavras.length; k++) {
    const dif = Math.abs(larguraDoTexto(palavras.slice(k).join(' '), item.h) - alvo);
    if (!melhor || dif < melhor.dif) melhor = { k, dif };
  }
  if (!melhor) return [item];
  return [
    { ...item, str: palavras.slice(0, melhor.k).join(' '), w: Math.max(0, xCorte - item.x - 2) },
    { ...item, str: palavras.slice(melhor.k).join(' '), x: xCorte, w: alvo },
  ];
}

// ------------------------------------------------------------------ reconhecer
/** 'vendas_totais' | 'sicoob_titulos' | null */
export function reconhecerRelatorio(paginas) {
  const topo = norm(paginas.slice(0, 2).flatMap((p) => p.linhas.slice(0, 40).map(textoDaLinha)).join(' '));
  if (/relatorio de vendas/.test(topo) && /\bvendedor\b/.test(topo) && /valor total/.test(topo)) return 'vendas_totais';
  if (/titulos por periodo/.test(topo) && /\bsacado\b/.test(topo) && /nosso numero/.test(topo)) return 'sicoob_titulos';
  return null;
}

export function lerRelatorio(paginas) {
  const tipo = reconhecerRelatorio(paginas);
  if (tipo === 'vendas_totais') return lerRelatorioVendas(paginas);
  if (tipo === 'sicoob_titulos') return lerRelatorioSicoob(paginas);
  return null;
}

// ------------------------------------------------------------------ relatório de vendas por nota
/** O sistema corta o ano ("24/11/202"): completa com o período do relatório. */
function completarData(txt, periodo) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(String(txt).trim());
  if (!m) return null;
  let ano = m[3];
  if (ano.length < 4) {
    const y0 = Number(String(periodo?.de || '').slice(0, 4)) || new Date().getFullYear();
    const y1 = Number(String(periodo?.ate || '').slice(0, 4)) || y0;
    const candidatos = [];
    for (let y = y0 - 1; y <= y1 + 1; y++) if (String(y).startsWith(ano)) candidatos.push(y);
    const dentro = candidatos.find((y) => periodo?.de && `${y}-${m[2]}-${m[1]}` >= periodo.de && `${y}-${m[2]}-${m[1]}` <= periodo.ate);
    ano = String(dentro ?? candidatos[0] ?? y0);
  }
  const iso = `${ano}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function cabecalhoDeVendas(L) {
  const acha = (re) => L.itens.find((i) => re.test(norm(i.str)));
  const data = acha(/^data$/);
  const nota = acha(/^nota$/);
  const cliente = acha(/^cliente$/);
  const vendedor = acha(/^vendedor$/);
  const valor = acha(/^valor( total)?$/);
  if (!(data && nota && cliente && vendedor && valor)) return null;
  return {
    data: data.x, nota: nota.x, cliente: cliente.x, vendedor: vendedor.x, saida: acha(/^tipo de saida$/)?.x ?? null, recebimento: acha(/^tipo de recebimento$/)?.x ?? null, valor: valor.x,
  };
}

export function lerRelatorioVendas(paginas) {
  const avisos = [];
  const linhas = [];
  let periodo = null;
  let empresa = null;
  let totalPdf = null;
  let cols = null;
  for (const pg of paginas) {
    for (const L of pg.linhas) {
      const texto = textoDaLinha(L);
      const mp = /Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto);
      if (mp) periodo = { de: dataISO(mp[1]), ate: dataISO(mp[2]) };
      if (!empresa && L.itens.length >= 2 && DMY.test(L.itens[0].str) && !/^\d/.test(L.itens[1].str)) empresa = L.itens.slice(1).map((i) => i.str).join(' ').trim();
      const cab = cabecalhoDeVendas(L);
      if (cab) { cols = cab; continue; }
      if (!cols) continue;
      if (/^total$/i.test(L.itens[0]?.str.trim())) {
        const v = parseMoney(L.itens.at(-1).str);
        if (v !== null && DINHEIRO.test(L.itens.at(-1).str.trim())) totalPdf = v;
        continue;
      }
      if (!/^\d{2}\/\d{2}\/\d{2,4}$/.test(L.itens[0]?.str.trim()) || L.itens.length < 5) continue; // (o cabeçalho de cada página também começa com uma data)

      // limites das colunas: cada texto vai para a coluna em que COMEÇA; se um texto invade a próxima (grudado), é separado
      const inicios = [cols.nota, cols.cliente, cols.vendedor, cols.saida, cols.recebimento, cols.valor].filter((x) => x !== null);
      const cortes = inicios.map((x) => x - 3);
      let itens = [];
      for (const it of L.itens) {
        const invade = cortes.find((c) => it.x < c - 1 && it.x + it.w > c + 6);
        itens.push(...(invade !== undefined ? separarGrudado(it, invade + 3) : [it]));
      }
      itens = itens.sort((a, b) => a.x - b.x);
      const coluna = (it) => cortes.filter((c) => it.x >= c).length; // 0 = data, 1 = nota, 2 = cliente, ...
      const nomes = ['data', 'nota', 'cliente', 'vendedor'];
      if (cols.saida !== null) nomes.push('saida');
      if (cols.recebimento !== null) nomes.push('recebimento');
      nomes.push('valor');
      const cel = Object.fromEntries(nomes.map((n) => [n, '']));
      for (const it of itens) { const n = nomes[Math.min(coluna(it), nomes.length - 1)]; cel[n] = `${cel[n]} ${it.str}`.trim(); }
      const valor = DINHEIRO.test(cel.valor) ? parseMoney(cel.valor) : null;
      const data = completarData(cel.data, periodo);
      if (valor === null || !data) { avisos.push(`Página ${pg.numero}: não consegui ler a linha "${texto.slice(0, 80)}".`); continue; }
      const nota = String(cel.nota).replace(/\D/g, '');
      linhas.push({
        numero: nota && Number(nota) > 0 ? String(Number(nota)) : null,
        data,
        cliente: cel.cliente || null,
        vendedor: cel.vendedor || null,
        saida: cel.saida || null,
        recebimento: cel.recebimento || null,
        valor_centavos: valor,
        _pagina: pg.numero,
      });
    }
  }
  const soma = linhas.reduce((s, l) => s + l.valor_centavos, 0);
  if (totalPdf !== null && soma !== totalPdf) avisos.push(`A soma das linhas lidas (${(soma / 100).toFixed(2).replace('.', ',')}) não bate com o total do relatório (${(totalPdf / 100).toFixed(2).replace('.', ',')}): confira se alguma linha ficou de fora.`);
  return { tipo: 'vendas_totais', periodo, empresa, linhas, total_centavos: totalPdf ?? soma, avisos };
}

// ------------------------------------------------------------------ Sicoobnet: títulos por período
export function lerRelatorioSicoob(paginas) {
  const avisos = [];
  const linhas = [];
  const meta = { consulta: null, periodo: null, cedente: null, conta: null, contrato: null };
  let registros = null;
  let totalPdf = null;
  let temCabecalho = false;
  for (const pg of paginas) {
    for (const L of pg.linhas) {
      const texto = textoDaLinha(L);
      let m;
      if ((m = /Tipo Consulta:\s*(.+?)\s+Data Inicial:\s*(\d{2}\/\d{2}\/\d{4})\s+Data Final:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(texto))) { meta.consulta = m[1].trim(); meta.periodo = { de: dataISO(m[2]), ate: dataISO(m[3]) }; }
      if ((m = /Cedente:\s*(.+)$/i.exec(texto))) meta.cedente = m[1].trim();
      if ((m = /Conta Corrente:\s*(\S+)/i.exec(texto))) meta.conta = m[1];
      if ((m = /N[º°o]\s*de Contrato:\s*(\S+)/i.exec(texto)) || (m = /Contrato:\s*(\d+)/i.exec(texto))) meta.contrato = m[1];
      if ((m = /Total de Registros:\s*(\d+)/i.exec(texto))) registros = Number(m[1]);
      if ((m = /Total de Valores:\s*([\d.]+,\d{2})/i.exec(texto))) totalPdf = parseMoney(m[1]);
      if (/\bsacado\b/i.test(texto) && /nosso n[uú]mero/i.test(texto)) { temCabecalho = true; continue; }
      if (!temCabecalho) continue;
      // linha de título: [sacado] [nosso nº "76-6"] [seu nº "0857-02" ou "0890"] [entrada] [vencimento] ([limite p/ pagamento]) [valor]
      const it = L.itens.map((i) => i.str.trim());
      const iNosso = it.findIndex((t, k) => k >= 1 && /^\d+-\d+$/.test(t));
      if (iNosso < 1 || iNosso + 1 >= it.length) continue;
      const datas = it.filter((t) => DMY.test(t));
      const valor = it.at(-1);
      if (datas.length < 2 || !DINHEIRO.test(valor)) continue;
      linhas.push({
        sacado: it.slice(0, iNosso).join(' '),
        nosso_numero: it[iNosso],
        seu_numero: it[iNosso + 1],
        entrada: dataISO(datas[0]),
        vencimento: dataISO(datas[1]),
        limite_pagamento: datas[2] ? dataISO(datas[2]) : null,
        valor_centavos: parseMoney(valor),
        _pagina: pg.numero,
      });
    }
  }
  const soma = linhas.reduce((s, l) => s + l.valor_centavos, 0);
  if (registros !== null && registros !== linhas.length) avisos.push(`O relatório diz ter ${registros} títulos, mas li ${linhas.length}: confira se alguma linha ficou de fora.`);
  if (totalPdf !== null && soma !== totalPdf) avisos.push(`A soma dos títulos lidos (${(soma / 100).toFixed(2).replace('.', ',')}) não bate com o total do relatório (${(totalPdf / 100).toFixed(2).replace('.', ',')}).`);
  const consultaOk = !meta.consulta || /vencid|a vencer|aberto/i.test(meta.consulta);
  return {
    tipo: 'sicoob_titulos', ...meta, linhas, total_centavos: totalPdf ?? soma, registros, avisos,
    motivo: !consultaOk ? `Este relatório do Sicoob é do tipo "${meta.consulta}". Por enquanto só leio os de "Vencido" e "A vencer" (títulos ainda não pagos). Se você precisar do de pagos (liquidados), me avise para eu aprender esse modelo.` : null,
  };
}
