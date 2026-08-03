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

/* ── fetch nativo do Node 18+ (sem depender de node-fetch instalado) ── */
const fetch = globalThis.fetch;
let cheerio;
try { cheerio = require('cheerio'); } catch(e) { cheerio = null; }

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
   GOOGLE SHEETS — fonte primária opcional
   Mais confiável que scraping direto: usa a API pública
   gviz do Google, que não sofre bloqueio anti-bot como
   sites de notícias costumam aplicar.
   Formato esperado da aba "Cotacoes": id,nome,preco,variacao,unidade
───────────────────────────────────────── */
async function lerGoogleSheets(sheetsUrl) {
  if (!fetch) throw new Error('fetch nativo indisponível (requer Node 18+)');
  const match = (sheetsUrl || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('URL de planilha inválida');
  const id = match[1];
  const jsonUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=Cotacoes`;

  const resp = await fetch(jsonUrl, { timeout: 15000 });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao acessar a planilha`);
  const txt = await resp.text();
  const json = JSON.parse(txt.replace(/^[^(]+\(|\);?$/g, ''));
  const rows = json.table?.rows || [];

  const cotacoesAtuais = db.getCotacoes();
  let atualizados = 0;

  for (const row of rows) {
    const c = row.c;
    const cid      = (c[0]?.v || '').toString().trim();
    const preco    = parseFloat((c[2]?.v ?? '0').toString().replace(',', '.'));
    const variacao = parseFloat((c[3]?.v ?? '0').toString().replace(',', '.'));
    if (!cid || !isFinite(preco) || preco <= 0) continue;

    const idx = cotacoesAtuais.findIndex(x => x.id === cid);
    if (idx >= 0) {
      cotacoesAtuais[idx].preco    = preco;
      cotacoesAtuais[idx].variacao = isFinite(variacao) ? variacao : 0;
      cotacoesAtuais[idx].cls      = variacao > 0.01 ? 'alta' : variacao < -0.01 ? 'baixa' : 'estavel';
      cotacoesAtuais[idx].ts       = Date.now();
      cotacoesAtuais[idx].fonte    = 'Google Sheets';
      atualizados++;
    }
  }

  if (atualizados === 0) throw new Error('Nenhuma cotação válida encontrada na aba "Cotacoes"');
  db.updateCotacoes(cotacoesAtuais);
  console.log(`[Scraper] ✅ Google Sheets: ${atualizados}/${cotacoesAtuais.length} cotações atualizadas — ${new Date().toLocaleTimeString('pt-BR')}`);
  return cotacoesAtuais;
}

/* ─────────────────────────────────────────
   SCRAPING REAL via fetch + cheerio
───────────────────────────────────────── */
async function scrapeCEPEA() {
  if (!fetch || !cheerio) {
    if (!fetch)   console.error('❌ [Scraper] fetch nativo indisponível — Node.js < 18 no servidor. Verifique a versão do Node no painel Hostinger.');
    if (!cheerio) console.error('❌ [Scraper] cheerio não instalado — rode "npm install" no servidor ou verifique o deploy.');
    console.warn('[Scraper] → usando simulação até isso ser corrigido');
    return simular();
  }

  const cotacoes  = db.getCotacoes();
  let   atualizados = 0;

  // Headers mais completos — imita um browser real com mais fidelidade.
  // Isso NÃO garante passar por proteção anti-bot baseada em impressão
  // digital de TLS (WAFs tipo Cloudflare verificam a conexão em si, não
  // só os headers), mas aumenta a chance em bloqueios mais simples.
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': BASE_URL + '/',
    'Sec-Ch-Ua': '"Chromium";v="126", "Not.A/Brand";v="8"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive',
  };

  /* Busca com retry — 2 tentativas com pausa crescente, já que alguns
     bloqueios anti-bot são por limite de taxa (rate limit), não bloqueio
     permanente, e uma segunda tentativa pode ter sucesso. */
  async function fetchComRetry(url, tentativas = 2) {
    let ultimoErro;
    for (let i = 0; i < tentativas; i++) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 20000);
        const resp = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
        clearTimeout(tid);
        if (!resp.ok) {
          const corpo = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status} — ${corpo.slice(0, 150).replace(/\s+/g, ' ')}`);
        }
        return await resp.text();
      } catch(err) {
        ultimoErro = err;
        if (i < tentativas - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    }
    throw ultimoErro;
  }

  for (const fonte of FONTES) {
    try {
      const url = BASE_URL + fonte.url;
      console.log(`[Scraper] → ${fonte.nome}`);

      const html = await fetchComRetry(url);
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
        console.warn(`[Scraper] ✗ ${fonte.id}: página respondeu mas sem dados reconhecíveis → mantém anterior`);
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

  // Fallback: Google Sheets, se configurado, antes de cair para simulação
  const sheetsUrl = db.getConfig()?.sheetsUrl;
  if (sheetsUrl) {
    try {
      console.warn('[Scraper] Scraping direto falhou em todas as fontes — tentando Google Sheets configurado...');
      return await lerGoogleSheets(sheetsUrl);
    } catch(e) {
      console.warn('[Scraper] Google Sheets também falhou:', e.message);
    }
  }

  console.warn('[Scraper] Nenhuma cotação real obtida → simulação');
  return simular();
}

module.exports = { scrapeCEPEA, simular, lerGoogleSheets };
