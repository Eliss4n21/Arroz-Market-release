'use strict';
/**
 * routes/api.js — Todas as rotas REST
 *
 * PÚBLICAS:
 *   GET  /api/cotacoes
 *   GET  /api/audios
 *   POST /api/auth/login
 *   POST /api/auth/registro
 *
 * AUTENTICADAS (Bearer token):
 *   GET  /api/me
 *   PUT  /api/me
 *   POST /api/audios/:id/curtir
 *   GET  /api/audios/:id/curtida
 *
 * ADMIN ONLY:
 *   GET/POST        /api/admin/audios
 *   PUT/DELETE      /api/admin/audios/:id
 *   PUT             /api/admin/cotacoes
 *   GET             /api/admin/usuarios
 *   PUT             /api/admin/usuarios/:id/role
 *   GET/PUT         /api/admin/config
 *   POST            /api/admin/scrape
 */

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../src/db');
const { contemPalavrao } = require('../src/profanityFilter');
const { autenticar, soAdmin } = require('../middleware/auth');
const { scrapeCEPEA }         = require('../src/scraper');

const SEC = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const EXP = () => process.env.JWT_EXPIRES || '7d';

function gerarToken(u) { return jwt.sign({ id:u.id, role:u.role }, SEC(), { expiresIn:EXP() }); }

/* ═══ PÚBLICAS ═══════════════════════════════════════════════════════ */

router.get('/cotacoes', (_, res) => res.json(db.getCotacoes()));

/* /boot — uma chamada retorna tudo que o site precisa no load inicial */
router.get('/boot', (_, res) => {
  res.json({
    audios:      db.getVideos(),
    cotacoes:    db.getCotacoes(),
    especialista:db.getEspecialista(),
    config:      db.getConfig(),
  });
});

router.get('/audios',   (_, res) => res.json(db.getVideos()));

router.post('/auth/registro', async (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro:'Preencha todos os campos.' });
  if (senha.length < 6)          return res.status(400).json({ erro:'Senha deve ter ao menos 6 caracteres.' });
  if (db.findUser(email))        return res.status(409).json({ erro:'E-mail já cadastrado.' });

  const inits = nome.trim().split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
  const novo  = {
    id: Date.now(), nome: nome.trim(), email: email.toLowerCase().trim(),
    senha: await bcrypt.hash(senha, 10), role:'user',
    avatar: inits, criadoEm: new Date().toISOString(), ativo:true
  };
  db.addUser(novo);
  const { senha:_, ...sem } = novo;
  res.status(201).json({ usuario:sem, token:gerarToken(novo) });
});

router.post('/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  const u = db.findUser(email);
  if (!u || !u.ativo) return res.status(401).json({ erro:'Credenciais inválidas.' });
  if (!await bcrypt.compare(senha, u.senha)) return res.status(401).json({ erro:'Credenciais inválidas.' });
  const { senha:_, ...sem } = u;
  res.json({ usuario:sem, token:gerarToken(u) });
});

/* ═══ AUTENTICADAS ═══════════════════════════════════════════════════ */

// Salvar duração real de um episódio (obtida pelo browser após carregar o áudio)
router.put('/me/dur/:id', autenticar, (req, res) => {
  const id  = parseInt(req.params.id);
  const dur = (req.body.dur || '').trim();
  // Validar formato mm:ss ou h:mm:ss
  if (!dur || !/^\d+:\d{2}$/.test(dur)) return res.json({ ok: false });
  const v = db.getAllVideos().find(x => x.id === id);
  if (!v) return res.json({ ok: false });
  // Só atualiza se dur atual é inválido
  const invalido = !v.dur || v.dur === '00:00' || v.dur === 'Infinity:NaN' || v.dur === '--:--';
  if (invalido) db.updateVideo(id, { dur });
  res.json({ ok: true, dur: invalido ? dur : v.dur });
});

router.get('/me', autenticar, (req, res) => {
  const { senha, ...sem } = req.user; res.json(sem);
});

router.put('/me', autenticar, async (req, res) => {
  const { nome, senhaAtual, senhaNova } = req.body;
  const upd = {};
  if (nome) upd.nome = nome.trim();
  if (senhaNova) {
    if (!senhaAtual) return res.status(400).json({ erro:'Informe a senha atual.' });
    if (!await bcrypt.compare(senhaAtual, req.user.senha)) return res.status(400).json({ erro:'Senha atual incorreta.' });
    if (senhaNova.length < 6) return res.status(400).json({ erro:'Nova senha muito curta.' });
    upd.senha = await bcrypt.hash(senhaNova, 10);
  }
  const at = db.updateUser(req.user.id, upd);
  const { senha:_, ...sem } = at;
  res.json(sem);
});

/* ── Vista de episódio (anônima — sem auth) ── */
router.post('/audios/:id/view', (req, res) => {
  const id = parseInt(req.params.id);
  const v  = db.incrementView(id);
  res.json({ ok: true, views: v });
});

router.post('/audios/:id/curtir', autenticar, (req, res) => {
  res.json(db.toggleCurtida(req.user.id, parseInt(req.params.id)));
});

router.get('/audios/:id/curtida', autenticar, (req, res) => {
  res.json({ curtido: db.getCurtida(req.user.id, parseInt(req.params.id)) });
});

/* ═══ COMENTÁRIOS ════════════════════════════════════════════════════ */

// Listar comentários aprovados de um episódio (público)
router.get('/audios/:id/comentarios', (req, res) => {
  res.json(db.getComentarios(parseInt(req.params.id)));
});

// Postar comentário (requer login)
router.post('/audios/:id/comentarios', autenticar, (req, res) => {
  const vid   = parseInt(req.params.id);
  const texto = (req.body.texto || '').trim();
  if (!texto || texto.length < 2)  return res.status(400).json({ erro: 'Comentário muito curto.' });
  if (texto.length > 600)          return res.status(400).json({ erro: 'Máximo 600 caracteres.' });
  if (contemPalavrao(texto))       return res.status(400).json({ erro: 'Comentário contém linguagem imprópria.' });
  const novo = db.addComentario(vid, {
    uid:    req.user.id,
    nome:   req.user.nome,
    avatar: req.user.avatar || req.user.nome.slice(0,2).toUpperCase(),
    texto,
  });
  res.status(201).json(novo);
});

// Admin: listar todos (incluindo não aprovados)
router.get('/admin/audios/:id/comentarios', autenticar, soAdmin, (req, res) => {
  res.json(db.getAllComentarios(parseInt(req.params.id)));
});

// Admin: aprovar comentário
router.put('/admin/comentarios/:vid/:cid/aprovar', autenticar, soAdmin, (req, res) => {
  const r = db.aprovarComentario(parseInt(req.params.vid), parseInt(req.params.cid));
  if (!r) return res.status(404).json({ erro: 'Comentário não encontrado.' });
  res.json(r);
});

// Like em comentário ou resposta
router.post('/audios/:id/comentarios/:cid/like', autenticar, (req, res) => {
  const rid = req.body.rid ? parseInt(req.body.rid) : null;
  const r = db.toggleLikeComentario(
    parseInt(req.params.id), parseInt(req.params.cid), req.user.id, rid
  );
  if (!r) return res.status(404).json({ erro: 'Comentário não encontrado.' });
  res.json(r);
});

// Responder comentário
router.post('/audios/:id/comentarios/:cid/respostas', autenticar, (req, res) => {
  const vid   = parseInt(req.params.id);
  const cid   = parseInt(req.params.cid);
  const texto = (req.body.texto || '').trim();
  if (!texto || texto.length < 2)  return res.status(400).json({ erro: 'Resposta muito curta.' });
  if (texto.length > 600)          return res.status(400).json({ erro: 'Máximo 600 caracteres.' });
  if (contemPalavrao(texto))       return res.status(400).json({ erro: 'Resposta contém linguagem imprópria.' });
  const nova = db.addResposta(vid, cid, {
    uid:    req.user.id,
    nome:   req.user.nome,
    avatar: req.user.avatar || req.user.nome.slice(0,2).toUpperCase(),
    texto,
  });
  if (!nova) return res.status(404).json({ erro: 'Comentário não encontrado.' });
  res.status(201).json(nova);
});

// Admin: deletar comentário ou resposta
router.delete('/admin/comentarios/:vid/:cid', autenticar, soAdmin, (req, res) => {
  const rid = req.query.rid ? parseInt(req.query.rid) : null;
  db.deletarComentario(parseInt(req.params.vid), parseInt(req.params.cid), rid);
  res.json({ ok: true });
});

router.get('/admin/audios',    autenticar, soAdmin, (_, res) => res.json(db.getAllVideos()));

router.post('/admin/audios',   autenticar, soAdmin, (req, res) => {
  const { titulo, titulo_en, titulo_fr, titulo_es, data, dur, url, url_en, cat, status, desc, views, likes } = req.body;
  if (!titulo || !data) return res.status(400).json({ erro:'Título e data obrigatórios.' });
  const baseViews = Number.isFinite(+views) && +views >= 0 ? Math.round(+views) : 0;
  const baseLikes = Number.isFinite(+likes) && +likes >= 0 ? Math.round(+likes) : 0;
  res.status(201).json(db.addVideo({
    id: db.nextId(), titulo, titulo_en: titulo_en||'', titulo_fr: titulo_fr||'', titulo_es: titulo_es||'', data,
    dur: (dur && dur !== 'Infinity:NaN' && dur !== 'NaN:NaN' && dur !== '00:00') ? dur : '00:00',
    url: url||'', url_en: url_en||'', cat: cat||'Podcast Diário',
    status: status||'pub', desc: desc||'',
    views: baseViews, likes: baseLikes,
  }));
});

router.put('/admin/audios/:id', autenticar, soAdmin, (req, res) => {
  // Remove views e likes do body para que edições de metadados não resetem contadores
  const { views: _v, likes: _l, ...safeBody } = req.body;
  const v = db.updateVideo(parseInt(req.params.id), safeBody);
  if (!v) return res.status(404).json({ erro:'Áudio não encontrado.' });
  res.json(v);
});

router.delete('/admin/audios/:id', autenticar, soAdmin, (req, res) => {
  db.deleteVideo(parseInt(req.params.id)); res.json({ ok:true });
});

router.put('/admin/cotacoes', autenticar, soAdmin, (req, res) => {
  const { cotacoes } = req.body;
  if (!Array.isArray(cotacoes)) return res.status(400).json({ erro:'Formato inválido.' });
  db.updateCotacoes(cotacoes); res.json(db.getCotacoes());
});

router.get('/admin/usuarios', autenticar, soAdmin, (_, res) => {
  res.json(db.getUsers().map(({ senha, ...u }) => u));
});

// Conceder/revogar cargo de admin
router.put('/admin/usuarios/:id/role', autenticar, soAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin','user'].includes(role)) return res.status(400).json({ erro:'Cargo inválido.' });
  const at = db.setRole(parseInt(req.params.id), role);
  if (!at) return res.status(404).json({ erro:'Usuário não encontrado.' });
  const { senha, ...sem } = at;
  res.json(sem);
});

/* ── ESPECIALISTA ── */
router.get('/thumbs', (_, res) => res.json(db.getThumbs()));
router.put('/admin/thumbs', autenticar, soAdmin, (req, res) => res.json(db.updateThumbs(req.body)));

router.get('/especialista', (_, res) => res.json(db.getEspecialista()));
router.put('/admin/especialista', autenticar, soAdmin, (req, res) => {
  res.json(db.updateEspecialista(req.body));
});

router.get('/admin/config', autenticar, soAdmin, (_, res) => res.json(db.getConfig()));

router.put('/admin/config', autenticar, soAdmin, (req, res) => {
  res.json(db.updateConfig(req.body));
});

// Força scraping imediato
router.post('/admin/scrape', autenticar, soAdmin, async (_, res) => {
  try { res.json({ ok:true, cotacoes: await scrapeCEPEA(), ts: Date.now() }); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

/* ══════════════════════════════════════════════════════════════
   UPLOAD DE ÁUDIO GRAVADO
   POST /api/admin/audios/upload
   Content-Type: application/octet-stream
   Headers: X-Filename: meu-podcast.webm
   Body: raw binary (webm / ogg / mp3 / wav)

   Salva o arquivo em data/audios/<id>.<ext> e retorna a URL pública.
══════════════════════════════════════════════════════════════ */
const fs   = require('fs');
const path = require('path');

// Reutiliza o mesmo AUDIO_DIR definido no db.js — único ponto de verdade
const AUDIO_DIR = require('../src/db').AUDIO_DIR;

router.post('/admin/audios/upload', autenticar, soAdmin, (req, res) => {
  const rawName = (req.headers['x-filename'] || 'audio.webm').replace(/[^a-z0-9._-]/gi, '_');
  const ext     = path.extname(rawName) || '.webm';
  const id      = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const fname   = `${id}${ext}`;
  const fpath   = path.join(AUDIO_DIR, fname);

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) return res.status(400).json({ erro: 'Arquivo vazio.' });
      if (buf.length > 200 * 1024 * 1024) return res.status(413).json({ erro: 'Arquivo maior que 200 MB.' });
      fs.writeFileSync(fpath, buf);
      // URL pública — acessível via /api/audios/:fname
      const url = `/api/audios/${fname}`;
      res.json({ ok: true, url, size: buf.length, fname });
    } catch (e) {
      res.status(500).json({ erro: e.message });
    }
  });
  req.on('error', e => res.status(500).json({ erro: e.message }));
});

/* Serve os arquivos de áudio estaticamente
   Guard: só responde se fname tiver extensão de áudio (.wav/.mp3/etc)
   Isso impede captura de subrotas como /audios/1/comentarios */
router.get('/audios/:fname', (req, res) => {
  const raw = req.params.fname;
  // Se não contém ponto = não é arquivo = passa para próxima rota
  if (!raw.includes('.')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  const fname = raw.replace(/[^a-z0-9._-]/gi, '_');
  const fpath = path.join(AUDIO_DIR, fname);
  if (!fs.existsSync(fpath)) return res.status(404).json({ erro: 'Áudio não encontrado.' });
  const ext  = path.extname(fname).toLowerCase();
  const mime = { '.webm':'audio/webm', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.m4a':'audio/mp4', '.aac':'audio/aac' };
  const contentType = mime[ext] || 'application/octet-stream';
  const stat = fs.statSync(fpath);
  const total = stat.size;

  // Suporte a Range requests — essencial para iOS/Safari e seek em áudio
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end   = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${total}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   contentType,
      'Cache-Control':  'public, max-age=31536000',
    });
    fs.createReadStream(fpath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type':   contentType,
      'Accept-Ranges':  'bytes',
      'Cache-Control':  'public, max-age=31536000',
    });
    fs.createReadStream(fpath).pipe(res);
  }
});

module.exports = router;
