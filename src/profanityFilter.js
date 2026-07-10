'use strict';
/* ═══════════════════════════════════════════════════════════
   Filtro de baixo calão — módulo único usado por comentários
   e respostas, para não haver duplicação de lista/lógica.
═══════════════════════════════════════════════════════════ */

// Lista base de termos vetada (normalizados: minúsculo, sem acento)
const PALAVRAS_PROIBIDAS = [
  'porra','caralho','merda','buceta','piroca','pinto','pau no cu','punheta',
  'foder','fodase','fode','foda-se','vsf','vtnc','vai se foder','cacete',
  'arrombado','arrombada','desgracado','desgracada','filho da puta','fdp',
  'puta','putinha','puto','viado','viadinho','bicha','baitola','sapatao',
  'corno','corna','cuzao','cuzinho','cu ','otario','otaria','imbecil','retardado','retardada',
  'idiota','babaca','escroto','escrota','vagabundo','vagabunda','vadia','safada','safado',
  'negro fodido','macaco','crioulo','nazista','hitler','genocida',
  'estuprador','estupro','pedofilo','pedofila',
];

// Normaliza: minúsculo + remove acentos + colapsa espaços repetidos
function normalizar(txt) {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')                       // pontuação vira espaço (evita p*rra escapando)
    .replace(/\s+/g, ' ')
    .trim();
}

/* Retorna true se o texto contém baixo calão */
function contemPalavrao(texto) {
  const norm = ' ' + normalizar(texto) + ' ';
  for (let i = 0; i < PALAVRAS_PROIBIDAS.length; i++) {
    if (norm.includes(' ' + PALAVRAS_PROIBIDAS[i] + ' ') ||
        norm.includes(PALAVRAS_PROIBIDAS[i])) {
      return true;
    }
  }
  return false;
}

module.exports = { contemPalavrao };
