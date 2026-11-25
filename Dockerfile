# Open2Bill — immagine per il web self-hosted.
# La cartella dati (YAML, XML, PDF) va montata come volume su /data: non entra mai nell'immagine.

# ── Build ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --ignore-scripts
COPY . .
# Prefisso della UI quando nginx la pubblica in un sottopercorso (es. /open2bill/)
ARG VITE_BASE=/
ENV VITE_BASE=$VITE_BASE
RUN npm run build -w @open2bill/web \
 && npm run build -w @open2bill/server \
 && npm prune --omit=dev --ignore-scripts

# ── Runtime ──────────────────────────────────────────────────
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/assets ./apps/server/assets
COPY --from=build /app/apps/web/dist ./apps/web/dist

ENV NODE_ENV=production \
    O2B_HOST=0.0.0.0 \
    O2B_PORT=3210 \
    O2B_DATA_DIR=/data \
    O2B_CHROME_PATH=/usr/bin/chromium \
    O2B_TRUST_PROXY=1

VOLUME ["/data"]
EXPOSE 3210
USER node
CMD ["node", "apps/server/dist/main.js"]
