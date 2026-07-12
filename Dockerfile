FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && mkdir -p /app/data/saas

VOLUME ["/app/data"]

EXPOSE 2022

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/server.js"]
