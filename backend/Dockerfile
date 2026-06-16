FROM node:22-slim
WORKDIR /app

# Dependências (camada cacheável)
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --omit=dev --no-audit --no-fund

# Código da aplicação e schema do banco
COPY backend ./backend
COPY db ./db
COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

WORKDIR /app/backend
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
