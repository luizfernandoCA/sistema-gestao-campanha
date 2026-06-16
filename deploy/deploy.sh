#!/usr/bin/env bash
# Executado NO servidor (dentro de /opt/app). Gera segredos na primeira vez e sobe o stack.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Gerando .env com segredos fortes…"
  cat > .env <<EOF
DOMAIN=${DOMAIN:-escritorio.e-negociosinteligentes.com.br}
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
MASTER_KEY_B64=$(openssl rand -base64 32)
HMAC_KEY=$(openssl rand -hex 32)
DEMO_PASSWORD=${DEMO_PASSWORD:-Demo@2026}
S3_ACCESS_KEY=campanha
S3_SECRET_KEY=$(openssl rand -hex 24)
EOF
  chmod 600 .env
fi

docker compose up -d --build
echo "Stack no ar. Aguardando Caddy emitir o certificado TLS para ${DOMAIN:-o domínio}…"
