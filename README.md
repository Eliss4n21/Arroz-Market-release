# 🌾 ArrozMarket v1.1

Plataforma de podcasts e cotações do mercado orizícola brasileiro.  
**Autor:** Fábio Toledo — São Gabriel, RS

---

## 🚀 Deploy no Hostgator VPS

### Pré-requisitos no servidor
- Plano **VPS ou Cloud Hosting** (não funciona no compartilhado)
- Acesso SSH
- Node.js ≥ 18 instalado
- PM2 para manter o processo ativo

### Passo a passo

**1. Instalar Node.js e PM2 (primeira vez)**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

**2. Fazer upload dos arquivos**
- Via FTP/SFTP: envie a pasta do projeto para `/home/SEU_USUARIO/arrozmarket`
- Ou via Git: `git clone SEU_REPO /home/SEU_USUARIO/arrozmarket`

**3. Instalar dependências**
```bash
cd /home/SEU_USUARIO/arrozmarket
npm install
```

**4. Configurar variáveis de ambiente**
```bash
cp .env.example .env
nano .env
# Edite JWT_SECRET, PORT, DATA_DIR e CORS_ORIGIN
```

**5. Criar pasta de dados persistente**
```bash
mkdir -p /home/SEU_USUARIO/arrozmarket_data/audios
```

**6. Iniciar com PM2**
```bash
pm2 start src/server.js --name arrozmarket
pm2 save          # persiste entre reinicializações
pm2 startup       # configura autostart no boot
```

**7. Configurar Nginx como proxy reverso** (Hostgator VPS usa cPanel/WHM com Nginx)
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

**8. SSL (HTTPS)**
No cPanel do Hostgator: **SSL/TLS → AutoSSL** ou use Let's Encrypt gratuito.

---

## 📁 Estrutura de pastas

```
arrozmarket/
├── public/          ← arquivos servidos ao browser
│   ├── index.html
│   ├── admin.html
│   ├── robots.txt
│   └── sitemap.xml
├── routes/
│   └── api.js       ← todas as rotas REST
├── src/
│   ├── server.js    ← entrada principal
│   ├── db.js        ← banco JSON
│   └── scraper.js   ← cotações reais (cheerio + fetch)
├── data/            ← criada automaticamente
│   ├── db.json      ← banco de dados
│   └── audios/      ← arquivos de áudio enviados
├── .env             ← variáveis de ambiente (NÃO versionar)
└── package.json
```

---

## ⚙️ Variáveis de ambiente

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `PORT` | Porta do servidor | `3000` |
| `JWT_SECRET` | Chave secreta JWT (64+ chars) | `abc123...` |
| `JWT_EXPIRES` | Expiração do token | `7d` |
| `NODE_ENV` | Ambiente | `production` |
| `DATA_DIR` | Pasta persistente de dados | `/home/user/arrozmarket_data` |
| `CORS_ORIGIN` | Domínio autorizado | `https://www.arrozmarket.com.br` |
| `SCRAPE_INTERVAL_MIN` | Intervalo de scraping (min) | `60` |

---

## 📈 Cotações e histórico

O arroz em casca usa o indicador diário do **Cepea/Esalq**. O projeto inclui 250
observações oficiais com suas datas originais, de 16/09/2025 a 16/09/2026, e
acrescenta as novas cotações quando a fonte responde. As outras classificações
usam os fechamentos datados exibidos no Notícias Agrícolas, com a fonte original
de cada tabela identificada. A planilha Google Sheets pode suprir uma classificação
indisponível, desde que a coluna F informe a data da cotação em `AAAA-MM-DD`.

Quando uma fonte falha, o último preço conserva sua data original. O sistema não
gera preços simulados, não atribui a data de hoje a um preço antigo e não preenche
lacunas do gráfico com valores inventados. A página mostra a data de cada fonte.
No gráfico, o Em Casca mostra até quatro fechamentos reais por mês; o histórico
diário completo permanece armazenado. Cada linha termina na última data que sua
fonte publicou.
Algumas classificações podem ter fechamentos antigos ou ficar indisponíveis até
que haja uma cotação verificável.

O histórico Cepea indica licença **CC BY-NC 4.0** na página do indicador.
Antes de publicar esses dados em uma operação comercial, confirme a autorização
de uso com o Cepea.

Para alterar o intervalo: edite `SCRAPE_INTERVAL_MIN` no `.env` e reinicie:
```bash
pm2 restart arrozmarket
```

---

## 🔐 Segurança

- Troque a senha do admin em: **Admin → Configurações → Alterar Senha**
- O login padrão é: `admin@arrozmarket.com.br` / `admin123`
- **OBRIGATÓRIO:** troque a senha antes de colocar no ar

---

## 🔄 Atualizações

```bash
cd /home/SEU_USUARIO/arrozmarket
git pull              # ou re-envie os arquivos via FTP
npm install           # se package.json mudou
pm2 restart arrozmarket
```
