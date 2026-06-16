#!/usr/bin/env bash
# Backup do PostgreSQL + teste de restore (DR). Roda no servidor, em /opt/app.
set -euo pipefail
cd "$(dirname "$0")/.."
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
echo "Gerando dump…"
docker compose exec -T db pg_dump -U postgres campanha | gzip > "backups/campanha-$TS.sql.gz"
echo "Backup: backups/campanha-$TS.sql.gz ($(du -h "backups/campanha-$TS.sql.gz" | cut -f1))"

echo "Teste de restore em banco temporário…"
docker compose exec -T db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_test;" -c "CREATE DATABASE restore_test;"
gunzip -c "backups/campanha-$TS.sql.gz" | docker compose exec -T db psql -U postgres -q -d restore_test >/dev/null
COUNT=$(docker compose exec -T db psql -U postgres -tAc "SELECT count(*) FROM accounting_office;" -d restore_test | tr -d '[:space:]')
docker compose exec -T db psql -U postgres -q -c "DROP DATABASE restore_test;"
echo "Restore test OK — escritórios restaurados: $COUNT"
# Retenção: mantém os 14 backups mais recentes
ls -1t backups/campanha-*.sql.gz | tail -n +15 | xargs -r rm -f
