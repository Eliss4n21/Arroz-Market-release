'use strict';
/**
 * scraper.js — Scraping real via fetch + cheerio (sem Puppeteer)
 *
 * Funciona em qualquer VPS Linux (Hostgator, DigitalOcean, etc.)
 * sem precisar de Chrome headless.
 *
 * FONTE: Notícias Agrícolas (noticiasagricolas.com.br)
 * PÁGINAS:
 *   cas   → /cotacoes/arroz/arroz-em-casca-esalq-bbm
 *   mf_rs → /cotacoes/arroz/arroz-mercado-fisico
 *   agl   → /cotacoes/arroz/arroz-agulhinha-irrigado-mercado-fisico
 *   lf    → /cotacoes/arroz/arroz-longo-fino-mercado-fisico
 *   ben   → /cotacoes/arroz/arroz-beneficiado-tipo-1
 *
 * FALLBACK: simulação vetorial (Float32Array) quando scraping falha.
 */

const db = require('./db');

/* ── Importação dinâmica: não quebra se libs não instaladas ainda ── */
let fetch, cheerio;
try { fetch   = require('node-fetch'); } catch(e) { fetch   = null; }
try { cheerio = require('cheerio');    } catch(e) { cheerio = null; }

/* ─────────────────────────────────────────
   MAPEAMENTO DE FONTES
───────────────────────────────────────── */
const FONTES = [
  { id:'cas',   nome:'Em Casca ESALQ/Senar-RS',
    url:'/cotacoes/arroz/arroz-em-casca-esalq-bbm',       modo:'esalq'   },
  { id:'mf_rs', nome:'Mercado Físico – Média RS',
    url:'/cotacoes/arroz/arroz-mercado-fisico',            modo:'mercado', alvo:'Rio Grande do Sul' },
  { id:'agl',   nome:'Agulhinha Irrigado – Cachoeira do Sul/RS',
    url:'/cotacoes/arroz/arroz-agulhinha-irrigado-mercado-fisico', modo:'mercado', alvo:'Cachoeira' },
  { id:'lf',    nome:'Longo Fino – Sinop/MT',
    url:'/cotacoes/arroz/arroz-longo-fino-mercado-fisico', modo:'mercado', alvo:'Sinop' },
  { id:'ben',   nome:'Beneficiado Tipo 1 – São Paulo/SP',
    url:'/cotacoes/arroz/arroz-beneficiado-tipo-1',        modo:'mercado', alvo:'São Paulo' },
];

const BASE_URL  = (process.env.SCRAPE_BASE_URL || 'https://www.noticiasagricolas.com.br').replace(/\/$/, '');
const VOL       = 0.005; // 0.5% volatilidade por tick (simulação)

/* ─────────────────────────────────────────
   MOTOR VETORIAL — Float32Array puro
   Todas as operações matemáticas em batch
───────────────────────────────────────── */
function vecAdd(a, b)        { const r=new Float32Array(a.length); for(let i=0;i<a.length;i++) r[i]=a[i]+b[i]; return r; }
function vecSub(a, b)        { const r=new Float32Array(a.length); for(let i=0;i<a.length;i++) r[i]=a[i]-b[i]; return r; }
function vecMulEl(a, b)      { const r=new Float32Array(a.length); for(let i=0;i<a.length;i++) r[i]=a[i]*b[i]; return r; }
function vecRound2(v)        { const r=new Float32Array(v.length); for(let i=0;i<v.length;i++) r[i]=Math.round(v[i]*100)/100; return r; }
function vecFill(n, val)     { return new Float32Array(n).fill(val); }
function vecRandNormal(n, bias, scale) {
  const r = new Float32Array(n);
  for (let i=0; i<n; i++) {
    const u1 = Math.random(), u2 = Math.random();
    const z  = Math.sqrt(-2*Math.log(Math.max(u1,1e-9))) * Math.cos(2*Math.PI*u2);
    r[i] = z * scale + bias;
  }
  return r;
}
function vecClassify(vars) {
  return Array.from(vars).map(v => v > 0.01 ? 'alta' : v < -0.01 ? 'baixa' : 'estavel');
}

/* ─────────────────────────────────────────
   SIMULAÇÃO VETORIAL (fallback)
───────────────────────────────────────── */
function simular() {
  const base   = db.getCotacoes();
  const n      = base.length;
  const precos = new Float32Array(base.map(c => c.preco));
  const dPct   = vecRandNormal(n, -0.0002, VOL);
  const fator  = vecAdd(vecFill(n, 1), dPct);
  const novos  = vecRound2(vecMulEl(precos, fator));
  const vars   = vecRound2(vecSub(novos, precos));
  const cls    = vecClassify(vars);
  const ts     = Date.now();
  const result = base.map((c, i) => ({ ...c, preco: novos[i], variacao: vars[i], cls: cls[i], ts, fonte: 'Simulação' }));
  db.updateCotacoes(result);
  console.log(`[Scraper] Simulação vetorial (n=${n}) — ${new Date().toLocaleTimeString('pt-BR')}`);
  return result;
}

/* ─────────────────────────────────────────
   PARSE DO HTML com cheerio
───────────────────────────────────────── */
function parseHtml(html, fonte) {
  const $ = cheerio.load(html);
  const tabela = $('table').first();
  if (!tabela.length) return null;

  function parseNum(txt) {
    if (!txt) return 0;
    // Remove R$, espaços, pontos de milhar; troca vírgula por ponto
    return parseFloat(txt.replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')) || 0;
  }

  if (fonte.modo === 'esalq') {
    // Primeira linha do tbody = fechamento mais recente
    const cols = tabela.find('tbody tr').first().find('td');
    const preco    = parseNum($(cols[1]).text());
    const variacao = parseNum($(cols[2]).text());
    return preco > 0 ? { preco, variacao } : null;
  }

  if (fonte.modo === 'mercado') {
    const alvo = (fonte.alvo || '').toLowerCase();
    let resultado = null;
    tabela.find('tbody tr').each((_, tr) => {
      if (resultado) return;
      const cols = $(tr).find('td');
      const praca = $(cols[0]).text().toLowerCase();
      // Tenta encontrar a praça alvo; fallback = primeira linha com preço válido
      if (!alvo || praca.includes(alvo)) {
        const preco = parseNum($(cols[1]).text());
        if (preco > 0) resultado = { preco, variacao: parseNum($(cols[2]).text()) };
      }
    });
    // Fallback: qualquer linha com preço válido
    if (!resultado) {
      tabela.find('tbody tr').each((_, tr) => {
        if (resultado) return;
        const cols  = $(tr).find('td');
        const preco = parseNum($(cols[1]).text());
        if (preco > 0) resultado = { preco, variacao: parseNum($(cols[2]).text()) };
      });
    }
    return resultado;
  }
  return null;
}

/* ─────────────────────────────────────────
   SCRAPING REAL via fetch + cheerio
───────────────────────────────────────── */
async function scrapeCEPEA() {
  // Se as libs não estiverem instaladas, usa simulação
  if (!fetch || !cheerio) {
    console.warn('[Scraper] node-fetch ou cheerio não instalados → simulação');
    return simular();
  }

  const cotacoes  = db.getCotacoes();
  let   atualizados = 0;

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Referer': BASE_URL,
  };

  for (const fonte of FONTES) {
    try {
      const url = BASE_URL + fonte.url;
      console.log(`[Scraper] → ${fonte.nome}`);

      const resp = await fetch(url, { headers: HEADERS, timeout: 20000 });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();

      const resultado = parseHtml(html, fonte);
      if (resultado && resultado.preco > 0) {
        const idx = cotacoes.findIndex(c => c.id === fonte.id);
        if (idx >= 0) {
          const varAbs = Math.round((resultado.preco - cotacoes[idx].preco) * 100) / 100;
          cotacoes[idx].preco    = resultado.preco;
          cotacoes[idx].variacao = isFinite(resultado.variacao) ? resultado.variacao : varAbs;
          cotacoes[idx].cls      = cotacoes[idx].variacao > 0.01 ? 'alta'
                                 : cotacoes[idx].variacao < -0.01 ? 'baixa' : 'estavel';
          cotacoes[idx].ts       = Date.now();
          cotacoes[idx].fonte    = 'Notícias Agrícolas';
          atualizados++;
          const s = cotacoes[idx].variacao >= 0 ? '+' : '';
          console.log(`[Scraper] ✓ ${fonte.id}: R$ ${resultado.preco} (${s}${cotacoes[idx].variacao})`);
        }
      } else {
        console.warn(`[Scraper] ✗ ${fonte.id}: sem dados → mantém anterior`);
      }

      // Pausa educada: 1,5s entre requests para não sobrecarregar o site fonte
      await new Promise(r => setTimeout(r, 1500));

    } catch (err) {
      console.warn(`[Scraper] ✗ Erro em ${fonte.id}: ${err.message}`);
    }
  }

  if (atualizados > 0) {
    db.updateCotacoes(cotacoes);
    console.log(`[Scraper] ✅ ${atualizados}/${FONTES.length} cotações atualizadas — ${new Date().toLocaleTimeString('pt-BR')}`);
    return cotacoes;
  }

  console.warn('[Scraper] Nenhuma cotação real obtida → simulação');
  return simular();
}

module.exports = { scrapeCEPEA, simular };
