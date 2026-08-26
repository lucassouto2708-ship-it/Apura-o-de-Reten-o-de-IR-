// --- Tema claro/escuro (manual, sobrepõe a preferência do sistema, salvo entre sessões) ---
(function () {
  const CHAVE = 'apuracao-ir-tema';
  const btnTema = document.getElementById('btnTema');

  function aplicarTema(tema) {
    if (tema) {
      document.documentElement.setAttribute('data-theme', tema);
    } else {
      document.documentElement.removeAttribute('data-theme'); // segue o sistema
    }
    const escuro = tema
      ? tema === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    btnTema.textContent = escuro ? '🌙' : '☀️';
  }

  aplicarTema(localStorage.getItem(CHAVE));

  btnTema.addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const novo = atual === 'dark' ? 'light' : 'dark';
    localStorage.setItem(CHAVE, novo);
    aplicarTema(novo);
  });
})();

// Índice do CNAE_DATA por código
const CNAE_INDEX = {};
for (const row of CNAE_DATA) {
  CNAE_INDEX[normalizeCnae(row.cnae)] = row;
}

function normalizeCnae(code) {
  return String(code || '').replace(/[^\d]/g, '');
}

function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

const MESES = ['JANEIRO','FEVEREIRO','MARÇO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

// Reconhece CNPJ (14 dígitos formatados) ou CPF (11 dígitos formatados)
// Aceita "-" ou "." como separador final (OCR às vezes lê o hífen do CNPJ/CPF como ponto)
const DOC_RE = /(\d{2}\.\d{3}\.\d{3}\/\d{4}[-.]\d{2}|\d{3}\.\d{3}\.\d{3}[-.]\d{2})/;
// Números monetários no formato brasileiro: 1.234,56 ou 12,00
const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
// Às vezes o arquivo/relatório vem com TODOS os separadores como ponto (ex: "225.942.68"
// em vez de "225.942,68") — alguma conversão de sistema/codificação trocou a vírgula decimal
// por ponto também. Detectamos esse padrão como último recurso.
const MONEY_ALT_RE = /-?\d{1,3}(?:\.\d{3})*\.\d{2}(?!\d)/g;

function parseMoedaBR(str) {
  if (!str) return NaN;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.'));
}

// Detecta automaticamente se a string usa vírgula (padrão) ou só ponto (formato alternativo)
// como decimal, e aplica o parser certo.
function parseMoedaAuto(str) {
  if (!str) return NaN;
  return str.includes(',') ? parseMoedaBR(str) : parseMoedaPontoDecimal(str);
}

// Parser para o formato "tudo com ponto" (MONEY_ALT_RE): o último grupo de 2 dígitos é
// sempre a parte decimal, os grupos anteriores são milhares.
function parseMoedaPontoDecimal(str) {
  if (!str) return NaN;
  const negativo = str.startsWith('-');
  const partes = str.replace('-', '').split('.');
  const decimais = partes.pop();
  const inteiro = partes.join('');
  const valor = parseFloat(`${inteiro}.${decimais}`);
  return negativo ? -valor : valor;
}

// Busca números monetários num trecho de texto, tentando primeiro o formato padrão
// (vírgula decimal) e, se não achar o suficiente, o formato alternativo (tudo com ponto).
// Retorna { valores, parser } prontos para uso.
function encontrarValoresMonetarios(texto) {
  const padrao = texto.match(MONEY_RE);
  if (padrao && padrao.length >= 2) {
    return { valores: padrao, parser: parseMoedaBR };
  }
  const alternativo = texto.match(MONEY_ALT_RE);
  if (alternativo && alternativo.length >= 2) {
    return { valores: alternativo, parser: parseMoedaPontoDecimal };
  }
  return { valores: padrao || alternativo || [], parser: parseMoedaBR };
}

function formatMoeda(num) {
  if (isNaN(num)) return '-';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function isValidCnpj(cnpj) {
  cnpj = onlyDigits(cnpj);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base) => {
    let weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const base12 = cnpj.slice(0, 12);
  const d1 = calc(base12);
  const d2 = calc(base12 + d1);
  return cnpj.slice(12) === `${d1}${d2}`;
}

function formatCnae(code) {
  const d = onlyDigits(code).padStart(7, '0');
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5, 7)}`;
}

function formatCnpj(digits) {
  digits = onlyDigits(digits).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Detecta o formato do relatório:
// - "retencao": relatório "Credores com Retenção de Receita" (já tem coluna de Retenção)
// - "pagamentos": "Relação Analítica de Pagamentos" (só tem Valor Pago, sem retenção -> retenção do arquivo = 0)
function detectarFormato(texto) {
  const upper = texto.toUpperCase();
  // "Relação de Pagamentos" — uma linha por lançamento (Tipo de Documento / Nº Pagamento /
  // Data / Nº Liquidação / Nº Empenho / Elemento Despesa / Credor / CPF-CNPJ / Desconto /
  // Valor Pagamento / Valor Desconto), colunas separadas por espaçamento largo (largura fixa).
  if (upper.includes('TIPO DE DOCUMENTO') && upper.includes('ELEMENTO DESPESA')) return 'pagamentos-linha';
  if (upper.includes('RETENÇÃO') || upper.includes('RETENCAO')) return 'retencao';
  if (upper.includes('RELAÇÃO ANALÍTICA') || upper.includes('RELACAO ANALITICA') || upper.includes('VLR PAGAMENTO')) return 'pagamentos';
  return 'retencao'; // default: formato mais comum já suportado
}

// Formato "Credores com Retenção de Receita": nome, documento, valorPago, retencaoTxt na mesma linha
function parseFormatoRetencao(texto) {
  const linhas = texto.split(/\r?\n/);
  const registros = [];

  for (let rawLine of linhas) {
    const line = rawLine.trim();
    if (!line) continue;

    const docMatch = line.match(DOC_RE);
    if (!docMatch) continue; // linha sem CNPJ/CPF não é um registro de credor

    // Procura os valores só no trecho depois do documento, pra não confundir dígitos
    // do CNPJ/CPF com números monetários (importante no formato "tudo com ponto").
    const restoLinha = line.slice(docMatch.index + docMatch[0].length);
    const { valores, parser } = encontrarValoresMonetarios(restoLinha);
    if (!valores || valores.length < 2) continue; // precisa de ao menos Valor Pago + Retenção

    // Os dois últimos números monetários da linha são Valor Pago e Retenção, nessa ordem
    const valorPago = parser(valores[valores.length - 2]);
    const retencaoTxt = parser(valores[valores.length - 1]);

    // Nome: tudo antes do documento, removendo "código - " do início
    let nomePart = line.slice(0, docMatch.index).trim();
    nomePart = nomePart.replace(/^\d+\s*-\s*/, '').trim();

    const documento = docMatch[1];
    const isCnpj = onlyDigits(documento).length === 14;

    registros.push({
      nome: nomePart || '(sem nome)',
      documento,
      isCnpj,
      valorPago,
      retencaoTxt,
    });
  }
  return registros;
}

// Formato "Relação Analítica de Pagamentos por Credor": não tem coluna de retenção.
// Cada credor fecha num bloco terminado por uma linha "CNPJ..: <doc> ... Total...: <valor>"
// (o nome do credor aparece em alguma linha anterior desse bloco). Como não há retenção
// no arquivo, retencaoTxt fica em 0 para todos os registros desse formato.
function parseFormatoPagamentos(texto) {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const registros = [];

  // O valor final aceita "," ou "." como separador decimal (ver MONEY_ALT_RE/parseMoedaAuto).
  const CNPJ_TOTAL_RE = /CNPJ\.*\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/\d{4}\s?[-.]\s?\d{2})[^0-9]*Total\.*\s*:?\s*(-?\d{1,3}(?:\.\d{3})*[,.]\d{2})/i;
  const CPF_TOTAL_RE = /CPF\.*\s*:?\s*(\d{3}\.?\d{3}\.?\d{3}\s?-\s?\d{2})[^0-9]*Total\.*\s*:?\s*(-?\d{1,3}(?:\.\d{3})*[,.]\d{2})/i;
  // Nome do credor: em algum ponto da linha aparece "código-NOME" (ex. "13894-BARRINHA
  // ELETRONICOS LTDA"). Captura palavra a palavra a partir daí, parando no primeiro token
  // que pareça número/nota fiscal/valor monetário (não faz parte do nome).
  const CODIGO_NOME_RE = /\d{1,7}-([A-ZÀ-Ú].*)$/;
  const TOKEN_NUMERICO_RE = /^[\d.,\/-]/;
  // Linha da classificação orçamentária da despesa (ex: "1.751.000.0000 Recur. da Contrib.
  // Cust. Serv. Ilumin. Pública-COSIP") — usamos o texto pra identificar despesas de COSIP.
  const DESPESA_RE = /^\d\.\d{3}\.\d{3}\.\d{4}\s+(.+)$/;

  let ultimoNome = null;
  let ultimaDespesa = null;

  for (let i = 0; i < linhas.length; i++) {
    const line = linhas[i];

    const codigoNomeMatch = line.match(CODIGO_NOME_RE);
    if (codigoNomeMatch) {
      const palavras = codigoNomeMatch[1].trim().split(/\s+/);
      const nomeWords = [];
      for (const w of palavras) {
        if (TOKEN_NUMERICO_RE.test(w) || w === '—' || w === '-') break;
        nomeWords.push(w);
      }
      if (nomeWords.length > 0) {
        ultimoNome = nomeWords.join(' ');
      }
    }

    const despesaMatch = line.match(DESPESA_RE);
    if (despesaMatch) {
      ultimaDespesa = despesaMatch[1].trim();
    }

    let m = line.match(CNPJ_TOTAL_RE);
    let isCnpj = true;
    if (!m) {
      m = line.match(CPF_TOTAL_RE);
      isCnpj = false;
    }
    // A linha de CNPJ/Total às vezes vem quebrada em duas linhas (CNPJ numa, Total na outra).
    // Só tenta combinar se a linha atual de fato menciona CNPJ/CPF (evita juntar linhas
    // soltas com a linha seguinte e gerar duplicidade).
    if (!m && /CNPJ|CPF/i.test(line) && i + 1 < linhas.length) {
      const combinado = line + ' ' + linhas[i + 1];
      let m2 = combinado.match(CNPJ_TOTAL_RE);
      isCnpj = true;
      if (!m2) { m2 = combinado.match(CPF_TOTAL_RE); isCnpj = false; }
      if (m2) { m = m2; i++; } // consome também a próxima linha
    }
    if (!m) continue;

    const documento = m[1];
    const valorPago = parseMoedaAuto(m[2]);

    registros.push({
      nome: ultimoNome || '(sem nome)',
      documento,
      isCnpj,
      valorPago,
      retencaoTxt: 0,
      despesaDescricao: ultimaDespesa,
    });
    ultimoNome = null;
    ultimaDespesa = null;
  }

  return registros;
}

// Id estável por lançamento (sobrevive à consulta/fusão) — usado pra reencontrar a linha
// quando o usuário edita a alíquota manualmente.
let proximoLancamentoId = 1;

// Formato "Relação de Pagamentos": uma linha por lançamento, colunas de largura fixa
// (código de credor, código-descrição da despesa, credor, CPF/CNPJ, valor...) separadas
// por grandes espaços em branco. Não tem coluna de retenção -> retencaoTxt fica em 0.
function parseFormatoRelacaoPagamentosLinhaUnica(texto) {
  const MONEY_TEST_RE = /^-?\d{1,3}(?:\.\d{3})*[,.]\d{2}$/;
  const linhas = texto.split(/\r?\n/);
  const registros = [];

  for (const rawLine of linhas) {
    const line = rawLine.trim();
    if (!line) continue;

    const docMatch = line.match(DOC_RE);
    if (!docMatch) continue;

    // Duas ou mais espaços seguidos = separador de coluna nesse layout de largura fixa.
    const colunas = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    const idxDoc = colunas.findIndex((c) => DOC_RE.test(c));
    if (idxDoc <= 0) continue; // precisa ter pelo menos o nome do credor antes do documento

    // Depois do documento vêm os valores (Desconto / Valor Pagamento / Valor Desconto,
    // mas normalmente só "Valor Pagamento" vem preenchido) — pega o primeiro valor monetário.
    const valorCol = colunas.slice(idxDoc + 1).find((c) => MONEY_TEST_RE.test(c));
    if (!valorCol) continue;

    const documento = docMatch[1];
    registros.push({
      nome: colunas[idxDoc - 1] || '(sem nome)',
      documento,
      isCnpj: onlyDigits(documento).length === 14,
      valorPago: parseMoedaAuto(valorCol),
      retencaoTxt: 0,
      despesaDescricao: colunas[idxDoc - 2] || null,
    });
  }

  return registros;
}

function parseLinhas(texto) {
  const formato = detectarFormato(texto);
  let registros;
  if (formato === 'pagamentos-linha') {
    registros = parseFormatoRelacaoPagamentosLinhaUnica(texto);
  } else if (formato === 'pagamentos') {
    registros = parseFormatoPagamentos(texto);
  } else {
    registros = parseFormatoRetencao(texto);
  }
  registros.forEach((r) => { r.id = proximoLancamentoId++; });
  return registros;
}

const txtInput = document.getElementById('txtInput');
const fileInput = document.getElementById('fileInput');
const origemInput = document.getElementById('origemInput');
const btnProcessar = document.getElementById('btnProcessar');
const btnLimpar = document.getElementById('btnLimpar');
const btnNovoLote = document.getElementById('btnNovoLote');
const lotesBox = document.getElementById('lotesBox');
const statusLine = document.getElementById('statusLine');
const statusText = document.getElementById('statusText');
const errorBox = document.getElementById('errorBox');

// Texto com reticências animadas (independe de CSS/animation funcionar no navegador do usuário,
// então garante que dá pra perceber que algo está acontecendo mesmo se o spinner não rodar).
let statusBaseMsg = '';
let statusDotsTimer = null;

function setStatus(msg) {
  statusBaseMsg = msg;
  if (!statusDotsTimer) {
    let dots = 0;
    statusDotsTimer = setInterval(() => {
      dots = (dots + 1) % 4;
      statusText.textContent = statusBaseMsg + '.'.repeat(dots);
    }, 400);
  }
  statusText.textContent = statusBaseMsg;
}

function pararAnimacaoStatus() {
  if (statusDotsTimer) {
    clearInterval(statusDotsTimer);
    statusDotsTimer = null;
  }
}
const resultsCard = document.getElementById('resultsCard');
const summaryBox = document.getElementById('summaryBox');
const summaryTotalsBox = document.getElementById('summaryTotalsBox');
const resultsBody = document.getElementById('resultsBody');
const btnReprocessarErros = document.getElementById('btnReprocessarErros');
const btnReprocessarErros2 = document.getElementById('btnReprocessarErros2');

if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
}

// Registros pré-parseados de um XLSX — bypassa a etapa de texto/parseLinhas.
let xlsxRegistros = null;

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  hideError();
  xlsxRegistros = null; // limpa leitura anterior de XLSX
  if (!origemInput.value.trim()) {
    origemInput.value = file.name.replace(/\.(pdf|txt|xlsx)$/i, '');
  }

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isXlsx = /\.xlsx$/i.test(file.name);

  if (isXlsx) {
    statusLine.classList.remove('done');
    statusLine.style.display = 'flex';
    setStatus('Lendo planilha XLSX...');
    try {
      const buffer = await file.arrayBuffer();
      xlsxRegistros = parseFormatoXLSX(buffer);
      const totalRegs = xlsxRegistros.reduce((s, g) => s + g.registros.length, 0);
      const mesesStr = xlsxRegistros.map((g) => g.nome).join(', ');
      pararAnimacaoStatus();
      statusLine.classList.add('done');
      setStatus(`Planilha carregada: ${totalRegs} registro(s) em ${xlsxRegistros.length} mês(es) — ${mesesStr}. Clique em Processar.`);
      txtInput.value = ''; // não usa txtInput no caminho XLSX
    } catch (e) {
      pararAnimacaoStatus();
      showError('Falha ao ler o XLSX: ' + (e.message || e));
      statusLine.style.display = 'none';
    }
  } else if (isPdf) {
    statusLine.classList.remove('done');
    statusLine.style.display = 'flex';
    setStatus('Extraindo texto do PDF...');
    const orientacao = document.getElementById('orientacaoSelect').value;
    try {
      const text = await extrairTextoPdf(file, (msg) => setStatus(msg), orientacao);
      txtInput.value = text;
      pararAnimacaoStatus();
      statusLine.classList.add('done');
      setStatus('PDF carregado. Confira o texto extraído e clique em Processar.');
    } catch (e) {
      pararAnimacaoStatus();
      showError('Falha ao ler o PDF: ' + (e.message || e));
      statusLine.style.display = 'none';
    }
  } else {
    const text = await lerTextoArquivo(file);
    txtInput.value = text;
  }
});

const NOMES_MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Parser para planilhas XLSX no formato "despesa.pagamento" (Betha/sistemas municipais).
// Agrupa os registros por mês (num_mes_referencia + num_ano_referencia), retornando um
// array de { nome, registros } ordenado cronologicamente — cada mês vira um lote separado.
function parseFormatoXLSX(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const header = rows[0].map((h) => String(h).toLowerCase().trim());
  const iDoc  = header.indexOf('num_doc_credor');
  const iNome = header.indexOf('nom_credor');
  const iPago = header.indexOf('vlr_pag_fonte');
  const iRet  = header.indexOf('vlr_ret_fonte');
  const iMes  = header.indexOf('num_mes_referencia');
  const iAno  = header.indexOf('num_ano_referencia');

  if (iDoc === -1 || iNome === -1 || iPago === -1) {
    throw new Error(
      'Colunas esperadas não encontradas. O arquivo deve ter num_doc_credor, nom_credor e vlr_pag_fonte.'
    );
  }

  // Agrupa por chave "AAAAMM" para ordenar cronologicamente
  const grupos = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    let docRaw = String(row[iDoc] || '').replace(/\D/g, '');
    if (docRaw.length >= 12 && docRaw.length < 14) docRaw = docRaw.padStart(14, '0');
    if (docRaw.length !== 14 && docRaw.length !== 11) continue;

    const valor = parseFloat(String(row[iPago] || '').replace(',', '.'));
    if (isNaN(valor) || valor <= 0) continue;

    const isCnpj = docRaw.length === 14;
    const documento = isCnpj ? formatCnpj(docRaw) : docRaw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

    const retBruta = iRet !== -1 ? parseFloat(String(row[iRet] || '').replace(',', '.')) : NaN;
    const retencaoTxt = (!isNaN(retBruta) && retBruta > 0) ? retBruta : 0;

    const mes = iMes !== -1 ? parseInt(row[iMes]) || 0 : 0;
    const ano = iAno !== -1 ? parseInt(row[iAno]) || 0 : 0;
    const chave = `${ano}${String(mes).padStart(2, '0')}`; // ex: "202502"
    const nomeMes = mes >= 1 && mes <= 12
      ? `${NOMES_MESES[mes - 1]}/${ano}`
      : (ano ? `${ano}` : 'Sem data');

    if (!grupos.has(chave)) grupos.set(chave, { nome: nomeMes, registros: [] });
    grupos.get(chave).registros.push({
      nome: String(row[iNome] || '').trim() || documento,
      documento,
      valorPago: valor,
      retencaoTxt,
      isCnpj,
      mesRef: ano * 100 + mes, // ex: 202502 — usado para não fundir lançamentos de meses diferentes
    });
  }

  // Ordena cronologicamente pela chave AAAAMM
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g]) => g);
}

// Lê um .txt tentando UTF-8 primeiro; se não for UTF-8 válido, cai para Windows-1252
// (ISO-8859-1) — comum em relatórios exportados por sistemas de prefeitura mais antigos,
// que senão viram acentos quebrados ("Servi�os" em vez de "Serviços").
async function lerTextoArquivo(file) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

// Extrai o texto de um PDF preservando a ordem espacial dos itens (linha a linha),
// já que relatórios como esse costumam vir com colunas em orientação/posição variada.
// Se o PDF não tiver texto embutido (é uma imagem escaneada), cai para OCR automaticamente.
async function extrairTextoPdf(file, onProgress, orientacao) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let textoCompleto = '';
  let totalChars = 0;

  const textoPorPagina = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const linhas = [];
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      let linha = linhas.find((l) => Math.abs(l.y - y) < 3);
      if (!linha) {
        linha = { y, itens: [] };
        linhas.push(linha);
      }
      linha.itens.push({ x, str: item.str });
    }

    linhas.sort((a, b) => b.y - a.y);
    let paginaTexto = '';
    for (const linha of linhas) {
      linha.itens.sort((a, b) => a.x - b.x);
      paginaTexto += linha.itens.map((i) => i.str).join(' ') + '\n';
    }
    textoPorPagina.push(paginaTexto);
    totalChars += paginaTexto.replace(/\s/g, '').length;
  }

  // Menos de ~10 caracteres úteis por página em média = PDF sem texto real (é imagem/scan) -> OCR
  const precisaOcr = (totalChars / pdf.numPages) < 10;

  if (!precisaOcr) {
    return textoPorPagina.join('\n').trim();
  }

  return await ocrPdf(pdf, onProgress, orientacao);
}

// Ângulos candidatos a testar na 1ª página, de acordo com o que o usuário informou:
// - "retrato": documento já vem na posição normal -> não precisa testar nada, usa 0° direto.
// - "paisagem": documento está deitado, mas pode ter sido girado pra qualquer lado -> testa só
//   90°/-90° (pula o 0°, que sabemos que não é).
// - "auto"/indefinido: não sabemos nada, testa os 3 ângulos (mais lento, porém mais seguro).
function angulosParaTestar(orientacao) {
  if (orientacao === 'retrato') return [0];
  if (orientacao === 'paisagem') return [90, -90];
  return [0, 90, -90];
}

// Renderiza uma página do PDF em um canvas, rotacionada por `anguloExtra` graus
// (além da rotação já embutida na própria página).
async function renderPaginaCanvas(page, anguloExtra) {
  const viewport = page.getViewport({ scale: 3, rotation: (page.rotate || 0) + anguloExtra });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Dá uma nota pro texto reconhecido: quantos trechos parecem CNPJ/CPF ou valor monetário.
// Serve pra descobrir qual rotação (0°, 90°, 270°) deixa o texto legível.
function pontuarTextoOcr(texto) {
  const docs = (texto.match(DOC_RE) || []).length; // só conta 1 (regex sem /g); usamos contagem manual abaixo
  const docsCount = (texto.match(new RegExp(DOC_RE.source, 'g')) || []).length;
  const moneyCount = (texto.match(MONEY_RE) || []).length;
  return docsCount * 3 + moneyCount;
}

// OCR: renderiza cada página em um canvas e roda reconhecimento de texto (Tesseract, português).
// Muitos desses relatórios são impressos em paisagem mas escaneados/salvos como página retrato
// (texto "deitado"), então testamos a orientação certa na 1ª página e aplicamos nas demais.
async function ocrPdf(pdf, onProgress, orientacao) {
  const worker = await Tesseract.createWorker('por');
  let textoCompleto = '';
  const candidatos = angulosParaTestar(orientacao);

  try {
    const primeira = await pdf.getPage(1);
    let melhorAngulo = candidatos[0];

    if (candidatos.length === 1) {
      // Orientação já informada pelo usuário: não precisa testar nada, só lê direto.
      if (onProgress) onProgress(`Lendo página 1 de ${pdf.numPages} (OCR)...`);
      const canvas = await renderPaginaCanvas(primeira, melhorAngulo);
      const { data } = await worker.recognize(canvas);
      textoCompleto = data.text + '\n\n';
    } else {
      let melhorScore = -1;
      for (const angulo of candidatos) {
        if (onProgress) onProgress(`Detectando orientação do PDF (testando ${angulo}°)...`);
        const canvas = await renderPaginaCanvas(primeira, angulo);
        const { data } = await worker.recognize(canvas);
        const score = pontuarTextoOcr(data.text);
        if (score > melhorScore) {
          melhorScore = score;
          melhorAngulo = angulo;
          textoCompleto = data.text + '\n\n'; // já aproveita o resultado da página 1
        }
      }
    }

    for (let p = 2; p <= pdf.numPages; p++) {
      if (onProgress) onProgress(`Lendo página ${p} de ${pdf.numPages} (OCR)...`);
      const page = await pdf.getPage(p);
      const canvas = await renderPaginaCanvas(page, melhorAngulo);
      const { data } = await worker.recognize(canvas);
      textoCompleto += data.text + '\n\n';
    }
  } finally {
    await worker.terminate();
  }

  return textoCompleto.trim();
}

btnLimpar.addEventListener('click', () => {
  // Limpa só o campo de entrada (texto/arquivo/nome do relatório), mantendo os resultados
  // já acumulados de relatórios anteriores — assim dá pra subir o próximo relatório em seguida.
  txtInput.value = '';
  fileInput.value = '';
  origemInput.value = '';
  errorBox.style.display = 'none';
  pararAnimacaoStatus();
  statusLine.style.display = 'none';
});

btnNovoLote.addEventListener('click', () => {
  txtInput.value = '';
  fileInput.value = '';
  origemInput.value = '';
  errorBox.style.display = 'none';
  pararAnimacaoStatus();
  statusLine.style.display = 'none';
  ultimosResultados = [];
  lotes = [];
  atualizarLotesBox();
  resultsCard.style.display = 'none';
  btnNovoLote.style.display = 'none';
});

btnProcessar.addEventListener('click', processar);

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}
function hideError() {
  errorBox.style.display = 'none';
}

async function consultaCnpjComRetry(cnpj, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (resp.status === 429) {
        await sleep(800 * (i + 1));
        continue;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
  throw new Error('Falha ao consultar após múltiplas tentativas');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Categorias que o usuário pediu pra sempre desconsiderar da apuração (não são pessoas
// jurídicas comuns sujeitas a essa retenção, ou o caso é dispensado por regra própria).
// Detecta pelo NOME primeiro (não gasta consulta à API pra algo que já sabemos que não entra).
function detectarExclusaoPorNome(nome) {
  const n = (nome || '').toUpperCase();
  // Conselhos de classe: lista explícita das siglas reais (nem todas começam com "CR",
  // ex: COREN, CAU) — evita um padrão genérico "CR..." que daria falso positivo em
  // palavras comuns (ex: "CRIANÇA").
  if (/\bCONSELHO\s+(REGIONAL|FEDERAL)\b|\bOAB\b|\bCAU\b|\bCREA\b|\bCREF\d{0,2}\b|\bCOREN\b|\bCRM\b|\bCRO\b|\bCRC\b|\bCRP\b|\bCRN\b|\bCRQ\b|\bCRMV\b|\bCRESS\b|\bCRF\b|\bCRECI\b|\bCOFECI\b|\bCOFEN\b|\bCFM\b|\bCFC\b|\bCFO\b|\bCFF\b|\bCFP\b/.test(n)) return 'Conselho de classe';
  if (/CONS[OÓ]RCIO/.test(n)) return 'Consórcio';
  if (/^BANCO\b|\bBANCO\s|CAIXA ECON[OÔ]MICA/.test(n)) return 'Banco';
  if (/\bPREFEITURA\b|MUNIC[IÍ]PIO DE|C[AÂ]MARA MUNICIPAL|\bESTADO DE\b|GOVERNO DO|\bAUTARQUIA\b|\bINSS\b|MINIST[EÉ]RIO/.test(n)) return 'Instituição pública';
  if (/CART[OÓ]RIO|TABELIONATO|OF[IÍ]CIO DE REGISTRO|SERVENTIA EXTRAJUDICIAL|REGISTRO CIVIL/.test(n)) return 'Cartório';
  if (/\bASSOCIA[CÇ][AÃ]O\b|\bFUNDA[CÇ][AÃ]O\b/.test(n)) return 'Associação/Fundação';
  return null;
}

// Segundo sinal de instituição pública: natureza jurídica retornada pela Receita.
// Códigos 1000-1999 = "Administração Pública" (órgãos, autarquias, fundações públicas etc.),
// cobre casos que o nome sozinho não deixa óbvio.
// A BrasilAPI devolve `natureza_juridica` como TEXTO puro (ex: "Estado ou Distrito Federal"),
// sem o código — o código numérico vem em campo separado, `codigo_natureza_juridica`
// (ex: 1236). Faixas oficiais da tabela de natureza jurídica do IBGE/Receita:
// 1000-1999 = Administração Pública · 3000-3999 = Entidades sem Fins Lucrativos.
function codigoNaturezaJuridica(data) {
  const codigo = data && data.codigo_natureza_juridica;
  return typeof codigo === 'number' ? codigo : null;
}

function ehInstituicaoPublicaPorNatureza(data) {
  const codigo = codigoNaturezaJuridica(data);
  return codigo !== null && codigo >= 1000 && codigo < 2000;
}

function ehEntidadeSemFinsLucrativosPorNatureza(data) {
  const codigo = codigoNaturezaJuridica(data);
  return codigo !== null && codigo >= 3000 && codigo < 4000;
}

// Processa um único registro (consulta CNPJ, checa Simples/CNAE, calcula retenção esperada).
// Usado tanto no processamento normal quanto no "reprocessar só os com erro".
async function processarRegistro(reg) {
  if (!reg.isCnpj) {
    // Pessoa física: não valida CNAE/Simples, apenas repete o valor do relatório
    // no "esperado" para não gerar diferença no somatório final.
    return {
      ...reg,
      tipo: 'pf',
      retencaoEsperada: reg.retencaoTxt,
      diferenca: 0,
    };
  }

  const cnpjDigits = onlyDigits(reg.documento);
  if (!isValidCnpj(cnpjDigits)) {
    return { ...reg, tipo: 'erro', erro: 'CNPJ inválido' };
  }

  const motivoPorNome = detectarExclusaoPorNome(reg.nome);
  if (motivoPorNome) {
    return { ...reg, tipo: 'excluido', motivoExclusao: motivoPorNome };
  }
  // CEMIG associada à COSIP (Contribuição para Custeio do Serviço de Iluminação Pública):
  // o pagamento não é retenção de fornecedor comum, é repasse de contribuição arrecadada.
  if (/CEMIG/i.test(reg.nome) && reg.despesaDescricao && /COSIP/i.test(reg.despesaDescricao)) {
    return { ...reg, tipo: 'excluido', motivoExclusao: 'CEMIG / COSIP' };
  }

  try {
    const data = await consultaCnpjComRetry(cnpjDigits);

    if (ehInstituicaoPublicaPorNatureza(data)) {
      return {
        ...reg,
        nome: data.razao_social || reg.nome,
        tipo: 'excluido',
        motivoExclusao: 'Instituição pública',
      };
    }
    if (ehEntidadeSemFinsLucrativosPorNatureza(data)) {
      return {
        ...reg,
        nome: data.razao_social || reg.nome,
        tipo: 'excluido',
        motivoExclusao: 'Associação/Fundação',
      };
    }

    const isSimples = data.opcao_pelo_simples === true;
    const cnaePrincipal = data.cnae_fiscal ? String(data.cnae_fiscal) : null;
    const match = cnaePrincipal ? CNAE_INDEX[normalizeCnae(cnaePrincipal)] : null;

    let aliquota = 0;
    let statusApuracao = 'ok';
    if (isSimples) {
      aliquota = 0;
    } else if (match) {
      aliquota = Number(match.aliquota_ir);
    } else {
      statusApuracao = 'sem-cnae-na-tabela';
    }

    const retencaoEsperada = statusApuracao === 'sem-cnae-na-tabela' ? null : reg.valorPago * (aliquota / 100);
    const diferenca = retencaoEsperada === null ? null : (reg.retencaoTxt - retencaoEsperada);

    // Usa a razão social oficial do cartão CNPJ (Receita) em vez do nome extraído do
    // texto/OCR do relatório, que às vezes vem com caractere estranho/quebrado.
    const nomeExtraido = reg.nome;
    const nomeOficial = data.razao_social || nomeExtraido;

    return {
      ...reg,
      nome: nomeOficial,
      nomeExtraido,
      tipo: 'ok',
      isSimples,
      cnaePrincipal,
      cnaeDescricao: match ? match.descricao : (data.cnae_fiscal_descricao || ''),
      aliquota,
      statusApuracao,
      retencaoEsperada,
      diferenca,
    };
  } catch (e) {
    return { ...reg, tipo: 'erro', erro: e.message || 'Erro na consulta' };
  }
}

// Documento normalizado (só dígitos) — chave de agrupamento por credor.
function chaveDocumento(r) {
  return onlyDigits(r.documento);
}

// Considera "mesmo lançamento" quando documento é igual e o valor pago bate com uma
// tolerância de meio centavo. Usar igualdade exata de centavo (Math.round) é frágil: dois
// valores que a tela mostra como "R$ 224.176,00" idênticos podem, por trás, ter uma fração
// mínima de diferença vinda de arredondamento de ponto flutuante ou de OCR — e aí a
// comparação exata falha e duplica o lançamento em vez de fundir.
function mesmoValor(a, b) {
  return Math.abs((a || 0) - (b || 0)) < 0.01;
}

// Funde os resultados de um novo relatório com os já acumulados: se o mesmo lançamento
// (mesmo documento + mesmo valor pago) já existir, NÃO duplica — junta numa linha só,
// somando a origem e ficando com a maior retenção informada entre os relatórios (porque
// "sem coluna de retenção" não quer dizer retenção zero, só que aquele relatório não trouxe
// essa informação).
function mesclarResultados(existentes, novos) {
  const resultado = existentes.map((r) => ({ ...r }));
  // Agrupa os índices existentes por documento pra não precisar varrer a lista toda
  // a cada novo registro; a comparação de valor (com tolerância) é feita só dentro do grupo.
  const indicesPorDocumento = new Map();
  resultado.forEach((r, i) => {
    if (r.tipo === 'erro') return; // erro não tem valorPago confiável pra chave
    const doc = chaveDocumento(r);
    if (!indicesPorDocumento.has(doc)) indicesPorDocumento.set(doc, []);
    indicesPorDocumento.get(doc).push(i);
  });

  for (const novo of novos) {
    if (novo.tipo === 'erro') {
      resultado.push(novo);
      continue;
    }

    const doc = chaveDocumento(novo);
    const candidatos = indicesPorDocumento.get(doc) || [];
    const idxExistente = candidatos.find((i) => {
      if (!mesmoValor(resultado[i].valorPago, novo.valorPago)) return false;
      // Se ambos têm mesRef (vieram de XLSX), só funde quando o mês for o mesmo
      if (resultado[i].mesRef && novo.mesRef && resultado[i].mesRef !== novo.mesRef) return false;
      return true;
    });

    if (idxExistente === undefined) {
      resultado.push(novo);
      if (!indicesPorDocumento.has(doc)) indicesPorDocumento.set(doc, []);
      indicesPorDocumento.get(doc).push(resultado.length - 1);
      continue;
    }

    // Já existe -> funde em vez de duplicar
    const existente = resultado[idxExistente];
    const origensJaListadas = existente.origem.split(' + ');
    if (!origensJaListadas.includes(novo.origem)) {
      existente.origem = `${existente.origem} + ${novo.origem}`;
    }
    existente.retencaoTxt = Math.max(existente.retencaoTxt || 0, novo.retencaoTxt || 0);
    existente.duplicado = true;

    if (existente.tipo === 'pf') {
      existente.retencaoEsperada = existente.retencaoTxt;
      existente.diferenca = 0;
    } else if (existente.retencaoEsperada !== null && existente.retencaoEsperada !== undefined) {
      existente.diferenca = existente.retencaoTxt - existente.retencaoEsperada;
    }
  }

  return resultado;
}

async function processar() {
  hideError();

  // Caminho XLSX: processa cada mês como lote separado
  if (xlsxRegistros !== null) {
    const grupos = xlsxRegistros;
    xlsxRegistros = null;

    if (grupos.length === 0) {
      showError('Nenhum registro válido encontrado na planilha.');
      return;
    }

    btnProcessar.disabled = true;
    statusLine.classList.remove('done');
    statusLine.style.display = 'flex';

    for (const grupo of grupos) {
      const { nome: origem, registros } = grupo;
      const resultadosNovos = [];
      for (let i = 0; i < registros.length; i++) {
        const reg = { ...registros[i], origem };
        setStatus(`[${origem}] Processando ${i + 1}/${registros.length}: ${reg.nome}...`);
        resultadosNovos.push(await processarRegistro(reg));
        await sleep(250);
      }
      lotes.push({ nome: origem, qtd: registros.length });
      atualizarLotesBox();
      const merged = mesclarResultados(ultimosResultados, resultadosNovos);
      const { comDivergencia, somaDiferenca } = renderResultados(merged);
      pararAnimacaoStatus();
      setStatus(`"${origem}" processado (${registros.length} registro(s)) — ${comDivergencia > 0 ? `${comDivergencia} divergência(s), ${formatMoeda(Math.abs(somaDiferenca))}` : 'sem divergências'}.`);
    }

    statusLine.classList.add('done');
    btnProcessar.disabled = false;
    btnNovoLote.style.display = 'inline-flex';
    fileInput.value = '';
    origemInput.value = '';
    return;
  }

  // Caminho texto (TXT/PDF)
  let registros;
  {
    const texto = txtInput.value;
    if (!texto.trim()) {
      showError('Cole o texto do relatório ou envie um arquivo .txt / .pdf / .xlsx.');
      return;
    }
    registros = parseLinhas(texto);
    if (registros.length === 0) {
      showError('Não foi possível identificar nenhum registro (CNPJ/CPF + valores) no texto colado. Confira o formato.');
      return;
    }
  }

  const origem = origemInput.value.trim() || `Relatório ${lotes.length + 1}`;

  btnProcessar.disabled = true;
  statusLine.classList.remove('done');
  statusLine.style.display = 'flex';

  const resultadosNovos = [];

  for (let i = 0; i < registros.length; i++) {
    const reg = { ...registros[i], origem };
    setStatus(`Processando ${i + 1} de ${registros.length} (${origem}): ${reg.nome}...`);
    resultadosNovos.push(await processarRegistro(reg));
    await sleep(250); // evita rate limit da API pública
  }

  lotes.push({ nome: origem, qtd: registros.length });
  atualizarLotesBox();

  // Acumula com o que já tinha sido processado antes (não substitui) — assim dá pra subir
  // vários relatórios em sequência e comparar tudo junto. Lançamentos repetidos (mesmo
  // documento + mesmo valor pago) são fundidos numa linha só, não duplicados.
  const { comDivergencia, somaDiferenca } = renderResultados(mesclarResultados(ultimosResultados, resultadosNovos));

  pararAnimacaoStatus();
  statusLine.classList.add('done');
  // Mensagem final reflete o resultado real da apuração (não só "processo concluído"),
  // já que o que importa aqui é o achado, não o processamento em si.
  const resumoAchado = comDivergencia > 0
    ? `${comDivergencia} divergência(s) encontrada(s) no total acumulado, somando ${formatMoeda(Math.abs(somaDiferenca))}.`
    : 'nenhuma divergência no total acumulado até aqui.';
  setStatus(`"${origem}" processado (${registros.length} registro(s)) — ${resumoAchado}`);

  btnProcessar.disabled = false;
  btnNovoLote.style.display = 'inline-flex';

  // Limpa o campo pra já deixar pronto pro próximo relatório
  txtInput.value = '';
  fileInput.value = '';
  origemInput.value = '';
}

async function reprocessarErros() {
  const indices = ultimosResultados
    .map((r, i) => (r.tipo === 'erro' ? i : -1))
    .filter((i) => i !== -1);

  if (indices.length === 0) return;

  btnReprocessarErros.disabled = true;
  btnReprocessarErros2.disabled = true;
  btnProcessar.disabled = true;
  statusLine.classList.remove('done');
  statusLine.style.display = 'flex';

  for (let k = 0; k < indices.length; k++) {
    const idx = indices[k];
    const reg = ultimosResultados[idx];
    setStatus(`Reprocessando ${k + 1} de ${indices.length}: ${reg.nome}...`);
    ultimosResultados[idx] = await processarRegistro(reg);
    await sleep(250);
  }

  pararAnimacaoStatus();
  statusLine.classList.add('done');
  setStatus(`Reprocessamento concluído: ${indices.length} registro(s) revisado(s).`);
  renderResultados(ultimosResultados); // já reajusta a visibilidade/disabled dos botões de reprocessar
  btnProcessar.disabled = false;
  btnReprocessarErros.disabled = false;
  btnReprocessarErros2.disabled = false;
}

let ultimosResultados = [];
let lotes = []; // [{nome, qtd}] — histórico dos relatórios já somados neste lote

function atualizarLotesBox() {
  if (lotes.length === 0) {
    lotesBox.style.display = 'none';
    lotesBox.innerHTML = '';
    return;
  }
  lotesBox.style.display = 'flex';
  lotesBox.innerHTML = `<span style="color:var(--muted); font-size:.8rem;">Relatórios no lote:</span>` +
    lotes.map((l) => `<span class="lote-chip">${escapeHtml(l.nome)} <b>(${l.qtd})</b></span>`).join('');
}

// Mostra o nome oficial (razão social do cartão CNPJ), com um tooltip indicando o nome
// que tinha sido extraído do relatório, caso sejam diferentes (ajuda a conferir se o
// texto original veio corrompido/com caractere estranho).
function renderNomeCell(r) {
  const nomeHtml = escapeHtml(r.nome);
  if (r.nomeExtraido && r.nomeExtraido !== r.nome) {
    return `<span title="Nome extraído do relatório: ${escapeHtml(r.nomeExtraido)}">${nomeHtml} <span style="color:var(--muted); font-size:.9em;">ⓘ</span></span>`;
  }
  return nomeHtml;
}

// Campo de % editável — clica, digita a alíquota que quiser (sobrescreve a da tabela de
// CNAE) e sai do campo pra recalcular a retenção esperada e a diferença daquela linha.
function renderAliquotaCell(r) {
  const valor = r.aliquota != null ? r.aliquota : '';
  const marcador = r.aliquotaManual ? ' title="Alíquota ajustada manualmente" style="border-color:var(--accent);"' : '';
  return `<input type="text" inputmode="decimal" class="aliquota-input" data-id="${r.id}" value="${valor}"${marcador}>`;
}

// Recalcula a retenção esperada/diferença de uma linha específica com uma alíquota
// definida manualmente pelo usuário (sobrescreve o que veio da tabela de CNAE, ou resolve
// um caso "CNAE não consta na tabela").
function ajustarAliquota(id, valorDigitado) {
  const novaAliquota = parseFloat(String(valorDigitado).replace(',', '.'));
  const linha = ultimosResultados.find((r) => r.id === id);
  if (!linha || isNaN(novaAliquota) || novaAliquota < 0) {
    renderResultados(ultimosResultados); // desfaz visualmente uma entrada inválida
    return;
  }
  linha.aliquota = novaAliquota;
  linha.aliquotaManual = true;
  linha.statusApuracao = 'ok';
  linha.retencaoEsperada = linha.valorPago * (novaAliquota / 100);
  linha.diferenca = linha.retencaoTxt - linha.retencaoEsperada;
  renderResultados(ultimosResultados);
}

resultsBody.addEventListener('change', (e) => {
  if (e.target.classList.contains('aliquota-input')) {
    ajustarAliquota(Number(e.target.dataset.id), e.target.value);
  }
});

function renderOrigemCell(r) {
  const badge = `<span class="badge origem">${escapeHtml(r.origem || '-')}</span>`;
  if (r.duplicado) {
    return `${badge}<br><span class="badge fundido" title="Mesmo documento e mesmo valor pago apareceram em mais de um relatório — as linhas foram fundidas em uma só, usando a maior retenção informada entre elas.">🔗 fundido</span>`;
  }
  return badge;
}

// Ordenação da tabela (ex.: agrupar por situação — optante do Simples primeiro, depois
// não optante, pessoa física, fora do escopo, erro). Só afeta a EXIBIÇÃO — a ordem de
// acumulação em `ultimosResultados` não muda, então fundir/exportar continua consistente.
let ordenacao = { campo: null, direcao: 1 };

// Categoria da situação de uma linha — usada tanto pro rank padrão quanto pra escolha
// de "destacar" uma situação específica (ver situacaoDestaque abaixo).
function situacaoCategoria(r) {
  if (r.tipo === 'erro') return 'erro';
  if (r.tipo === 'excluido') return 'excluido';
  if (r.tipo === 'pf') return 'pf';
  return r.isSimples ? 'simples' : 'nao-optante';
}

const RANK_SITUACAO_PADRAO = { simples: 0, 'nao-optante': 1, pf: 2, excluido: 3, erro: 4 };

// Se o usuário escolheu destacar uma situação (dropdown "Destacar situação"), ela vai pra
// frente de todo o resto — combinado com a seta de ordenar (clicar no cabeçalho inverte),
// dá pra jogar essa mesma situação escolhida tanto pro início quanto pro fim da tabela.
let situacaoDestaque = '';

function situacaoRank(r) {
  const categoria = situacaoCategoria(r);
  if (situacaoDestaque && categoria === situacaoDestaque) return -1;
  return RANK_SITUACAO_PADRAO[categoria];
}

function valorParaOrdenacao(r, campo) {
  switch (campo) {
    case 'credor': return (r.nome || '').toUpperCase();
    case 'documento': return onlyDigits(r.documento);
    case 'situacao': return situacaoRank(r);
    case 'cnae': return r.cnaePrincipal || '';
    case 'aliquota': return r.aliquota != null ? r.aliquota : -1;
    case 'origem': return (r.origem || '').toUpperCase();
    case 'valorPago': return r.valorPago || 0;
    case 'retencaoEsperada': return r.retencaoEsperada != null ? r.retencaoEsperada : -1;
    case 'retencaoTxt': return r.retencaoTxt || 0;
    case 'diferenca': return r.diferenca != null ? r.diferenca : -Infinity;
    default: return 0;
  }
}

function aplicarOrdenacao(resultados) {
  if (!ordenacao.campo) return resultados;
  const copia = resultados.slice();
  copia.sort((a, b) => {
    const va = valorParaOrdenacao(a, ordenacao.campo);
    const vb = valorParaOrdenacao(b, ordenacao.campo);
    const cmp = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
    return cmp * ordenacao.direcao;
  });
  return copia;
}

function atualizarSetasOrdenacao() {
  document.querySelectorAll('#resultsHeadRow th.sortable').forEach((th) => {
    const ativo = th.dataset.campo === ordenacao.campo;
    th.classList.toggle('sort-ativo', ativo);
    th.querySelector('.arrow').textContent = ativo ? (ordenacao.direcao === 1 ? '↑' : '↓') : '↕';
  });
}

document.getElementById('resultsHeadRow').addEventListener('click', (e) => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const campo = th.dataset.campo;
  ordenacao = ordenacao.campo === campo ? { campo, direcao: ordenacao.direcao * -1 } : { campo, direcao: 1 };
  renderResultados(ultimosResultados);
});

// Dropdown "Destacar situação": escolhe qual categoria vai pra frente de todas as outras.
// Já ativa a ordenação por Situação (ascendente = destaque primeiro); clicar no cabeçalho
// "Situação" depois inverte, jogando essa mesma categoria pro fim em vez do início.
document.getElementById('situacaoDestaqueSelect').addEventListener('change', (e) => {
  situacaoDestaque = e.target.value;
  ordenacao = { campo: 'situacao', direcao: 1 };
  renderResultados(ultimosResultados);
});

function renderResultados(resultados) {
  ultimosResultados = resultados; // mantém a ordem de acumulação intacta (não a ordenada)
  const TOLERANCIA = 0.02; // tolerância de arredondamento em R$

  let comDivergencia = 0;
  let semDivergencia = 0;
  let pessoasFisicas = 0;
  let erros = 0;
  let semCnaeNaTabela = 0;
  let fundidos = 0;
  let excluidos = 0;
  let somaEsperada = 0;
  let somaTxt = 0;
  let somaDiferenca = 0;

  const linhasHtml = aplicarOrdenacao(resultados).map((r) => {
    if (r.duplicado) fundidos++;
    if (r.tipo === 'excluido') {
      excluidos++;
      return `<tr>
        <td>${escapeHtml(r.nome)}</td>
        <td>${formatCnpj(onlyDigits(r.documento))}</td>
        <td><span class="badge excluido">Fora do escopo</span></td>
        <td colspan="2" style="color:var(--muted);">${escapeHtml(r.motivoExclusao)}</td>
        <td>${renderOrigemCell(r)}</td>
        <td class="num">${formatMoeda(r.valorPago)}</td>
        <td class="num">-</td>
        <td class="num">${formatMoeda(r.retencaoTxt)}</td>
        <td class="num">-</td>
      </tr>`;
    }
    if (r.tipo === 'pf') {
      pessoasFisicas++;
      semDivergencia++;
      somaEsperada += r.retencaoEsperada;
      somaTxt += r.retencaoTxt;
      somaDiferenca += r.diferenca;
      return `<tr class="ok-row">
        <td>${escapeHtml(r.nome)}</td>
        <td>${escapeHtml(r.documento)}</td>
        <td><span class="badge pf">Pessoa Física</span></td>
        <td style="color:var(--muted);">não valida CNAE</td>
        <td style="color:var(--muted);">-</td>
        <td>${renderOrigemCell(r)}</td>
        <td class="num">${formatMoeda(r.valorPago)}</td>
        <td class="num">${formatMoeda(r.retencaoEsperada)}</td>
        <td class="num">${formatMoeda(r.retencaoTxt)}</td>
        <td class="num" style="color:var(--green);font-weight:700;">${formatMoeda(0)}</td>
      </tr>`;
    }
    if (r.tipo === 'erro') {
      erros++;
      return `<tr>
        <td>${escapeHtml(r.nome)}</td>
        <td>${escapeHtml(r.documento)}</td>
        <td><span class="badge erro">Erro</span></td>
        <td colspan="2" style="color:var(--muted);">${renderOrigemCell(r)}</td>
        <td colspan="5" style="color:var(--red);">${escapeHtml(r.erro)}</td>
      </tr>`;
    }
    if (r.statusApuracao === 'sem-cnae-na-tabela') {
      semCnaeNaTabela++;
      return `<tr>
        <td>${renderNomeCell(r)}</td>
        <td>${formatCnpj(onlyDigits(r.documento))}</td>
        <td><span class="badge ${r.isSimples ? 'simples' : 'nao-simples'}">${r.isSimples ? 'Optante Simples' : 'Não optante'}</span></td>
        <td title="CNAE não consta na tabela de referência — informe a alíquota manualmente" style="color:var(--yellow);">${r.cnaePrincipal ? formatCnae(r.cnaePrincipal) : '-'} ⚠</td>
        <td>${renderAliquotaCell(r)}</td>
        <td>${renderOrigemCell(r)}</td>
        <td class="num">${formatMoeda(r.valorPago)}</td>
        <td class="num">-</td>
        <td class="num">${formatMoeda(r.retencaoTxt)}</td>
        <td class="num">-</td>
      </tr>`;
    }

    // Só nos interessa achar retenção A MENOR (reteve menos do que devia). Reter a mais
    // não é tratado como divergência nem entra na diferença total — não queremos que um
    // excesso de retenção em um credor "esconda"/compense a falta em outro.
    const divergente = r.diferenca < -TOLERANCIA;
    if (divergente) comDivergencia++; else semDivergencia++;
    somaEsperada += r.retencaoEsperada;
    somaTxt += r.retencaoTxt;
    somaDiferenca += Math.min(r.diferenca, 0);

    return `<tr class="${divergente ? 'diff-row' : 'ok-row'}">
      <td>${renderNomeCell(r)}</td>
      <td>${formatCnpj(onlyDigits(r.documento))}</td>
      <td><span class="badge ${r.isSimples ? 'simples' : 'nao-simples'}">${r.isSimples ? 'Optante Simples' : 'Não optante'}</span></td>
      <td title="${escapeHtml(r.cnaeDescricao)}">${r.cnaePrincipal ? formatCnae(r.cnaePrincipal) : '-'}</td>
      <td>${renderAliquotaCell(r)}</td>
      <td>${renderOrigemCell(r)}</td>
      <td class="num">${formatMoeda(r.valorPago)}</td>
      <td class="num">${formatMoeda(r.retencaoEsperada)}</td>
      <td class="num">${formatMoeda(r.retencaoTxt)}</td>
      <td class="num" style="color:${divergente ? 'var(--red)' : 'var(--green)'};font-weight:700;">${r.diferenca >= 0 ? '+' : ''}${formatMoeda(r.diferenca)}</td>
    </tr>`;
  }).join('');

  resultsBody.innerHTML = linhasHtml;

  summaryBox.innerHTML = `
    <div class="stat ${comDivergencia > 0 ? 'diff' : 'ok'}"><div class="n">${comDivergencia}</div><div class="l">Com Divergência</div></div>
    <div class="stat ok"><div class="n">${semDivergencia}</div><div class="l">Conferem</div></div>
    <div class="stat warn"><div class="n">${pessoasFisicas}</div><div class="l">Pessoa Física (não validado)</div></div>
    <div class="stat warn"><div class="n">${erros + semCnaeNaTabela}</div><div class="l">Fora do Escopo / Erro</div></div>
    ${fundidos > 0 ? `<div class="stat warn"><div class="n">${fundidos}</div><div class="l">Fundidos (duplicados entre relatórios)</div></div>` : ''}
    ${excluidos > 0 ? `<div class="stat"><div class="n">${excluidos}</div><div class="l">Fora do Escopo (conselho/banco/consórcio/público/cartório)</div></div>` : ''}
  `;

  // Os 3 cards de totais em R$ ficam num grupo à parte, sempre juntos na mesma linha
  // (não dependem de quantos cards de contagem vieram acima nem quebram entre si).
  summaryTotalsBox.innerHTML = `
    <div class="stat"><div class="n">${formatMoeda(somaEsperada)}</div><div class="l">Total Esperado</div></div>
    <div class="stat"><div class="n">${formatMoeda(somaTxt)}</div><div class="l">Total no Relatório</div></div>
    <div class="stat ${Math.abs(somaDiferenca) > TOLERANCIA ? 'diff' : 'ok'}"><div class="n">${somaDiferenca >= 0 ? '+' : ''}${formatMoeda(somaDiferenca)}</div><div class="l">Diferença Total</div></div>
  `;

  const temErros = erros > 0;
  btnReprocessarErros.style.display = temErros ? 'inline-flex' : 'none';
  btnReprocessarErros2.style.display = temErros ? 'inline-flex' : 'none';

  resultsCard.style.display = 'block';
  atualizarSetasOrdenacao();

  return { comDivergencia, somaDiferenca };
}

// --- Exportação -----------------------------------------------------------

function linhaParaLinhaPlanilha(r) {
  if (r.tipo === 'excluido') {
    return {
      'Credor': r.nome,
      'CNPJ/CPF': formatCnpj(onlyDigits(r.documento)),
      'Situação': 'Fora do escopo: ' + r.motivoExclusao,
      'CNAE Principal': '',
      '% Aplicável': '',
      'Origem': r.origem || '',
      'Valor Pago': r.valorPago,
      'Retenção Esperada': '',
      'Retenção no Relatório': r.retencaoTxt,
      'Diferença': '',
    };
  }
  if (r.tipo === 'pf') {
    return {
      'Credor': r.nome,
      'CNPJ/CPF': r.documento,
      'Situação': 'Pessoa Física (não validado)',
      'CNAE Principal': '',
      '% Aplicável': '',
      'Origem': r.origem || '',
      'Valor Pago': r.valorPago,
      'Retenção Esperada': r.retencaoEsperada,
      'Retenção no Relatório': r.retencaoTxt,
      'Diferença': 0,
    };
  }
  if (r.tipo === 'erro') {
    return {
      'Credor': r.nome,
      'CNPJ/CPF': r.documento,
      'Situação': 'Erro: ' + r.erro,
      'CNAE Principal': '',
      '% Aplicável': '',
      'Origem': r.origem || '',
      'Valor Pago': '',
      'Retenção Esperada': '',
      'Retenção no Relatório': '',
      'Diferença': '',
    };
  }
  if (r.statusApuracao === 'sem-cnae-na-tabela') {
    return {
      'Credor': r.nome,
      'CNPJ/CPF': formatCnpj(onlyDigits(r.documento)),
      'Situação': r.isSimples ? 'Optante Simples' : 'Não optante',
      'CNAE Principal': r.cnaePrincipal ? formatCnae(r.cnaePrincipal) : '',
      '% Aplicável': 'CNAE não consta na tabela',
      'Origem': r.origem || '',
      'Valor Pago': r.valorPago,
      'Retenção Esperada': '',
      'Retenção no Relatório': r.retencaoTxt,
      'Diferença': '',
    };
  }
  return {
    'Credor': r.nome,
    'CNPJ/CPF': formatCnpj(onlyDigits(r.documento)),
    'Situação': r.isSimples ? 'Optante Simples' : 'Não optante',
    'CNAE Principal': r.cnaePrincipal ? formatCnae(r.cnaePrincipal) : '',
    '% Aplicável': r.aliquota,
    'Origem': r.origem || '',
    'Valor Pago': r.valorPago,
    'Retenção Esperada': r.retencaoEsperada,
    'Retenção no Relatório': r.retencaoTxt,
    'Diferença': r.diferenca,
  };
}

function nomeArquivoComData(extensao) {
  const agora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const carimbo = `${agora.getFullYear()}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}_${pad(agora.getHours())}${pad(agora.getMinutes())}`;
  return `apuracao_ir_${carimbo}.${extensao}`;
}

function exportarExcel() {
  if (!ultimosResultados.length) return;
  if (!window.XLSX) {
    showError('Biblioteca de Excel não carregou. Recarregue a página e tente de novo.');
    return;
  }

  const linhas = ultimosResultados.map(linhaParaLinhaPlanilha);
  const planilha = XLSX.utils.json_to_sheet(linhas);
  planilha['!cols'] = [
    { wch: 38 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 12 },
    { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 },
  ];

  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, 'Apuração IR');
  XLSX.writeFile(livro, nomeArquivoComData('xlsx'));
}

function exportarPdf() {
  if (!ultimosResultados.length) return;
  const tituloOriginal = document.title;
  document.title = nomeArquivoComData('pdf').replace(/\.pdf$/, '');
  window.print();
  document.title = tituloOriginal;
}

document.getElementById('btnExportExcel').addEventListener('click', exportarExcel);
document.getElementById('btnExportPdf').addEventListener('click', exportarPdf);
document.getElementById('btnExportExcel2').addEventListener('click', exportarExcel);
document.getElementById('btnExportPdf2').addEventListener('click', exportarPdf);
btnReprocessarErros.addEventListener('click', reprocessarErros);
btnReprocessarErros2.addEventListener('click', reprocessarErros);
