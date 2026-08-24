# syntax=docker/dockerfile:1

# Debian slim, not Alpine: `argon2` is a native module. Alpine's musl libc forces
# a from-source rebuild (needing a full toolchain in the final image, or careful
# multi-stage juggling) whereas glibc-based prebuilds/rebuilds are far more
# reliable here. Trading a slightly bigger base for a build that doesn't
# randomly break on native deps is the right call for this project.
FROM node:22-bookworm-slim AS base

# The project runs on pnpm 10 but does not declare "packageManager" in
# package.json, so corepack has nothing to infer the version from. Pin it
# explicitly rather than let corepack fetch whatever "latest" resolves to at
# build time (non-reproducible builds).
ARG PNPM_VERSION=10.33.3
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install *all* dependencies (incl. dev) so the build stage can run
# `nest build`. Native build tools are only ever installed in this stage and
# the prod-deps stage below -- never in the final runtime image.
# ---------------------------------------------------------------------------
FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: compile TypeScript -> dist/ using the full dependency set above.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# prod-deps: a second, independent install with only runtime dependencies.
# Kept separate from `deps` so devDependencies never leak into the image that
# gets shipped.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ---------------------------------------------------------------------------
# runner: final image. Only compiled JS + production node_modules, nothing
# else -- no TypeScript sources, no tests, no .env, no build toolchain.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# Kept so `npm run migration:run:prod` (used by the `migrate` compose service,
# which shares this image) resolves its script; contains no secrets.
COPY --chown=node:node package.json ./

# The official Node image already ships a non-root `node` user (uid 1000) --
# reuse it instead of creating a new one.
USER node

EXPOSE 3000

# bookworm-slim has neither curl nor wget, and installing one just for the
# healthcheck would defeat the point of a slim base. Node 22 ships a global
# `fetch`, so shell out to `node -e` instead. Any HTTP response (even a 4xx)
# proves the server accepted the TCP connection and handled the request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

# Migrations are run by the dedicated `migrate` service in
# docker-compose.prod.yml, never here: if the app started and ran migrations
# itself, scaling to several replicas would race multiple migration runs
# against the same database.
CMD ["node", "dist/main.js"]
