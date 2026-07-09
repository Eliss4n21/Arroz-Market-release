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
  videos: [
    { id:1,  titulo:'Safra 2025 e Impactos nos Preços',                    data:'07/04/2025', dur:'12:48', url:'', cat:'Podcast Diário',      status:'pub', views:3400, likes:1247, desc:'Análise do cenário da safra 2025 e seus reflexos nas cotações do arroz gaúcho.' },
    { id:2,  titulo:'Impacto do clima na safra do RS',                     data:'03/04/2025', dur:'09:32', url:'', cat:'Podcast Diário',      status:'pub', views:2100, likes:87,   desc:'Como as condições climáticas afetam a produtividade e os preços no Rio Grande do Sul.' },
    { id:3,  titulo:'Parboilizado em alta: por que sobe?',                 data:'02/04/2025', dur:'14:05', url:'', cat:'Cotações',            status:'pub', views:3800, likes:214,  desc:'Entenda os fatores por trás da valorização do arroz parboilizado nos últimos meses.' },
    { id:4,  titulo:'Você sabia? O arroz alimenta metade da humanidade',   data:'01/04/2025', dur:'03:22', url:'', cat:'Curiosidades do Dia', status:'pub', views:5100, likes:376,  desc:'Fatos surpreendentes sobre o cereal mais consumido do mundo.' },
    { id:5,  titulo:'Fechamento de março e balanço trimestral',            data:'31/03/2025', dur:'18:44', url:'', cat:'Especial',            status:'pub', views:5600, likes:312,  desc:'Resumo completo do primeiro trimestre de 2025 para o mercado orizícola.' },
    { id:6,  titulo:'Arroz integral: demanda aquecida',                    data:'28/03/2025', dur:'08:55', url:'', cat:'Podcast Diário',      status:'pub', views:2900, likes:105,  desc:'A busca por alimentos mais saudáveis está aquecendo o mercado do arroz integral.' },
    { id:7,  titulo:'Dólar e exportações — reflexo no preço',              data:'27/03/2025', dur:'13:22', url:'', cat:'Técnico',             status:'pub', views:3300, likes:143,  desc:'Como a variação cambial impacta diretamente as cotações do mercado interno.' },
    { id:8,  titulo:'Colheita RS 2025: ritmo e projeções',                 data:'25/03/2025', dur:'12:38', url:'', cat:'Podcast Diário',      status:'pub', views:6100, likes:389,  desc:'Acompanhamento do ritmo da colheita e projeções para o volume final da safra gaúcha.' },
    { id:9,  titulo:'Do campo ao prato: a jornada do grão',                data:'24/03/2025', dur:'04:15', url:'', cat:'Curiosidades do Dia', status:'pub', views:4100, likes:221,  desc:'Uma viagem fascinante pelo processo que transforma o arroz em casca no produto final.' },
    { id:10, titulo:'Entrevista: produtor de Cachoeira do Sul conta tudo', data:'21/03/2025', dur:'22:14', url:'', cat:'Entrevista',          status:'pub', views:3700, likes:187,  desc:'Bate-papo com um produtor orizícola sobre desafios e perspectivas da safra 2025.' },
  ],
  cotacoes: [
    { id:'cas',   nome:'Em Casca (ESALQ/Senar-RS)',   preco: 65.00, variacao: 0.00, cls:'estavel', unidade:'sc 50kg', fonte:'Notícias Agrícolas' },
    { id:'mf_rs', nome:'Mercado Físico – Média RS',   preco: 62.00, variacao: 0.00, cls:'estavel', unidade:'sc 50kg', fonte:'Notícias Agrícolas' },
    { id:'agl',   nome:'Agulhinha Irrigado (RS)',      preco: 48.00, variacao: 0.00, cls:'estavel', unidade:'sc 50kg', fonte:'Notícias Agrícolas' },
    { id:'lf',    nome:'Longo Fino (MT)',              preco: 60.00, variacao: 0.00, cls:'estavel', unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
    { id:'ben',   nome:'Beneficiado Tipo 1 (SP)',      preco:118.00, variacao:-6.35, cls:'baixa',   unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
    { id:'parb',  nome:'Parboilizado T1',              preco:155.20, variacao:+2.40, cls:'alta',    unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
    { id:'int',   nome:'Integral T1',                  preco:175.80, variacao:+3.10, cls:'alta',    unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
    { id:'cat',   nome:'Cateto T1',                    preco: 95.00, variacao:-0.50, cls:'baixa',   unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
    { id:'qui',   nome:'Quirera',                      preco: 38.50, variacao:-0.30, cls:'baixa',   unidade:'sc 60kg', fonte:'Notícias Agrícolas' },
  ],
  curtidas: {},
  comentarios: {},  /* { videoId: [ {id, uid, nome, avatar, texto, ts, aprovado} ] } */
  config: { siteTitulo:'ArrozMarket', corDestaque:'#C8A84B', tickerAtivo:true, proximoId:10 },
  especialista: {
    nome:'Fábio Toledo', cargo:'Especialista em Mercado Orizícola', local:'São Gabriel — RS',
    frase:'O arroz gaúcho é o termômetro do agronegócio brasileiro.',
    p1:'Com mais de 22 anos de experiência no mercado orizícola, Fábio Toledo acompanha de perto cada movimento das cotações, safras e tendências do setor.',
    p2:'Seu trabalho une análise técnica rigorosa com linguagem acessível, tornando o mercado compreensível para produtores, corretores e consumidores.',
    anos:'22+', analises:'1.200+', abrangencia:'Nacional', redes:[], timeline:[]
  }
};

function lerDB()    { try { if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch(e){} return JSON.parse(JSON.stringify(DEFAULT)); }
function salvarDB(d){ try { fs.writeFileSync(DB_PATH, JSON.stringify(d,null,2)); } catch(e){} }

let _db = lerDB();
if (!_db.usuarios?.length) { _db = JSON.parse(JSON.stringify(DEFAULT)); salvarDB(_db); }

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
    const novo = { id: Date.now(), ...dados, aprovado: false, ts: Date.now(),
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
