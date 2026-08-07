'use strict';
const fs   = require('fs');
const path = require('path');

/*
 * Dados persistem em data/ (local e Railway com Volume).
 * No Railway free/hobby os dados resetam no deploy — ok para dev.
 * No VPS: configure DATA_DIR no .env para pasta fora de public_html.
 */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH  = path.join(DATA_DIR, 'db.json');
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(DATA_DIR, 'audios');

[DATA_DIR, AUDIO_DIR].forEach(d => {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch(e) {}
});

const ADMIN_HASH = '$2a$10$.bi4pu462UPZHk.Xwzbwhe3/m/ZBca6573NVA2e8bw6hsrDhARjZO';

const DEFAULT = {
  usuarios: [
    { id:1, nome:'Fábio Toledo', email:'fabio.toledo@arrozmarket.online',
      senha:ADMIN_HASH, role:'admin', avatar:'FT', criadoEm:'2025-01-01T00:00:00Z', ativo:true },
  ],
  videos: [],
  cotacoes: [
    { id:'cas',   nome:'Em Casca (ESALQ/Senar-RS)',   preco: 65.00, variacao: 0.00, cls:'estavel', unidade:'sc 50kg', fonte:'Notícias Agrícolas' },
    { id:'mf_rs', nome:'Mercado Físico – Média RS',   preco: 62.00, variacao: 0.00, cls:'estavel', unidade:'sc 50kg', fonte:'Notícias Agrícolas' },
    { id:'agl',   nome:'Agulhinha Irrigado (RS)',      preco: 48.00, variacao: 0.00, cls:'estavel', unidade:'sc 50kg', fonte:'Notícias Agrícolas' },
    { id:'lf',    nome:'Longo Fino (MT)',              preco: 60.00, variacao: 0.00, cls:'estavel', unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
    { id:'ben',   nome:'Beneficiado Tipo 1 (SP)',      preco:118.00, variacao:-6.35, cls:'baixa',   unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
  ],
  curtidas: {},
  comentarios: {},  /* { videoId: [ {id, uid, nome, avatar, texto, ts, aprovado} ] } */
  config: { siteTitulo:'ArrozMarket', corDestaque:'#C8A84B', tickerAtivo:true, proximoId:10, sheetsUrl:'' },
  especialista: {
    nome:'Fábio Toledo', cargo:'Especialista em Mercado Orizícola', local:'São Gabriel — RS',
    frase:'O arroz gaúcho é o termômetro do agronegócio brasileiro.',
    p1:'Com mais de 22 anos de experiência no mercado orizícola, Fábio Toledo acompanha de perto cada movimento das cotações, safras e tendências do setor.',
    p2:'Seu trabalho une análise técnica rigorosa com linguagem acessível, tornando o mercado compreensível para produtores, corretores e consumidores.',
    anos:'22+', analises:'1.200+', abrangencia:'Nacional', redes:[], timeline:[]
  }
};

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
try { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch(e) {
  console.error('❌ [DB] Não foi possível criar pasta de backups em', BACKUP_DIR, '—', e.message);
}

/* Teste de permissão no boot — detecta problema de escrita ANTES de
   qualquer dado real ser perdido, em vez de descobrir só depois. */
(function testarPermissaoEscrita() {
  const testPath = path.join(DATA_DIR, '.write_test');
  try {
    fs.writeFileSync(testPath, 'ok');
    fs.readFileSync(testPath, 'utf8');
    fs.unlinkSync(testPath);
    console.log(`✅ [DB] Permissão de escrita OK em ${DATA_DIR}`);
  } catch(e) {
    console.error('\n❌❌❌ [DB] SEM PERMISSÃO DE ESCRITA EM DATA_DIR ❌❌❌');
    console.error(`    Pasta: ${DATA_DIR}`);
    console.error(`    Erro : ${e.message}`);
    console.error('    Dados NÃO estão sendo salvos — tudo se perde ao reiniciar.');
    console.error('    Verifique via SSH: ls -la ' + DATA_DIR + '  (dono/permissão da pasta)\n');
  }
})();

/* Lê o backup mais recente disponível — usado como rede de segurança
   quando o db.json principal está corrompido/ilegível. */
function lerBackupMaisRecente() {
  try {
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db_')).sort();
    if (!backups.length) return null;
    const maisRecente = backups[backups.length - 1];
    const conteudo = fs.readFileSync(path.join(BACKUP_DIR, maisRecente), 'utf8');
    console.warn(`⚠️  [DB] Recuperando dados do backup mais recente: ${maisRecente}`);
    return JSON.parse(conteudo);
  } catch(e) {
    console.error('❌ [DB] Falha ao ler backups também:', e.message);
    return null;
  }
}

function lerDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH,'utf8'));
    console.warn(`⚠️  [DB] ${DB_PATH} não existe ainda — iniciando banco novo (normal na primeira vez).`);
  } catch(e) {
    // db.json existe mas está corrompido (ex: gravação interrompida no meio).
    // Antes de desistir e começar do zero, tenta recuperar do backup mais
    // recente — evita perda total de dados por um problema recuperável.
    console.error(`❌❌❌ [DB] ${DB_PATH} está CORROMPIDO: ${e.message}`);
    const backup = lerBackupMaisRecente();
    if (backup) return backup;
    console.error('❌ [DB] Nenhum backup disponível — iniciando banco vazio. DADOS ANTERIORES PODEM TER SIDO PERDIDOS.');
  }
  return JSON.parse(JSON.stringify(DEFAULT));
}

/* Salva o banco de forma ATÔMICA (grava em arquivo temporário e troca
   o nome só depois de terminar) — evita que uma interrupção no meio da
   gravação (queda do processo, reinício forçado, etc.) deixe o db.json
   corrompido pela metade. Mantém backup rotativo por TEMPO (a cada 5
   minutos, não por contagem de saves — contagem zera a cada restart e
   pode levar dias para gerar um backup em sites de baixo tráfego). */
let _ultimoBackup = 0;
function salvarDB(d) {
  const tmpPath = DB_PATH + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(d, null, 2));
    fs.renameSync(tmpPath, DB_PATH); // rename é atômico no mesmo filesystem

    const agora = Date.now();
    if (agora - _ultimoBackup > 5 * 60 * 1000) { // no máximo 1 backup a cada 5 min
      _ultimoBackup = agora;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const bpath = path.join(BACKUP_DIR, `db_${ts}.json`);
      fs.writeFileSync(bpath, JSON.stringify(d, null, 2));
      // Mantém só os 10 backups mais recentes
      const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db_')).sort();
      while (backups.length > 10) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
    }
  } catch(e) {
    console.error(`❌ [DB] FALHA AO SALVAR em ${DB_PATH}:`, e.message);
  }
}

let _db = lerDB();
if (!_db.usuarios?.length) {
  // Backup de emergência do que existia antes de resetar — mesmo que
  // pareça vazio/corrompido, pode ter dados parciais recuperáveis.
  try {
    if (_db && (_db.videos?.length || _db.comentarios)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(BACKUP_DIR, `EMERGENCIA_pre-reset_${ts}.json`), JSON.stringify(_db, null, 2));
    }
  } catch(e) {}
  _db = JSON.parse(JSON.stringify(DEFAULT));
  salvarDB(_db);
}
// Migração: adiciona campos novos sem apagar dados existentes
if (!_db.especialista) { _db.especialista = DEFAULT.especialista; salvarDB(_db); }
if (!_db.comentarios)  { _db.comentarios  = {}; salvarDB(_db); }
if (!_db.thumbs)       { _db.thumbs       = {}; salvarDB(_db); }
if (_db.config && _db.config.sheetsUrl === undefined) { _db.config.sheetsUrl = ''; salvarDB(_db); }
// Remove cotações sem fonte real que nunca foram cobertas pelo scraper
// (rotuladas incorretamente como "Notícias Agrícolas" mas sempre simuladas)
if (Array.isArray(_db.cotacoes)) {
  const idsRemover = new Set(['parb', 'int', 'cat', 'qui']);
  const antes = _db.cotacoes.length;
  _db.cotacoes = _db.cotacoes.filter(c => !idsRemover.has(c.id));
  if (_db.cotacoes.length !== antes) { salvarDB(_db); console.log(`[DB] Removidas ${antes - _db.cotacoes.length} cotações sem fonte real.`); }
}

const db = {
  get()  { return _db; },
  save() { salvarDB(_db); },
  getVideos()       { return _db.videos.filter(v=>v.status==='pub'); },
  getAllVideos()     { return _db.videos; },
  addVideo(v)       { _db.videos.unshift(v); salvarDB(_db); return v; },
  updateVideo(id,d) { const i=_db.videos.findIndex(v=>v.id===id); if(i<0)return null; _db.videos[i]={..._db.videos[i],...d}; salvarDB(_db); return _db.videos[i]; },
  deleteVideo(id)   { _db.videos=_db.videos.filter(v=>v.id!==id); salvarDB(_db); },
  incrementView(id) { const i=_db.videos.findIndex(v=>v.id===id); if(i<0)return 0; _db.videos[i].views=(_db.videos[i].views||0)+1; salvarDB(_db); return _db.videos[i].views; },
  getCotacoes()     { return _db.cotacoes; },
  updateCotacoes(l) { _db.cotacoes=l; _db.cotacoes.forEach(c=>{c.ts=Date.now();}); salvarDB(_db); },
  getUsers()        { return _db.usuarios; },
  findUser(email)   { return _db.usuarios.find(u=>u.email===email?.toLowerCase().trim()); },
  findById(id)      { return _db.usuarios.find(u=>u.id===id); },
  addUser(u)        { _db.usuarios.push(u); salvarDB(_db); return u; },
  updateUser(id,d)  { const i=_db.usuarios.findIndex(u=>u.id===id); if(i<0)return null; _db.usuarios[i]={..._db.usuarios[i],...d}; salvarDB(_db); return _db.usuarios[i]; },
  setRole(id,role)  { return db.updateUser(id,{role}); },
  toggleCurtida(uid,vid) {
    const k=`${uid}_${vid}`, curtido=!_db.curtidas[k];
    _db.curtidas[k]=curtido;
    const i=_db.videos.findIndex(v=>v.id===vid);
    if(i>=0) _db.videos[i].likes=Math.max(0,(_db.videos[i].likes||0)+(curtido?1:-1));
    salvarDB(_db);
    return { curtido, likes: i>=0?_db.videos[i].likes:0 };
  },
  getCurtida(uid,vid) { return !!_db.curtidas[`${uid}_${vid}`]; },

  /* ─── COMENTÁRIOS ─── */
  getComentarios(vid) {
    if (!_db.comentarios) _db.comentarios = {};
    return (_db.comentarios[vid] || []).filter(c => c.aprovado);
  },
  getAllComentarios(vid) {
    if (!_db.comentarios) _db.comentarios = {};
    return _db.comentarios[vid] || [];
  },
  addComentario(vid, dados) {
    if (!_db.comentarios) _db.comentarios = {};
    if (!_db.comentarios[vid]) _db.comentarios[vid] = [];
    // Auto-aprova comentários de usuários autenticados
    const novo = { id: Date.now(), ...dados, aprovado: true, ts: Date.now(),
                   likes: 0, likedBy: [], respostas: [] };
    _db.comentarios[vid].unshift(novo);
    salvarDB(_db);
    return novo;
  },
  addResposta(vid, cid, dados) {
    if (!_db.comentarios?.[vid]) return null;
    const i = _db.comentarios[vid].findIndex(c => c.id === cid);
    if (i < 0) return null;
    if (!_db.comentarios[vid][i].respostas) _db.comentarios[vid][i].respostas = [];
    const nova = { id: Date.now(), ...dados, ts: Date.now(), likes: 0, likedBy: [] };
    _db.comentarios[vid][i].respostas.push(nova);
    salvarDB(_db);
    return nova;
  },
  toggleLikeComentario(vid, cid, uid, rid) {
    if (!_db.comentarios?.[vid]) return null;
    const i = _db.comentarios[vid].findIndex(c => c.id === cid);
    if (i < 0) return null;
    // Se rid fornecido → like na resposta; senão → like no comentário
    let alvo = rid
      ? (_db.comentarios[vid][i].respostas || []).find(r => r.id === rid)
      : _db.comentarios[vid][i];
    if (!alvo) return null;
    if (!alvo.likedBy) alvo.likedBy = [];
    const idx = alvo.likedBy.indexOf(uid);
    if (idx >= 0) { alvo.likedBy.splice(idx, 1); alvo.likes = Math.max(0, alvo.likes - 1); }
    else          { alvo.likedBy.push(uid);        alvo.likes = (alvo.likes || 0) + 1; }
    salvarDB(_db);
    return { likes: alvo.likes, curtido: idx < 0 };
  },
  aprovarComentario(vid, cid) {
    if (!_db.comentarios?.[vid]) return null;
    const i = _db.comentarios[vid].findIndex(c => c.id === cid);
    if (i < 0) return null;
    _db.comentarios[vid][i].aprovado = true;
    salvarDB(_db);
    return _db.comentarios[vid][i];
  },
  deletarComentario(vid, cid, rid) {
    if (!_db.comentarios?.[vid]) return;
    if (rid) {
      const i = _db.comentarios[vid].findIndex(c => c.id === cid);
      if (i >= 0) _db.comentarios[vid][i].respostas =
        (_db.comentarios[vid][i].respostas||[]).filter(r => r.id !== rid);
    } else {
      _db.comentarios[vid] = _db.comentarios[vid].filter(c => c.id !== cid);
    }
    salvarDB(_db);
  },
  getThumbs()           { return _db.thumbs || {}; },
  updateThumbs(d)       { _db.thumbs={..._db.thumbs||{},...d}; salvarDB(_db); return _db.thumbs; },
  getEspecialista()     { if(!_db.especialista) _db.especialista={}; return _db.especialista; },
  updateEspecialista(d) {
    if(!_db.especialista) _db.especialista={};
    _db.especialista={..._db.especialista,...d};
    salvarDB(_db); return _db.especialista;
  },
  getConfig()         { return _db.config; },
  updateConfig(d)     { _db.config={..._db.config,...d}; salvarDB(_db); return _db.config; },
  nextId()            { return ++_db.config.proximoId; },
};

module.exports = db;
module.exports.AUDIO_DIR = AUDIO_DIR;
module.exports.DATA_DIR  = DATA_DIR;
