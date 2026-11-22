# Painel Bom Gosto da Amazônia — imagem para hospedagem (Render, Railway, Fly.io, VPS…)
FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app && chmod +x docker-entrypoint.sh
VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
