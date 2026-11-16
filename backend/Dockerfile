# No npm install step: the server has zero dependencies (uses Node 22 built-ins).
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_FILE=/app/data/spendwise.db

COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
