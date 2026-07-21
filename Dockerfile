FROM node:20-bookworm-slim AS builder

WORKDIR /app

# npm workspaces: single root lockfile
COPY package.json package-lock.json ./
COPY web/package.json ./web/

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts \
  && node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const junkPatterns = [
  /(^|\/)(\.npmignore|\.eslintrc.*|\.prettierrc.*|tsconfig.*\.json|CHANGELOG.*|HISTORY.*|README.*|LICENSE.*|LICENCE.*|\.map)$/i,
  /(^|\/)(test|tests|__tests__|docs|example|examples|coverage)(\/|$)/i,
]

function shouldRemove(relPath) {
  return junkPatterns.some((pattern) => pattern.test(relPath))
}

function walk(dir, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(base, full)
    if (entry.isDirectory()) {
      if (shouldRemove(rel + '/')) {
        fs.rmSync(full, { recursive: true, force: true })
      } else {
        walk(full, base)
      }
      continue
    }
    if (shouldRemove(rel)) {
      fs.rmSync(full, { force: true })
    }
  }
}

walk('/app/node_modules')
NODE

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN rm -rf \
      /usr/local/lib/node_modules \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /opt/yarn-v* \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

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
