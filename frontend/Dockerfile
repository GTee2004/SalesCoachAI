# ---- Stage 1: Dependencies ----
FROM node:24-slim AS deps

RUN npm install -g pnpm@11.24.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build ----
FROM deps AS build

COPY . .
# Environment is read at runtime; the build needs no secrets
RUN pnpm build

# ---- Stage 3: Production ----
FROM node:24-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4500

# The Nitro output bundles its own server dependencies
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/scripts/billing-sweep.mjs ./scripts/billing-sweep.mjs

USER node

EXPOSE 4500

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/login').then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
