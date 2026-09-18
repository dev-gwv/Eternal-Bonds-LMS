# One image, two processes.
#
# The API and the worker share every line of code they run — the worker is the
# same registry the API's /internal/cron route calls. Building them separately
# would mean two images that could drift apart.

FROM oven/bun:1.3-alpine AS deps
WORKDIR /app

# Only the manifests first, so a source-only change does not reinstall.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Bun runs TypeScript directly, so there is no build step to go stale. The
# typecheck that would have caught a mistake already ran in CI.

# Never root: a compromised dependency should not own the container.
USER bun

EXPOSE 8080
ENV PORT=8080

# Config comes from the environment, not from a file in the image — there is
# deliberately no .env here. The worker overrides this with:
#   CMD ["bun", "services/worker/src/main.ts"]
CMD ["bun", "services/api/src/server.ts"]
