'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arrozmarket-prices-test-'));
process.env.DATA_DIR = dir;
process.env.AUDIO_DIR = path.join(dir, 'audios');
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  usuarios:[{ id:1, ativo:true, role:'admin' }], videos:[],
  cotacoes:[{ id:'cas', preco:64.36, fonte:'Simulação', ts:1783713207097 }],
  historicoCotacoes:[], curtidas:{}, comentarios:{},
  config:{ proximoId:10, sheetsUrl:'' },
}));
const db = require('../src/db');
const scraper = require('../src/scraper');

test.after(() => {
  const raiz = path.resolve(os.tmpdir()) + path.sep;
  if (path.resolve(dir).startsWith(raiz)) fs.rmSync(dir, { recursive:true, force:true });
});

test('descarta a simulação antiga e importa apenas dias documentados', () => {
  const cotacoes = db.getCotacoes();
  assert.equal(cotacoes.length, 1);
  assert.deepEqual([cotacoes[0].id, cotacoes[0].dataCotacao, cotacoes[0].preco],
    ['cas', '2026-09-16', 81.39]);
  assert.ok(db.getHistoricoCotacoes().every(c => c.fonte !== 'Simulação' && /^\d{4}-\d{2}-\d{2}$/.test(c.dataCotacao)));
});

test('extrai datas e diferenças reais do indicador Cepea', () => {
  const html = '<table><thead><tr><th>Data</th><th>Valor R$</th><th>Var./Dia</th></tr></thead>' +
    '<tbody><tr><td>16/09/2026</td><td>81,39</td><td>1,29%</td></tr>' +
    '<tr><td>15/09/2026</td><td>80,35</td><td>0,71%</td></tr></tbody></table>';
  const pontos = scraper.parseCepea(html);
  assert.deepEqual(pontos.map(p => [p.dataCotacao, p.preco, p.variacao]),
    [['2026-09-15',80.35,0.57], ['2026-09-16',81.39,1.04]]);
});

test('usa a praça exata e a data de cada tabela do mercado físico', () => {
  const tabela = (data, preco) => `<div class="cotacao"><h2>Fechamento: ${data}</h2>` +
    `<p>Fonte: Revista Planeta Arroz</p><div class="table-content"><table>` +
    `<thead><tr><th>Praça</th><th>Preço</th><th>Variação</th></tr></thead><tbody>` +
    `<tr><td>Outra praça</td><td>99,00</td><td>0,00</td></tr>` +
    `<tr><td>Cachoeira do Sul/RS</td><td>${preco}</td><td>+1,00</td></tr>` +
    `</tbody></table></div></div>`;
  const pontos = scraper.parseNoticias(tabela('16/09/2026','61,00') +
    tabela('15/09/2026','60,50'), {
      id:'agl', nome:'Agulhinha', unidade:'sc 50kg', alvo:'cachoeira', caminho:'/origem'
    });
  assert.deepEqual(pontos.map(p => [p.dataCotacao,p.preco,p.variacao,p.fonte]), [
    ['2026-09-15',60.5,0.6,'Revista Planeta Arroz'],
    ['2026-09-16',61,0.5,'Revista Planeta Arroz'],
  ]);
});

test('recusa datas impossíveis ou futuras', () => {
  assert.equal(scraper.dataISO('31/02/2026'), null);
  assert.equal(scraper.dataISO('2099-01-01'), null);
});

test('falha sem criar novo preço quando todas as fontes estão indisponíveis', async () => {
  const antes = JSON.stringify(db.getCotacoes());
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ ok:false, status:503 });
  try {
    await assert.rejects(scraper.scrapeCEPEA(), /Nenhuma cotação datada obtida/);
    assert.equal(JSON.stringify(db.getCotacoes()), antes);
  } finally { global.fetch = fetchOriginal; }
});

test('consulta Cepea sem agente customizado e Notícias Agrícolas com agente', async () => {
  const chamadas = [];
  const fetchOriginal = global.fetch;
  const data = new Date().toLocaleDateString('pt-BR', { timeZone:'America/Sao_Paulo' });
  global.fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    if (url.includes('cepea.org.br')) return { ok:true, text:async () =>
      `<table><tr><th>Data</th><th>Valor R$</th><th>Var./Dia</th></tr>` +
      `<tr><td>${data}</td><td>81,39</td><td>0,00%</td></tr></table>` };
    return { ok:false, status:503 };
  };
  try {
    await scraper.scrapeCEPEA();
    assert.equal(chamadas[0].opcoes.headers, undefined);
    assert.match(chamadas[1].opcoes.headers['User-Agent'], /Mozilla/);
  } finally { global.fetch = fetchOriginal; }
});
