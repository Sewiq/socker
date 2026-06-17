# Dockerfile dla mp-server (socker-server repo).
# Build context (z docker-compose.yml): ../../socker-server
# Czyli WORKDIR build-time = root socker-server repo.

FROM node:20-alpine AS base
WORKDIR /app

# Zależności (cache layer)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Źródła
COPY . .

# Port (mp-server domyślnie 3000; konfigurowalny przez PORT w .env)
EXPOSE 3000

# Healthcheck — sprawdza czy proces żyje (zakładamy że mp-server nie ma
# osobnego endpointu /health; jeśli ma, podmień na curl /health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ >/dev/null 2>&1 || exit 1

# Start — używa `npm start` z package.json socker-server.
# Jeśli serwer nie ma `start` w package.json, dodaj tam: "start": "node index.js"
CMD ["npm", "start"]
