# syntax=docker/dockerfile:1

# ---- build stage: install deps (better-sqlite3 uses a prebuilt binary;
#      compilers are only installed if that download isn't available) ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || ( \
      apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++ \
      && npm ci --omit=dev --build-from-source \
    )

# ---- runtime stage ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/habits.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
