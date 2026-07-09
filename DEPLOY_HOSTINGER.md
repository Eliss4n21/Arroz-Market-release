# ⚠️ CONFIGURAÇÃO OBRIGATÓRIA NA HOSTINGER

## Variáveis de Ambiente (impedem perda de dados)

No painel da Hostinger → seu site Node.js → **"Configurações"** ou **"Variables"**:

| Variável | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | *(sua string de 64 chars)* |
| `DATA_DIR` | `/home/SEUUSUARIO/arrozmarket_data` |
| `AUDIO_DIR` | `/home/SEUUSUARIO/arrozmarket_data/audios` |
| `CORS_ORIGIN` | `https://arrozmarket.online` |
| `SCRAPE_INTERVAL_MIN` | `60` |

## Criar pasta de dados (via SSH ou terminal da Hostinger):
```bash
mkdir -p /home/SEUUSUARIO/arrozmarket_data/audios
```

## Por que isso é necessário?
Sem DATA_DIR configurado, os áudios e banco ficam dentro
da pasta do projeto (/data/) que é apagada a cada deploy.
Com DATA_DIR apontando para fora do projeto, os dados
nunca são apagados mesmo com deploys.
