# syntax=docker/dockerfile:1
#
# The VisaStack web app as one container image, for the Render fallback host
# (docs/operations/render-fallback.md). Vercel never uses this file: Vercel builds with
# `next build` from apps/web/vercel.json and is unchanged.
#
# Built from the repository root by .github/workflows/render-image.yml:
#   docker build -f apps/web/Dockerfile --build-arg VISASTACK_BUILD_SHA=<commit> -t visastack-web .
#
# glibc base (Debian bookworm), because the native image libraries the app loads (sharp and
# @napi-rs/canvas) ship prebuilt glibc binaries; libheif-js is WebAssembly. The digest pins the
# exact base; Renovate proposes updates.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1
WORKDIR /repo
# pnpm at the exact version in package.json "packageManager".
RUN corepack enable
# Dependencies first, so a code-only change reuses this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack install && pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --frozen-lockfile --offline
# NEXT_OUTPUT=standalone switches next.config.mjs to a self-contained server for this image only.
# VISASTACK_BUILD_SHA names the build, so installed phones learn a newer version exists.
ARG VISASTACK_BUILD_SHA=""
ENV NEXT_OUTPUT=standalone \
    VISASTACK_BUILD_SHA=${VISASTACK_BUILD_SHA}
RUN pnpm --filter @visastack/web build

FROM ${NODE_IMAGE} AS run
# Render's free instance has 512 MB. The JavaScript heap is kept well inside it, leaving room for
# the native image libraries, and glibc's per-thread memory pools, which otherwise grow with image
# work, are limited. Render sends traffic to PORT (10000 unless set on the service).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=10000 \
    NODE_OPTIONS=--max-old-space-size=320 \
    MALLOC_ARENA_MAX=2
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/apps/web/scripts/container-self-test.mjs ./apps/web/scripts/container-self-test.mjs
USER node
EXPOSE 10000
CMD ["node", "apps/web/server.js"]
