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
RUN DATABASE_URL=build-placeholder pnpm build


# ── runtime stage ──────────────────────────────────────────────────────────────
FROM base AS runtime
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/build ./build

EXPOSE 3000
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

CMD ["node", "build/index.js"]
