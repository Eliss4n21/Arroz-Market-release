'use strict';
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const helmet      = require('helmet');
const path        = require('path');
const cron        = require('node-cron');
const { scrapeCEPEA } = require('./scraper');

const app  = express();
const PORT = process.env.PORT || 3000;

// Hostinger usa proxy reverso — necessário para rate-limit e IP real
app.set('trust proxy', 1);

/* ── Rate limiting (graceful: não quebra se não instalado) ── */
let rateLimit;
try {
  rateLimit = require('express-rate-limit');
} catch(e) {
  rateLimit = () => (_req, _res, next) => next();
}
const authLimiter = rateLimit({ windowMs:15*60*1000, max:20,
  message:{ erro:'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders:true, legacyHeaders:false,
  validate:{ xForwardedForHeader:false } });
const apiLimiter  = rateLimit({ windowMs:60*1000, max:300,
  message:{ erro:'Limite de requisições excedido.' },
  standardHeaders:true, legacyHeaders:false,
  validate:{ xForwardedForHeader:false } });

/* ── Segurança ── */
app.use(helmet({ contentSecurityPolicy:false, crossOriginEmbedderPolicy:false }));
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
  ].join('; '));
  res.removeHeader('X-Powered-By');
  next();
});

/* ── CORS ── */
const ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin:ORIGIN, methods:['GET','POST','PUT','DELETE','OPTIONS'],
               allowedHeaders:['Content-Type','Authorization','X-Filename'] }));

/* ── Middlewares gerais ── */
app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json({ limit:'50mb' }));
app.use(express.urlencoded({ extended:true }));

/* ── Estáticos ──
   index.html/index e outros HTML NUNCA devem ser cacheados — o site é um SPA
   e qualquer cache intermediário (proxy, CDN, browser) servindo uma versão
   antiga faz recursos novos (ex: roteamento por hash) parecerem "não funcionar"
   mesmo com o deploy correto no servidor. maxAge:'0' sozinho permite cache
   com revalidação; no-store impede completamente. */
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path === '/sw.js') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname,'../public'), {
  maxAge:'1h', etag:true, index:false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
  },
}));

/* ── API com rate limiting ── */
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api', require('../routes/api'));

/* ── Health check — mantém servidor ativo ── */
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ── SPA fallback ── */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ erro:'Rota não encontrada.' });
  res.sendFile(path.join(__dirname,'../public/index.html'));
});

/* ── Migração de URLs legadas ── */
(function migrate() {
  try {
    const db = require('./db');
    let changed = false;
    db.getAllVideos().forEach(v => {
      if (v.url && v.url.startsWith('/audios/') && !v.url.startsWith('/api/')) {
        db.updateVideo(v.id, { url: '/api' + v.url });
        changed = true;
      }
    });
    if (changed) console.log('[Migração] URLs de áudio corrigidas.');
  } catch(e) {}
})();

/* ── Cron de cotações ── */
const minutos = parseInt(process.env.SCRAPE_INTERVAL_MIN || '60', 10);
cron.schedule(`*/${minutos} * * * *`, () => {
  console.log(`[Cron] Atualizando cotações — ${new Date().toLocaleTimeString('pt-BR')}`);
  scrapeCEPEA().catch(e => console.warn('[Cron]', e.message));
});

/* ── Start ── */
app.listen(PORT, () => {
  console.log(`\n🌾  ArrozMarket — http://localhost:${PORT}`);
  console.log(`    Ambiente : ${process.env.NODE_ENV || 'development'}`);
  console.log(`    CORS     : ${ORIGIN}`);
  console.log(`    Scraping : a cada ${minutos} min`);
  console.log(`    Banco    : ${require('./db').DATA_DIR}`);
  console.log(`    Node.js  : ${process.version}`);
  try {
    require('cheerio');
    console.log(`    Cheerio  : ✅ instalado`);
  } catch(e) {
    console.log(`    Cheerio  : ❌ FALHA — ${e.message}`);
  }
  console.log(`    fetch()  : ${typeof globalThis.fetch === 'function' ? '✅ disponível' : '❌ INDISPONÍVEL (Node < 18)'}`);
  if (!process.env.DATA_DIR) {
    console.log('\n⚠️  ⚠️  ⚠️  AVISO CRÍTICO ⚠️  ⚠️  ⚠️');
    console.log('    DATA_DIR não configurado nas variáveis de ambiente!');
    console.log('    O banco de dados está sendo salvo DENTRO do projeto,');
    console.log('    e será PERDIDO no próximo deploy (episódios, usuários,');
    console.log('    comentários, tudo). Configure DATA_DIR e AUDIO_DIR no');
    console.log('    painel da Hostinger AGORA para evitar perda de dados.\n');
  }
  scrapeCEPEA().catch(e => console.warn('[Start]', e.message));
});
