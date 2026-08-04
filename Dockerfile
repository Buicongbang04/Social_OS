# One Dockerfile for every service in the workspace.
#
# A file per service would drift: the install and build steps are identical, so
# three copies means three chances for one of them to be a version behind. Which
# service an image is comes from `--build-arg PACKAGE`, and nothing else differs.

FROM node:24-alpine AS base
# corepack pins pnpm from package.json's `packageManager`, so the image cannot
# quietly build with a different pnpm than the lockfile was written by.
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies. Separated so a source-only change does not reinstall the world.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
# Every workspace manifest, and only the manifests. Copying sources here would
# make this layer miss its cache on every edit, which is the whole point of
# splitting it out.
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/connectors/package.json packages/connectors/
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/event/package.json packages/event/
COPY packages/knowledge/package.json packages/knowledge/
COPY packages/logger/package.json packages/logger/
COPY packages/media/package.json packages/media/
COPY packages/observability/package.json packages/observability/
COPY packages/queue/package.json packages/queue/
COPY packages/runtime/package.json packages/runtime/
COPY packages/sdk/package.json packages/sdk/
COPY packages/secrets/package.json packages/secrets/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/testing/package.json packages/testing/
COPY packages/trends/package.json packages/trends/
COPY packages/ui/package.json packages/ui/
COPY services/api/package.json services/api/
COPY services/runtime/package.json services/runtime/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build. Turbo works out which workspace packages this one needs and their order.
# ---------------------------------------------------------------------------
FROM deps AS build
ARG PACKAGE
# Inlined into the client bundle by Next.js during the build below. Declared
# here rather than passed at run time because that is the only moment it can
# take effect; see the comment in docker-compose.app.yml.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY . .
RUN pnpm turbo run build --filter="${PACKAGE}..."

# ---------------------------------------------------------------------------
# What actually ships.
# ---------------------------------------------------------------------------
FROM base AS runtime
ARG PACKAGE
ARG WORKDIR
ENV NODE_ENV=production

# Fonts, for the banner renderer.
#
# alpine ships none at all, and this is not a crash — sharp answers happily
# with a picture containing no glyphs. Measured before adding this: the same
# banner drew 2403 bright pixels on a machine with fonts and 576 without, which
# is tofu boxes. Noto is here for its Vietnamese coverage; without it every
# accented letter is a box.
RUN apk add --no-cache fontconfig font-noto

# The whole installed tree rather than a pruned one. `pnpm deploy` would make a
# smaller image, and it is worth doing — but a wrong image that boots is a
# better starting point than a small one nobody has run, and this is the first
# time any of this has left a laptop.
COPY --from=build /app /app
WORKDIR /app/${WORKDIR}

# Not root. A container that is compromised should not also be privileged, and
# the node image ships a `node` user for exactly this.
USER node
CMD ["pnpm", "start"]
