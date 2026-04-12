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

/* ─── Segurança ─────────────────────────────────────────────────────────
   IMPORTANTE: o helmet bloqueava os handlers onclick="" inline do HTML
   (Content-Security-Policy: script-src-attr 'none').
   Solução: desativamos apenas o CSP; os demais headers de segurança
   do helmet permanecem ativos (XSS, HSTS, noSniff, etc.).
   ──────────────────────────────────────────────────────────────────── */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ─── Frontend estático ──────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, '../public')));

/* ─── API ────────────────────────────────────────────────────────────── */
app.use('/api', require('../routes/api'));

/* ─── SPA fallback ───────────────────────────────────────────────────── */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ erro: 'Rota não encontrada.' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

/* ─── Cron: scraping automático ──────────────────────────────────────── */
const minutos = parseInt(process.env.SCRAPE_INTERVAL_MIN || '30');
cron.schedule(`*/${minutos} * * * *`, () => {
  console.log(`[Cron] Atualizando cotações — ${new Date().toLocaleTimeString('pt-BR')}`);
  scrapeCEPEA().catch(() => {});
});

/* ─── Inicia o servidor ──────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n🌾  ArrozMarket — http://localhost:${PORT}`);
  console.log(`    API: http://localhost:${PORT}/api`);
  console.log(`    Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
  scrapeCEPEA().catch(() => {});
});
