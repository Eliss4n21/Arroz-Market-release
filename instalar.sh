#!/bin/bash
# ════════════════════════════════════════════════
#  ArrozMarket — Script de instalação Hostinger
#  Execute como root: bash instalar.sh
# ════════════════════════════════════════════════
set -e

echo "🌾 Iniciando instalação do ArrozMarket..."

# ── 1. Atualizar sistema ──
apt-get update -y && apt-get upgrade -y

# ── 2. Instalar Node.js 20 ──
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git nginx certbot python3-certbot-nginx ufw

echo "✅ Node.js $(node -v) instalado"

# ── 3. Instalar PM2 ──
npm install -g pm2

# ── 4. Criar pastas ──
mkdir -p /var/www/arrozmarket
mkdir -p /var/data/arrozmarket/audios
chmod 755 /var/data/arrozmarket

# ── 5. Copiar arquivos do projeto ──
cp -r /root/upload/. /var/www/arrozmarket/
cd /var/www/arrozmarket
npm install --omit=dev

# ── 6. Criar .env ──
cat > /var/www/arrozmarket/.env << 'ENV'
PORT=3000
NODE_ENV=production
JWT_SECRET=TROQUE_AGORA_COLE_SUA_STRING_64_CHARS
CORS_ORIGIN=https://arrozmarket.online
DATA_DIR=/var/data/arrozmarket
AUDIO_DIR=/var/data/arrozmarket/audios
SCRAPE_INTERVAL_MIN=60
ENV

echo "⚠️  IMPORTANTE: edite o JWT_SECRET no arquivo /var/www/arrozmarket/.env"

# ── 7. Iniciar com PM2 ──
cd /var/www/arrozmarket
pm2 start src/server.js --name arrozmarket
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo "✅ Servidor iniciado com PM2"

# ── 8. Configurar Nginx ──
cat > /etc/nginx/sites-available/arrozmarket << 'NGINX'
server {
    listen 80;
    server_name arrozmarket.online www.arrozmarket.online;
    client_max_body_size 250M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/arrozmarket /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "✅ Nginx configurado"

# ── 9. Firewall ──
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo ""
echo "════════════════════════════════════════"
echo "✅ Instalação concluída!"
echo ""
echo "PRÓXIMOS PASSOS:"
echo "1. Aponte o domínio arrozmarket.online para o IP deste servidor"
echo "2. Aguarde propagação DNS (5-30 min)"
echo "3. Execute: certbot --nginx -d arrozmarket.online -d www.arrozmarket.online"
echo "4. Edite o JWT_SECRET: nano /var/www/arrozmarket/.env"
echo "5. Reinicie: pm2 restart arrozmarket"
echo "════════════════════════════════════════"
