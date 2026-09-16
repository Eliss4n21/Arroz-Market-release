'use strict';

// Só publica valores acompanhados da data do pregão e da fonte.
// Uma falha de coleta preserva o último registro datado; nunca cria preços.
const db = require('./db');
if (typeof globalThis.File === 'undefined') globalThis.File = require('node:buffer').File;
const cheerio = require('cheerio');

const CEPEA_URL = 'https://cepea.org.br/br/indicador/arroz.aspx';
const NA_BASE = (process.env.SCRAPE_BASE_URL || 'https://www.noticiasagricolas.com.br').replace(/\/$/, '');
const FONTES = [
  { id:'mf_rs', nome:'Mercado Físico – Média RS', unidade:'sc 50kg',
    caminho:'/cotacoes/arroz/arroz-mercado-fisico', alvo:'média rio grande do sul' },
  { id:'agl', nome:'Agulhinha Irrigado – Cachoeira do Sul/RS', unidade:'sc 50kg',
    caminho:'/cotacoes/arroz/arroz-agulhinha-irrigado-mercado-fisico', alvo:'cachoeira' },
  { id:'lf', nome:'Longo Fino – Sinop/MT', unidade:'sc 60kg',
    caminho:'/cotacoes/arroz/arroz-longo-fino-mercado-fisico', alvo:'sinop' },
  { id:'ben', nome:'Beneficiado Tipo 1 – São Paulo/SP', unidade:'sc 60kg',
    caminho:'/cotacoes/arroz/arroz-beneficiado-tipo-1', alvo:'são paulo' },
];

function numeroBR(valor) {
  const texto = String(valor || '').trim().replace(/[^\d,.-]/g, '');
  if (!texto || texto === '-') return NaN;
  return Number(texto.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
}
function dataISO(valor) {
  if (typeof valor !== 'string') return null;
  const br = valor.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const data = new Date(`${iso}T12:00:00Z`);
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone:'America/Sao_Paulo' });
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(iso) && iso <= hoje ? iso : null;
}
function variacaoAbsoluta(preco, percentual) {
  if (!Number.isFinite(percentual) || percentual <= -100) return 0;
  return Math.round((preco - preco / (1 + percentual / 100)) * 100) / 100;
}
function completarCotacao(c, variacao) {
  const v = Math.round(variacao * 100) / 100;
  return { ...c, variacao:v, cls:v > 0.01 ? 'alta' : v < -0.01 ? 'baixa' : 'estavel' };
}

function parseCepea(html) {
  const $ = cheerio.load(html);
  const tabela = $('table').filter((_, t) => $(t).find('th').text().includes('Valor R$')).first();
  if (!tabela.length) throw new Error('Tabela diária do Cepea não encontrada');
  const pontos = [];
  tabela.find('tr').each((_, tr) => {
    const cols = $(tr).find('td');
    if (cols.length < 2) return;
    const dataCotacao = dataISO($(cols[0]).text());
    const preco = numeroBR($(cols[1]).text());
    const percentual = numeroBR($(cols[2]).text());
    if (!dataCotacao || !Number.isFinite(preco) || preco <= 0) return;
    pontos.push({ id:'cas', nome:'Em Casca (CEPEA/IRGA-RS)', preco,
      dataCotacao, unidade:'sc 50kg', fonte:'Cepea/Esalq', fonteUrl:CEPEA_URL,
      percentual });
  });
  if (!pontos.length) throw new Error('Nenhum preço diário válido no Cepea');
  pontos.sort((a,b) => a.dataCotacao.localeCompare(b.dataCotacao));
  return pontos.map((p, i) => {
    const { percentual, ...cotacao } = p;
    const variacao = i ? p.preco - pontos[i-1].preco : variacaoAbsoluta(p.preco, percentual);
    return completarCotacao(cotacao, variacao);
  });
}

function parseNoticias(html, fonte) {
  const $ = cheerio.load(html);
  const pontos = [];
  $('table').filter((_, t) => /Praça/i.test($(t).find('th').text())).each((_, tabela) => {
    const bloco = $(tabela).closest('.cotacao').children().not('.table-content').text();
    const dataCotacao = dataISO(bloco.match(/Fechamento:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]);
    if (!dataCotacao) return;
    const origem = bloco.match(/Fonte:\s*([^\n\r]+)/i)?.[1]?.trim();
    $(tabela).find('tbody tr').each((_, tr) => {
      const cols = $(tr).find('td');
      if (cols.length < 2) return;
      const praca = $(cols[0]).text().toLocaleLowerCase('pt-BR');
      if (!praca.includes(fonte.alvo)) return;
      const preco = numeroBR($(cols[1]).text());
      if (!Number.isFinite(preco) || preco <= 0) return;
      pontos.push({ id:fonte.id, nome:fonte.nome, preco, dataCotacao,
        unidade:fonte.unidade, fonte:origem || 'Notícias Agrícolas',
        fonteUrl:NA_BASE + fonte.caminho, percentual:numeroBR($(cols[2]).text()) });
    });
  });
  if (!pontos.length) throw new Error(`Praça ${fonte.alvo} sem preço datado`);
  pontos.sort((a,b) => a.dataCotacao.localeCompare(b.dataCotacao));
  return pontos.map((p, i) => {
    const { percentual, ...cotacao } = p;
    const variacao = i ? p.preco - pontos[i-1].preco : variacaoAbsoluta(p.preco, percentual);
    return completarCotacao(cotacao, variacao);
  });
}

async function buscarHtml(url, agenteNoticias = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const opcoes = { signal:controller.signal };
    // O Cepea recusa um User-Agent customizado; Notícias Agrícolas exige um.
    if (agenteNoticias) opcoes.headers = {
      'User-Agent':'Mozilla/5.0 ArrozMarket/1.1', 'Accept':'text/html'
    };
    const resposta = await fetch(url, opcoes);
    if (!resposta.ok) {
      const erro = new Error(`HTTP ${resposta.status}`);
      erro.status = resposta.status;
      throw erro;
    }
    return await resposta.text();
  } finally { clearTimeout(timeout); }
}

async function lerGoogleSheets(sheetsUrl) {
  const match = String(sheetsUrl || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('URL de planilha inválida');
  const url = `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:json&sheet=Cotacoes`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let resposta;
  try { resposta = await fetch(url, { signal:controller.signal }); }
  finally { clearTimeout(timeout); }
  if (!resposta.ok) throw new Error(`Google Sheets HTTP ${resposta.status}`);
  const texto = await resposta.text();
  const json = JSON.parse(texto.replace(/^[\s\S]*?setResponse\(/, '').replace(/\);?\s*$/, ''));
  const cotacoes = [];
  for (const row of json.table?.rows || []) {
    const c = row.c || [];
    const id = String(c[0]?.v || '').trim();
    const preco = numeroBR(c[2]?.v);
    const variacao = numeroBR(c[3]?.v);
    const dataCotacao = dataISO(String(c[5]?.f || c[5]?.v || ''));
    const fonte = [{ id:'cas', nome:'Em Casca (CEPEA/IRGA-RS)', unidade:'sc 50kg' },
      ...FONTES].find(x => x.id === id);
    if (!fonte || !dataCotacao || !Number.isFinite(preco) || preco <= 0) continue;
    cotacoes.push(completarCotacao({ id, nome:fonte.nome, preco, dataCotacao,
      unidade:String(c[4]?.v || fonte.unidade).trim(), fonte:'Google Sheets', fonteUrl:url },
      Number.isFinite(variacao) ? variacao : 0));
  }
  if (!cotacoes.length) throw new Error('Planilha sem cotações válidas com data na coluna F');
  return cotacoes;
}

let emAndamento = null;
function scrapeCEPEA() {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    const erros = [];
    const coletados = [];
    try { coletados.push(...parseCepea(await buscarHtml(CEPEA_URL))); }
    catch (e) { erros.push(`Cepea: ${e.message}`); }
    for (const fonte of FONTES) {
      try { coletados.push(...parseNoticias(await buscarHtml(NA_BASE + fonte.caminho, true), fonte)); }
      catch (e) {
        erros.push(`${fonte.id}: ${e.message}`);
        if (e.status === 403) break;
      }
    }
    const faltantes = new Set(['cas', ...FONTES.map(f => f.id)]);
    for (const c of coletados) faltantes.delete(c.id);
    if (faltantes.size && db.getConfig()?.sheetsUrl) {
      try {
        for (const c of await lerGoogleSheets(db.getConfig().sheetsUrl)) {
          if (faltantes.has(c.id)) coletados.push(c);
        }
      } catch (e) { erros.push(`Google Sheets: ${e.message}`); }
    }
    if (!coletados.length) throw new Error(`Nenhuma cotação datada obtida. ${erros.join('; ')}`);
    db.mergeCotacoes(coletados);
    console.log(`[Scraper] ${new Set(coletados.map(c => c.id)).size} classificação(ões) verificadas. ${erros.join('; ')}`);
    return { cotacoes:db.getCotacoes(), atualizados:new Set(coletados.map(c => c.id)).size, erros };
  })().finally(() => { emAndamento = null; });
  return emAndamento;
}

module.exports = { scrapeCEPEA, lerGoogleSheets, parseCepea, parseNoticias, dataISO };
