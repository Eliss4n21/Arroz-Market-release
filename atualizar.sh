#!/bin/bash
# ════════════════════════════════════════
#  ArrozMarket — Atualizar site
#  Execute no servidor: bash atualizar.sh
# ════════════════════════════════════════
set -e
cd /var/www/arrozmarket
echo "Puxando atualizações..."
git pull
echo "Instalando dependências..."
npm install --omit=dev
echo "Reiniciando servidor..."
pm2 restart arrozmarket
echo "✅ Site atualizado!"
pm2 status arrozmarket
