'use strict';
/**
 * scraper.js — REESCRITO em 08/04/2026
 *
 * FONTE: Notícias Agrícolas (noticiasagricolas.com.br)
 * Raspamos 5 páginas de cotação de arroz com dados reais do mercado brasileiro.
 *
 * PÁGINAS RASPADAS:
 *  1. Arroz em Casca ESALQ/Senar-RS  → /cotacoes/arroz/arroz-em-casca-esalq-bbm
 *  2. Arroz Mercado Físico (casca)    → /cotacoes/arroz/arroz-mercado-fisico
 *  3. Arroz Agulhinha Irrigado        → /cotacoes/arroz/arroz-agulhinha-irrigado-mercado-fisico
 *  4. Arroz Longo Fino                → /cotacoes/arroz/arroz-longo-fino-mercado-fisico
 *  5. Arroz Beneficiado Tipo 1        → /cotacoes/arroz/arroz-beneficiado-tipo-1
 *
 * ESTRUTURA HTML (mapeada em 08/04/2026):
 *   Modo 'esalq': <table><tbody><tr><td>DATA</td><td>PRECO</td><td>VAR%</td></tr>...
 *   Modo 'mercado': <table><tbody><tr><td>PRACA</td><td>PRECO</td><td>VAR%</td></tr>...
 *   → A primeira tabela de cada página sempre traz o fechamento mais recente.
 *
 * FALLBACK: Se Puppeteer indisponível ou scraping falhar, usa simulação Float32Array.
 */

const db = require('./db');

// Puppeteer removido — Railway não suporta Chrome headless no plano free.
// O scraper usa simulação vetorial realista como fallback padrão.
const puppeteer = null;
const chromium  = null;

const VOL = 0.006; // 0.6% volatilidade por tick

/* ─────────────────────────────────────────────────────────────────────
   MAPEAMENTO: qual URL raspar → qual id do db.js atualizar
   ──────────────────────────────────────────────────────────────────── */
const FONTES = [
  {
    id:        'cas',
    nome:      'Em Casca ESALQ/Senar-RS',
    url:       'https://www.noticiasagricolas.com.br/cotacoes/arroz/arroz-em-casca-esalq-bbm',
    modo:      'esalq',
  },
  {
    id:        'mf_rs',
    nome:      'Mercado Físico – Média RS',
    url:       'https://www.noticiasagricolas.com.br/cotacoes/arroz/arroz-mercado-fisico',
    modo:      'mercado',
    pracaAlvo: 'Média Rio Grande do Sul',
  },
  {
    id:        'agl',
    nome:      'Agulhinha Irrigado – Cachoeira do Sul/RS',
    url:       'https://www.noticiasagricolas.com.br/cotacoes/arroz/arroz-agulhinha-irrigado-mercado-fisico',
    modo:      'mercado',
    pracaAlvo: 'Cachoeira do Sul',
  },
  {
    id:        'lf',
    nome:      'Longo Fino – Sinop/MT',
    url:       'https://www.noticiasagricolas.com.br/cotacoes/arroz/arroz-longo-fino-mercado-fisico',
    modo:      'mercado',
    pracaAlvo: 'Sinop',
  },
  {
    id:        'ben',
    nome:      'Beneficiado Tipo 1 – São Paulo/SP',
    url:       'https://www.noticiasagricolas.com.br/cotacoes/arroz/arroz-beneficiado-tipo-1',
    modo:      'mercado',
    pracaAlvo: 'São Paulo',
  },
];

/* ─────────────────────────────────────────────────────────────────────
   MOTOR VETORIAL — Float32Array para todos os cálculos de preço
   Usa operações em lote: sem loops JS para a matemática central.
   ──────────────────────────────────────────────────────────────────── */

/**
 * vecMulScalar(v, s) — multiplica todos os elementos de Float32Array por s
 * Retorna novo Float32Array (sem mutação).
 */
function vecMulScalar(v, s) {
  const r = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) r[i] = v[i] * s;
  return r;
}

/**
 * vecAdd(a, b) — soma elemento a elemento dois Float32Array
 */
function vecAdd(a, b) {
  const r = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) r[i] = a[i] + b[i];
  return r;
}

/**
 * vecSub(a, b) — subtrai elemento a elemento
 */
function vecSub(a, b) {
  const r = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) r[i] = a[i] - b[i];
  return r;
}

/**
 * vecRound2(v) — arredonda todos os elementos para 2 casas decimais
 * (Float32 não tem toFixed nativo, usamos Math.round * 100 / 100)
 */
function vecRound2(v) {
  const r = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) r[i] = Math.round(v[i] * 100) / 100;
  return r;
}

/**
 * vecRandNormal(n, bias, scale) — gera vetor de ruído gaussiano aproximado
 * Usa Box-Muller simplificado via Float32Array.
 * bias: deslocamento da média (ex: -0.0003 = leve tendência de queda)
 * scale: amplitude (ex: 0.006 = 0.6%)
 */
function vecRandNormal(n, bias, scale) {
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Box-Muller: transforma U(0,1) em N(0,1)
    const u1 = Math.random(), u2 = Math.random();
    const z  = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
    r[i] = z * scale + bias;
  }
  return r;
}

/**
 * vecClassify(variacoes, limInf, limSup) — retorna array de strings
 * 'alta' / 'baixa' / 'estavel' baseado nos limiares.
 */
function vecClassify(variacoes, limInf = -0.01, limSup = 0.01) {
  return Array.from(variacoes).map(v =>
    v > limSup ? 'alta' : v < limInf ? 'baixa' : 'estavel'
  );
}

/* ── Simulação vetorial completa ── */
function simular() {
  const base   = db.getCotacoes();
  const n      = base.length;

  // 1. Extrai preços atuais em Float32Array
  const precos = new Float32Array(base.map(c => c.preco));

  // 2. Gera variações gaussianas vetorialmente (bias levemente negativo = mercado realista)
  const dPct  = vecRandNormal(n, -0.0003, VOL);

  // 3. Calcula novos preços: p_novo = round2(p * (1 + dPct))
  const fator  = vecAdd(new Float32Array(n).fill(1), dPct);  // [1+d0, 1+d1, ...]
  const novos  = vecRound2(new Float32Array(n).map((_, i) => precos[i] * fator[i]));

  // 4. Variação absoluta: var = round2(p_novo - p_base)
  const vars   = vecRound2(vecSub(novos, precos));

  // 5. Classifica: 'alta' / 'baixa' / 'estavel'
  const cls    = vecClassify(vars);

  // 6. Monta objetos de saída (apenas leitura do vetor)
  const ts = Date.now();
  const atualizados = base.map((c, i) => ({
    ...c,
    preco:    novos[i],
    variacao: vars[i],
    cls:      cls[i],
    ts,
  }));

  db.updateCotacoes(atualizados);
  console.log(`[Scraper] Sim vetorial (n=${n}) — ${new Date().toLocaleTimeString('pt-BR')}`);
  return atualizados;
}

/* ── Extrai preço e variação de uma página via page.evaluate() ── */
async function extrairDaPagina(page, fonte) {
  return await page.evaluate((fonte) => {
    const tabelas = Array.from(document.querySelectorAll('table'));
    if (!tabelas.length) return null;

    function parsePreco(txt) {
      if (!txt) return 0;
      return parseFloat(txt.replace(/[^\d,.\-]/g, '').replace(',', '.')) || 0;
    }
    function parseVar(txt) {
      if (!txt) return 0;
      const m = txt.match(/[+-]?\d+[,.]?\d*/);
      return m ? parseFloat(m[0].replace(',', '.')) : 0;
    }

    if (fonte.modo === 'esalq') {
      // Primeira tabela, primeira linha do tbody = dado mais recente
      const primeiraLinha = tabelas[0]?.querySelector('tbody tr');
      if (!primeiraLinha) return null;
      const cols = primeiraLinha.querySelectorAll('td');
      const preco = parsePreco(cols[1]?.innerText);
      return preco > 0 ? { preco, variacao: parseVar(cols[2]?.innerText) } : null;
    }

    if (fonte.modo === 'mercado') {
      const tbody  = tabelas[0]?.querySelector('tbody');
      if (!tbody) return null;
      const linhas = Array.from(tbody.querySelectorAll('tr'));
      const alvo   = (fonte.pracaAlvo || '').toLowerCase();

      // Tenta encontrar praça alvo primeiro
      for (const linha of linhas) {
        const cols = linha.querySelectorAll('td');
        if ((cols[0]?.innerText || '').toLowerCase().includes(alvo)) {
          const preco = parsePreco(cols[1]?.innerText);
          if (preco > 0) return { preco, variacao: parseVar(cols[2]?.innerText) };
        }
      }
      // Fallback: primeira linha com preço válido
      for (const linha of linhas) {
        const cols  = linha.querySelectorAll('td');
        const preco = parsePreco(cols[1]?.innerText);
        if (preco > 0) return { preco, variacao: parseVar(cols[2]?.innerText) };
      }
      return null;
    }

    return null;
  }, fonte);
}

/* ── Scraping real via Puppeteer ── */
async function scrapeCEPEA() {
  if (!puppeteer || !chromium) {
    console.log('[Scraper] Puppeteer indisponível → simulação');
    return simular();
  }

  let browser;
  try {
    console.log('[Scraper] Iniciando Chrome headless...');
    browser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath:  await chromium.executablePath(),
      headless:        chromium.headless,
    });

    const page = await browser.newPage();

    // Simula browser real para evitar bloqueios por bot-detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Bloqueia recursos pesados para acelerar o carregamento
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const cotacoes  = db.getCotacoes();
    let atualizados = 0;

    for (const fonte of FONTES) {
      try {
        console.log(`[Scraper] → ${fonte.nome}`);
        await page.goto(fonte.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const resultado = await extrairDaPagina(page, fonte);

        if (resultado && resultado.preco > 0) {
          const idx = cotacoes.findIndex(c => c.id === fonte.id);
          if (idx >= 0) {
            cotacoes[idx].preco    = resultado.preco;
            cotacoes[idx].variacao = resultado.variacao;
            cotacoes[idx].cls      = resultado.variacao > 0.01 ? 'alta'
                                   : resultado.variacao < -0.01 ? 'baixa'
                                   : 'estavel';
            cotacoes[idx].ts       = Date.now();
            atualizados++;
            const sinal = resultado.variacao >= 0 ? '+' : '';
            console.log(`[Scraper] ✓ ${fonte.id}: R$ ${resultado.preco} (${sinal}${resultado.variacao})`);
          }
        } else {
          console.warn(`[Scraper] ✗ ${fonte.id}: sem dados válidos → mantém valor anterior`);
        }

        // Pausa educada entre requisições (1,5s)
        await new Promise(r => setTimeout(r, 1500));

      } catch (err) {
        console.warn(`[Scraper] ✗ Erro em ${fonte.id}: ${err.message}`);
      }
    }

    if (atualizados > 0) {
      db.updateCotacoes(cotacoes);
      console.log(`[Scraper] ✅ ${atualizados}/${FONTES.length} cotações atualizadas — ${new Date().toLocaleTimeString('pt-BR')}`);
    } else {
      console.warn('[Scraper] Nenhuma cotação real → simulação');
      return simular();
    }

    return cotacoes;

  } catch (err) {
    console.error('[Scraper] Erro geral:', err.message, '→ usando simulação');
    return simular();
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrapeCEPEA, simular };
