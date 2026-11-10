# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN npm install -g pnpm@12.6.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# next build reads no secrets (env is parsed lazily at runtime)
RUN pnpm build && pnpm build:bootstrap

FROM node:24-slim AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Migrations + seed: bundled script and the SQL it applies.
COPY --from=build /app/dist/bootstrap.mjs ./dist/bootstrap.mjs
COPY --from=build /app/src/server/db/migrations ./src/server/db/migrations
USER node
EXPOSE 3000
# Idempotent: applies pending migrations, seeds only an empty database, then starts the server.
CMD ["sh", "-c", "node dist/bootstrap.mjs && exec node server.js"]
