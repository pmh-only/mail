FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable


# ── build stage ────────────────────────────────────────────────────────────────
FROM base AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN DATABASE_URL=build-placeholder \
    BETTER_AUTH_SECRET=build-placeholder \
    BETTER_AUTH_URL=http://localhost \
    pnpm build


# ── runtime stage ──────────────────────────────────────────────────────────────
FROM base AS runtime
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm rebuild better-sqlite3
COPY --from=build /app/build ./build
COPY drizzle ./drizzle

RUN mkdir -p /data
VOLUME /data

EXPOSE 3000
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/data/local.db

CMD ["node", "build/index.js"]
