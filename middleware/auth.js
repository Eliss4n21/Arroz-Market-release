'use strict';
const jwt = require('jsonwebtoken');
const db  = require('../src/db');
const S   = () => process.env.JWT_SECRET || 'dev-secret-change-me';

function autenticar(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ','');
  if (!token) return res.status(401).json({ erro:'Token não fornecido.' });
  try {
    const p    = jwt.verify(token, S());
    const user = db.findById(p.id);
    if (!user || !user.ativo) return res.status(401).json({ erro:'Usuário inativo.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ erro:'Token inválido ou expirado.' });
  }
}

function soAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ erro:'Acesso restrito a administradores.' });
  next();
}

module.exports = { autenticar, soAdmin };
