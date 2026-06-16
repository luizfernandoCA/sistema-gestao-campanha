#!/bin/sh
set -e
cd /app/backend
echo "Iniciando bootstrap (schema/seed idempotente)…"
npm run bootstrap
echo "Subindo a API…"
exec npm start
